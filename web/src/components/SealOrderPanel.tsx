import { useState, type FormEvent } from "react";
import { useSubmitOrder } from "../hooks/useSubmitOrder";
import { useToast } from "./ToastProvider";
import type { OrderSide } from "../types";

export function SealOrderPanel() {
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const submit = useSubmitOrder();
  const { push } = useToast();

  const amountNum = Number(amount);
  const limitNum = Number(limit);
  const valid =
    amountNum > 0 && limitNum > 0 && !submit.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      const res = await submit.mutateAsync({
        side,
        amount: amountNum,
        limitPrice: limitNum,
      });
      push({
        variant: "settle",
        title: "Order sealed",
        message: `${side} ${amountNum} WBOT committed as ${res.commitment.slice(0, 10)}…`,
      });
      setAmount("");
      setLimit("");
    } catch {
      push({
        variant: "alert",
        title: "Order not sealed",
        message: "The commitment did not reach the pool. Try again.",
      });
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <h2 className="font-display text-[1.25rem] font-semibold text-text">
        Seal order
      </h2>
      <p className="mt-1 mb-4 text-[0.875rem] leading-snug text-muted">
        Commit a sealed order to the next batch. Only the clearing price is
        revealed.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-input border border-border bg-ground p-1">
          {(["buy", "sell"] as OrderSide[]).map((s) => {
            const active = side === s;
            const activeClass =
              s === "buy" ? "bg-signal text-ground" : "bg-settle text-ground";
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                aria-pressed={active}
                className={`rounded-[3px] px-3 py-1.5 font-mono text-[0.8125rem] font-medium capitalize transition-colors ${
                  active ? activeClass : "text-muted hover:text-text"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        <Field
          label="Amount"
          suffix="WBOT"
          value={amount}
          onChange={setAmount}
          placeholder="0.00"
        />
        <Field
          label="Limit price"
          suffix="USDC"
          value={limit}
          onChange={setLimit}
          placeholder="0.0000"
        />

        <button
          type="submit"
          disabled={!valid}
          className="w-full rounded-input bg-signal px-4 py-2.5 font-medium text-ground transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submit.isPending ? "Sealing…" : "Seal order"}
        </button>
      </form>
    </section>
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
      <div className="flex items-center rounded-input border border-border bg-ground focus-within:border-signal">
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
