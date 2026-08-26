import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { erc20Abi, parseUnits, toHex } from "viem";
import { postOrderReveal } from "../lib/agentApi";
import { recordOrder } from "../lib/orderStore";
import { publicClient } from "../lib/clients";
import {
  IS_LIVE,
  nyxBatchAuctionAbi,
  ORDER_TTL_SECONDS,
  requireAuctionAddress,
} from "../lib/config";
import { calculateOrderExpiry } from "../lib/orderPolicy";
import { useBrowserWallet, type BrowserWalletSession } from "../lib/wallet";
import { mockChain } from "../lib/mockChain";
import { agentStateQueryKey } from "./useAgentState";
import { auctionMetaQueryOptions } from "./useAuctionMeta";
import type { OrderRevealWire, SealResult, SealedOrder } from "../types";

/** Human amount -> token units without parseUnits decimal overflow. */
function toUnits(value: number, decimals: number): bigint {
  return parseUnits(value.toFixed(Math.min(decimals, 8)), decimals);
}

function randomSalt(): `0x${string}` {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * LIVE seal flow, per docs/INTERFACES.md:
 *  1. require a connected wallet on the configured chain
 *  2. build OrderReveal for the current batch with a random 32-byte salt
 *  3. commitment = hashOrder(order) via readContract — never hashed locally
 *  4. ERC-20 approve if allowance is insufficient
 *  5. submitOrder(batchId, commitment, sellToken, sellAmount, expiresAt) + receipt
 *  6. POST the reveal preimage to the agent (bigints as decimal strings);
 *     a failed POST is reported, not fatal — the caller offers a retry
 */
async function sealLiveOrder(
  qc: QueryClient,
  wallet: BrowserWalletSession,
  { side, amount, limitPrice }: SealedOrder,
): Promise<SealResult> {
  const auction = requireAuctionAddress();

  if (!wallet.address) throw new Error("Connect a wallet first.");
  await wallet.ensureChain();
  const trader = wallet.address;

  const { base, quote } = await qc.ensureQueryData(auctionMetaQueryOptions());

  // amount is denominated in base (token0); limit price is quote per base.
  // buy  = acquire base, pay quote  -> sell quote
  // sell = give base, receive quote -> sell base
  const sellToken = side === "buy" ? quote : base;
  const sellAmount =
    side === "buy"
      ? toUnits(amount * limitPrice, quote.decimals)
      : toUnits(amount, base.decimals);
  const minBuyAmount =
    side === "buy"
      ? toUnits(amount, base.decimals)
      : toUnits(amount * limitPrice, quote.decimals);
  if (sellAmount === 0n || minBuyAmount === 0n) {
    throw new Error("Order size rounds to zero at this price.");
  }

  const [batchId, cancelDelay, paused, allowlistEnabled, traderAllowed, risk, latestBlock] =
    await Promise.all([
      publicClient.readContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "currentBatchId",
      }),
      publicClient.readContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "cancelDelaySeconds",
      }),
      publicClient.readContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "paused",
      }),
      publicClient.readContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "allowlistEnabled",
      }),
      publicClient.readContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "allowedTraders",
        args: [trader],
      }),
      publicClient.readContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "riskLimits",
        args: [sellToken.address],
      }),
      publicClient.getBlock({ blockTag: "latest" }),
    ]);

  if (paused) throw new Error("Nyx is paused. No new escrow is being accepted.");
  if (allowlistEnabled && !traderAllowed) {
    throw new Error("This launch canary is currently limited to approved wallets.");
  }
  if (risk[0] === 0n || sellAmount > risk[0]) {
    throw new Error("This order exceeds the launch per-order escrow cap.");
  }

  const [batchEscrowed, totalEscrowed] = await Promise.all([
    publicClient.readContract({
      address: auction,
      abi: nyxBatchAuctionAbi,
      functionName: "batchEscrowed",
      args: [batchId, sellToken.address],
    }),
    publicClient.readContract({
      address: auction,
      abi: nyxBatchAuctionAbi,
      functionName: "totalEscrowed",
      args: [sellToken.address],
    }),
  ]);
  if (batchEscrowed + sellAmount > risk[1]) {
    throw new Error("This round's launch escrow cap is full.");
  }
  if (totalEscrowed + sellAmount > risk[2]) {
    throw new Error("Nyx's launch escrow cap is full.");
  }

  const expiresAt = calculateOrderExpiry(
    latestBlock.timestamp,
    ORDER_TTL_SECONDS,
    cancelDelay,
  );

  const order = {
    trader,
    batchId,
    sellToken: sellToken.address,
    sellAmount,
    minBuyAmount,
    expiresAt,
    salt: randomSalt(),
  } as const;

  const commitment = await publicClient.readContract({
    address: auction,
    abi: nyxBatchAuctionAbi,
    functionName: "hashOrder",
    args: [order],
  });

  const allowance = await publicClient.readContract({
    address: sellToken.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [trader, auction],
  });
  if (allowance < sellAmount) {
    const approveHash = await wallet.sendContract({
      address: sellToken.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [auction, sellAmount],
    });
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    if (approvalReceipt.status !== "success") {
      throw new Error("Token approval reverted on-chain.");
    }
  }

  const txHash = await wallet.sendContract({
    address: auction,
    abi: nyxBatchAuctionAbi,
    functionName: "submitOrder",
    args: [batchId, commitment, sellToken.address, sellAmount, expiresAt],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("Order commitment reverted on-chain.");
  }

  const reveal: OrderRevealWire = {
    trader: order.trader,
    batchId: order.batchId.toString(),
    sellToken: order.sellToken,
    sellAmount: order.sellAmount.toString(),
    minBuyAmount: order.minBuyAmount.toString(),
    expiresAt: order.expiresAt.toString(),
    salt: order.salt,
  };
  let revealDelivered = true;
  try {
    await postOrderReveal(reveal);
  } catch (error) {
    console.warn("reveal delivery failed:", error);
    revealDelivered = false;
  }

  // Track this wallet's order locally for the my-orders panel. The reveal
  // preimage is kept only while its delivery still needs a retry.
  recordOrder(trader, {
    commitment,
    batchId: order.batchId.toString(),
    side,
    amount,
    limitPrice,
    txHash,
    revealDelivered,
    reveal: revealDelivered ? null : reveal,
    expiresAt: Number(order.expiresAt),
    createdAt: Date.now(),
  });

  void qc.invalidateQueries({ queryKey: agentStateQueryKey });
  void qc.invalidateQueries({ queryKey: ["myOrders"] });
  return { commitment, side, txHash, revealDelivered, reveal };
}

/** Seals an order into the next batch (mock simulator when not live). */
export function useSubmitOrder() {
  const qc = useQueryClient();
  const wallet = useBrowserWallet();
  return useMutation<SealResult, Error, SealedOrder>({
    mutationFn: (order) =>
      IS_LIVE ? sealLiveOrder(qc, wallet, order) : mockChain.submitOrder(order),
  });
}
