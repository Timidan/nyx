import { useAccount } from "wagmi";
import { useAuctionMeta } from "../hooks/useAuctionMeta";
import {
  phaseWords,
  useCancelOrder,
  useMyOrders,
  type MyOrder,
} from "../hooks/useMyOrders";
import { postOrderReveal } from "../lib/agentApi";
import { IS_LIVE } from "../lib/config";
import { forgetReveal, markRevealDelivered } from "../lib/orderStore";
import { fmtDur, trimNum, truncateHash, txUrl } from "../lib/format";
import { useToast } from "./ToastProvider";
import { FolderIcon, PngIcon } from "./Icons";
import { Window } from "./Window";

const PHASE_CLASS: Record<string, string> = {
  waiting: "text-signal",
  stale: "text-amber",
  settled: "text-settle",
  cancelled: "text-muted",
  unknown: "text-faint",
};

/** The connected wallet's orders with live status + cancel/refund. Live mode
 *  and connected wallets only. */
export function MyOrdersPanel() {
  const { address, isConnected } = useAccount();
  const { data: orders = [] } = useMyOrders();
  const { data: meta } = useAuctionMeta();
  const cancel = useCancelOrder();
  const { push } = useToast();

  if (!IS_LIVE || !isConnected || !address) return null;

  const baseSymbol = meta?.base.symbol ?? "WBOT";
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
          Orders are sealed: no edits. Cancel unlocks after the delay.
        </p>
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
                        title="Sealed orders cannot be edited. Cancel becomes available after the pool's cancel delay."
                        className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint"
                      >
                        {cancel.isPending ? "Cancelling…" : "Cancel and refund"}
                      </button>
                    ) : (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <button
                          type="button"
                          disabled
                          aria-label="Sealed orders cannot be edited. Cancel becomes available after the pool's cancel delay."
                          title="Sealed orders cannot be edited. Cancel becomes available after the pool's cancel delay."
                          className="btn95 bg-surface px-2 py-0.5 text-[0.6875rem] text-text disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint"
                        >
                          Cancel and refund
                        </button>
                        <span className="tabular-nums text-faint">
                          unlocks in {fmtDur(order.cancelUnlocksInSecs ?? 0)}
                        </span>
                      </span>
                    ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Window>
  );
}
