import { useState, type FormEvent } from "react";
import { useAccount } from "wagmi";
import { useAuctionMeta } from "../hooks/useAuctionMeta";
import { useSubmitOrder } from "../hooks/useSubmitOrder";
import { postOrderReveal } from "../lib/agentApi";
import { IS_LIVE } from "../lib/config";
import { txUrl } from "../lib/format";
import { useToast } from "./ToastProvider";
import { Window } from "./Window";
import type { OrderRevealWire, OrderSide, SealResult } from "../types";

export function SealOrderPanel() {
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const submit = useSubmitOrder();
  const { push } = useToast();
  const { isConnected } = useAccount();
  const { data: meta } = useAuctionMeta();

  const baseSymbol = meta?.base.symbol ?? "—";
  const quoteSymbol = meta?.quote.symbol ?? "—";

  const amountNum = Number(amount);
  const limitNum = Number(limit);
  const needsWallet = IS_LIVE && !isConnected;
  const valid =
    amountNum > 0 && limitNum > 0 && !submit.isPending && !needsWallet;

  function retryReveal(reveal: OrderRevealWire) {
    postOrderReveal(reveal)
      .then(() =>
        push({
          variant: "settle",
          title: "Reveal delivered",
          message: "The agent has the order details.",
        }),
      )
      .catch(() =>
        push({
          variant: "alert",
          title: "Reveal still not delivered",
          message: "The agent API is unreachable. Retry when it is back.",
          action: { label: "Retry", onClick: () => retryReveal(reveal) },
        }),
      );
  }

  function notifySealed(res: SealResult) {
    push({
      variant: "settle",
      title: "Order sealed",
      message: `${res.side} ${amountNum} ${baseSymbol} committed to the next batch`,
      href: res.txHash ? txUrl(res.txHash) : undefined,
      hrefLabel: "view tx ↗",
    });
    if (!res.revealDelivered && res.reveal) {
      const reveal = res.reveal;
      push({
        variant: "alert",
        title: "Reveal not delivered",
        message:
          "Sealed on-chain, but the agent has not received the order details. It stays unmatched until it does.",
        action: { label: "Retry", onClick: () => retryReveal(reveal) },
      });
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      const res = await submit.mutateAsync({
        side,
        amount: amountNum,
        limitPrice: limitNum,
      });
      notifySealed(res);
      setAmount("");
      setLimit("");
    } catch (error) {
      const err = error as { shortMessage?: string; message?: string };
      push({
        variant: "alert",
        title: "Order not sealed",
        message: (err.shortMessage ?? err.message ?? "Unknown error").slice(0, 140),
      });
    }
  }

  return (
    <Window title="seal-order.exe">
      <h2 className="font-display text-[1.25rem] font-semibold text-text">
        Seal order
      </h2>
      <p className="mt-1 mb-4 text-[0.875rem] leading-snug text-muted">
        Commit a sealed order to the next batch. Only the clearing price is
        revealed.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-1 border-2 border-border bg-ground p-1">
          {(["buy", "sell"] as OrderSide[]).map((s) => {
            const active = side === s;
            const activeClass =
              s === "buy" ? "bg-navy text-white" : "bg-settle text-white";
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                aria-pressed={active}
                className={`px-3 py-1.5 font-mono text-[0.8125rem] font-medium capitalize transition-colors ${
                  active ? activeClass : "text-muted hover:text-text"
                }`}
              >
                {s} {baseSymbol !== "—" ? baseSymbol : ""}
              </button>
            );
          })}
        </div>

        <Field
          label="Amount"
          suffix={baseSymbol}
          value={amount}
          onChange={setAmount}
          placeholder="0.00"
        />
        <Field
          label="Limit price"
          suffix={quoteSymbol}
          value={limit}
          onChange={setLimit}
          placeholder="0.0000"
        />

        <button
          type="submit"
          disabled={!valid}
          className="btn95 w-full bg-navy px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#C9C5BB] disabled:text-[#7A7568]"
        >
          {submit.isPending ? "Sealing…" : "Seal order"}
        </button>
        {needsWallet && (
          <p className="font-mono text-[0.75rem] text-faint">
            Connect a wallet to seal orders.
          </p>
        )}
      </form>
    </Window>
  );
}

function Field({
  label,
  suffix,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
        {label}
      </span>
      <div className="sunken95 flex items-center focus-within:border-navy">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent px-3 py-2 font-mono text-[0.875rem] tabular-nums text-text placeholder:text-faint focus:outline-none"
        />
        <span className="px-3 font-mono text-[0.75rem] text-faint">{suffix}</span>
      </div>
    </label>
  );
}
