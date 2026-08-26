import { formatUnits } from "viem";
import { useAuctionMeta } from "../hooks/useAuctionMeta";
import {
  phaseWords,
  useCancelOrder,
  useMyOrders,
  type MyOrder,
} from "../hooks/useMyOrders";
import {
  useClaimPayout,
  useClaimablePayouts,
  type ClaimablePayout,
} from "../hooks/useClaimablePayouts";
import { postOrderReveal } from "../lib/agentApi";
import { IS_LIVE } from "../lib/config";
import { forgetReveal, markRevealDelivered } from "../lib/orderStore";
import { calculatePriceImprovement } from "../lib/orderPolicy";
import { useBrowserWallet } from "../lib/wallet";
import { fmtDur, trimNum, truncateHash, txUrl } from "../lib/format";
import { useToast } from "./ToastProvider";
import { FolderIcon, PngIcon } from "./Icons";
import { Window } from "./Window";

const PHASE_CLASS: Record<string, string> = {
  waiting: "text-signal",
  stale: "text-amber",
  expired: "text-alert",
  settled: "text-settle",
  cancelled: "text-muted",
  unknown: "text-faint",
};

/** The connected wallet's orders with live status + cancel/refund. Live mode
 *  and connected wallets only. */
export function MyOrdersPanel() {
  const { address, isConnected } = useBrowserWallet();
  const { data: orders = [] } = useMyOrders();
  const { data: meta } = useAuctionMeta();
  const cancel = useCancelOrder();
  const { data: claimable = [] } = useClaimablePayouts();
  const claim = useClaimPayout();
  const { push } = useToast();

  if (!IS_LIVE || !isConnected || !address) return null;

  const baseSymbol = meta?.base.symbol ?? "WBOT";
  const quoteSymbol = meta?.quote.symbol ?? "USDT";
  const anyLocked = orders.some((o) => o.open && !o.cancellable);

  function retryReveal(order: MyOrder) {
    if (!order.reveal) return;
    const reveal = order.reveal;
    postOrderReveal(reveal)
      .then(() => {
        markRevealDelivered(address!, order.commitment);
        push({
          variant: "settle",
          title: "Reveal delivered",
          message: "The agent has the order details.",
        });
      })
      .catch(() =>
        push({
          variant: "alert",
          title: "Reveal still not delivered",
          message: "The agent API is unreachable. Retry when it is back.",
        }),
      );
  }

  function onForgetReveal(order: MyOrder) {
    forgetReveal(address!, order.commitment);
    push({
      variant: "alert",
      title: "Reveal forgotten",
      message: "The retry preimage was removed from this browser.",
    });
  }

  async function onClaim(payout: ClaimablePayout) {
    try {
      const hash = await claim.mutateAsync(payout.token);
      push({
        variant: "settle",
        title: "Payout claimed",
        message: `${trimNum(payout.amount, 4)} ${payout.symbol} is in your wallet.`,
        href: txUrl(hash),
        hrefLabel: "receipt ↗",
      });
    } catch (error) {
      const err = error as { shortMessage?: string; message?: string };
      push({
        variant: "alert",
        title: "Claim failed",
        message: (err.shortMessage ?? err.message ?? "Unknown error").slice(0, 140),
      });
    }
  }

  async function onCancel(order: MyOrder) {
    try {
      const hash = await cancel.mutateAsync(order.commitment);
      push({
        variant: "settle",
        title: "Order cancelled",
        message: "Your escrow is refunded.",
        href: txUrl(hash),
        hrefLabel: "receipt ↗",
      });
    } catch (error) {
      const err = error as { shortMessage?: string; message?: string };
      push({
        variant: "alert",
        title: "Cancel failed",
        message: (err.shortMessage ?? err.message ?? "Unknown error").slice(0, 140),
      });
    }
  }

  function copySettlement(order: MyOrder) {
    if (!order.receipt) return;
    const improvement = calculatePriceImprovement(
      order.side,
      order.amount,
      order.limitPrice,
      order.receipt.clearingPrice,
    );
    const improvementText =
      improvement.quoteAmount > 0
        ? ` Improvement: ${trimNum(improvement.quoteAmount, 6)} ${quoteSymbol} (${improvement.bps} bps).`
        : "";
    navigator.clipboard
      .writeText(
        `Nyx round #${order.batchId}: ${order.side} ${trimNum(order.amount, 6)} ${baseSymbol} cleared at ${trimNum(order.receipt.clearingPrice, 6)} ${quoteSymbol}/${baseSymbol}.${improvementText} ${txUrl(order.receipt.txHash)}`,
      )
      .then(() =>
        push({
          variant: "settle",
          title: "Result copied",
          message: "The on-chain settlement receipt is ready to share.",
        }),
      )
      .catch(() =>
        push({
          variant: "alert",
          title: "Copy blocked",
          message: "Your browser did not allow clipboard access.",
        }),
      );
  }

  return (
    <Window title="my-orders.exe" icon={<FolderIcon />}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[1.25rem] font-semibold text-text">
          My orders
        </h2>
        <span className="font-mono text-[0.75rem] text-faint">
          {truncateHash(address)}
        </span>
      </div>

      {anyLocked && (
        <p className="mb-3 font-mono text-[0.75rem] text-muted">
          Orders cannot be edited. Refunds unlock on expiry, a stale round, or the fallback delay.
        </p>
      )}

      {claimable.length > 0 && (
        <div className="sunken95 mb-3 p-3">
          <p className="font-mono text-[0.75rem] text-text">
            Waiting to be claimed
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] leading-snug text-muted">
            These orders settled, but the payout transfer did not go through.
            The funds are held for you and can be withdrawn now.
          </p>
          <ul className="mt-2 space-y-1.5">
            {claimable.map((payout) => (
              <li
                key={payout.token}
                className="flex items-center justify-between gap-3 font-mono text-[0.75rem]"
              >
                <span className="tabular-nums text-text">
                  {trimNum(payout.amount, 4)} {payout.symbol}
                </span>
                <button
                  type="button"
                  disabled={claim.isPending}
                  onClick={() => void onClaim(payout)}
                  className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint"
                >
                  {claim.isPending ? "Claiming…" : "Claim"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="py-4 text-center font-mono text-[0.8125rem] text-faint">
          No orders from this wallet yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {orders.map((order) => (
            <li
              key={order.commitment}
              className="sunken95 p-3 font-mono text-[0.75rem]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="tabular-nums text-text">
                  {order.side} {trimNum(order.amount, 4)} {baseSymbol} @{" "}
                  {trimNum(order.limitPrice, 4)}
                </span>
                <span className={PHASE_CLASS[order.phase] ?? "text-text"}>
                  {phaseWords(order.phase)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-faint">
                  round #{order.batchId} ·{" "}
                  <a
                    href={txUrl(order.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-link underline hover:no-underline"
                  >
                    <PngIcon src="/icons/explorer.png" size={13} /> receipt ↗
                  </a>
                </span>
                <span className="flex items-center gap-2">
                  {order.revealDelivered ? (
                    <span className="text-muted">reveal delivered</span>
                  ) : order.reveal ? (
                    <>
                      <span className="text-alert">reveal missing</span>
                      <button
                        type="button"
                        onClick={() => retryReveal(order)}
                        className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => onForgetReveal(order)}
                        className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text"
                      >
                        Forget
                      </button>
                    </>
                  ) : (
                    <span className="text-alert">reveal unavailable</span>
                  )}
                  {order.open &&
                    (order.cancellable ? (
                      <button
                        type="button"
                        disabled={cancel.isPending}
                        onClick={() => void onCancel(order)}
                        title="Orders cannot be edited. Refund becomes available on expiry, a stale round, or the fallback delay."
                        className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint"
                      >
                        {cancel.isPending ? "Cancelling…" : "Cancel and refund"}
                      </button>
                    ) : (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <button
                          type="button"
                          disabled
                          aria-label="Orders cannot be edited. Refund becomes available on expiry, a stale round, or the fallback delay."
                          title="Orders cannot be edited. Refund becomes available on expiry, a stale round, or the fallback delay."
                          className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint"
                        >
                          Cancel and refund
                        </button>
                        <span className="tabular-nums text-faint">
                          refund unlocks in {fmtDur(order.cancelUnlocksInSecs ?? 0)}
                        </span>
                      </span>
                    ))}
                </span>
              </div>
              {order.receipt && meta && (
                <div className="mt-2 border-t border-border pt-2 text-[0.6875rem] leading-relaxed">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-settle">
                      cleared @ {trimNum(order.receipt.clearingPrice, 6)} {quoteSymbol}
                    </span>
                    <span className="text-muted">
                      received {trimNum(
                        Number(
                          formatUnits(
                            order.receipt.buyAmount,
                            order.side === "buy" ? meta.base.decimals : meta.quote.decimals,
                          ),
                        ),
                        6,
                      )}{" "}
                      {order.side === "buy" ? baseSymbol : quoteSymbol}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-faint">
                    <span>
                      TWAP {trimNum(order.receipt.referencePrice, 6)} · proof {truncateHash(order.receipt.settlementHash)}
                    </span>
                    <span className="flex items-center gap-2">
                      {calculatePriceImprovement(
                        order.side,
                        order.amount,
                        order.limitPrice,
                        order.receipt.clearingPrice,
                      ).quoteAmount > 0 && (
                        <span className="text-settle">
                          +{trimNum(
                            calculatePriceImprovement(
                              order.side,
                              order.amount,
                              order.limitPrice,
                              order.receipt.clearingPrice,
                            ).quoteAmount,
                            6,
                          )}{" "}
                          {quoteSymbol} vs limit
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => copySettlement(order)}
                        className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text"
                      >
                        Copy result
                      </button>
                    </span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Window>
  );
}
