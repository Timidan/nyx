import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { erc20Abi, parseUnits, toHex } from "viem";
import {
  getAccount,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { postOrderReveal } from "../lib/agentApi";
import { botChain } from "../lib/chain";
import { publicClient, wagmiConfig } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
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
 *  1. require a connected wallet on chain 968 (add/switch via wallet metadata)
 *  2. build OrderReveal for the current batch with a random 32-byte salt
 *  3. commitment = hashOrder(order) via readContract — never hashed locally
 *  4. ERC-20 approve if allowance is insufficient
 *  5. submitOrder(batchId, commitment, sellToken, sellAmount) + receipt
 *  6. POST the reveal preimage to the agent (bigints as decimal strings);
 *     a failed POST is reported, not fatal — the caller offers a retry
 */
async function sealLiveOrder(
  qc: QueryClient,
  { side, amount, limitPrice }: SealedOrder,
): Promise<SealResult> {
  const auction = requireAuctionAddress();

  const account = getAccount(wagmiConfig);
  if (!account.address) throw new Error("Connect a wallet first.");
  // account.chainId is the wallet's REAL chain; getChainId(wagmiConfig) only
  // reflects config state (always 968 here — the sole configured chain) and
  // never detects a wallet sitting on another network.
  if (account.chainId !== botChain.id) {
    await switchChain(wagmiConfig, { chainId: botChain.id });
  }

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

  const batchId = await publicClient.readContract({
    address: auction,
    abi: nyxBatchAuctionAbi,
    functionName: "currentBatchId",
  });

  const order = {
    trader: account.address,
    batchId,
    sellToken: sellToken.address,
    sellAmount,
    minBuyAmount,
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
    args: [account.address, auction],
  });
  if (allowance < sellAmount) {
    const approveHash = await writeContract(wagmiConfig, {
      address: sellToken.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [auction, sellAmount],
      chainId: botChain.id,
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
  }

  const txHash = await writeContract(wagmiConfig, {
    address: auction,
    abi: nyxBatchAuctionAbi,
    functionName: "submitOrder",
    args: [batchId, commitment, sellToken.address, sellAmount],
    chainId: botChain.id,
  });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("Order commitment reverted on-chain.");
  }

  const reveal: OrderRevealWire = {
    trader: order.trader,
    batchId: order.batchId.toString(),
    sellToken: order.sellToken,
    sellAmount: order.sellAmount.toString(),
    minBuyAmount: order.minBuyAmount.toString(),
    salt: order.salt,
  };
  let revealDelivered = true;
  try {
    await postOrderReveal(reveal);
  } catch (error) {
    console.warn("reveal delivery failed:", error);
    revealDelivered = false;
  }

  void qc.invalidateQueries({ queryKey: agentStateQueryKey });
  return { commitment, side, txHash, revealDelivered, reveal };
}

/** Seals an order into the next batch (mock simulator when not live). */
export function useSubmitOrder() {
  const qc = useQueryClient();
  return useMutation<SealResult, Error, SealedOrder>({
    mutationFn: (order) =>
      IS_LIVE ? sealLiveOrder(qc, order) : mockChain.submitOrder(order),
  });
}
