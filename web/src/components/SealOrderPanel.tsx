import { useState, type FormEvent } from "react";
import { useAccount } from "wagmi";
import { useAgentState } from "../hooks/useAgentState";
import { useAuctionMeta } from "../hooks/useAuctionMeta";
import { useSubmitOrder } from "../hooks/useSubmitOrder";
import { useWalletBalances } from "../hooks/useWalletBalances";
import { postOrderReveal } from "../lib/agentApi";
import { IS_LIVE } from "../lib/config";
import { fmtEst, trimNum, txUrl } from "../lib/format";
import { BousdtIcon, OrderPadIcon, PngIcon } from "./Icons";
import { useToast } from "./ToastProvider";
import { Window } from "./Window";
import type { OrderRevealWire, OrderSide, SealResult } from "../types";

const PCT_STEPS = [0.25, 0.5, 0.75, 1] as const;
/** Max leaves a hair of rounding headroom. */
const MAX_HEADROOM = 0.995;

export function SealOrderPanel() {
  const [side, setSide] = useState<OrderSide>("buy");
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const submit = useSubmitOrder();
  const { push } = useToast();
  const { isConnected } = useAccount();
  const { data: meta } = useAuctionMeta();
  const { data: balances } = useWalletBalances();
  const { data: agent } = useAgentState();

  const baseSymbol = meta?.base.symbol ?? "—";
  const quoteSymbol = meta?.quote.symbol ?? "—";

  const amountNum = Number(amount);
  const limitNum = Number(limit);
  const needsWallet = IS_LIVE && !isConnected;
  const valid =
    amountNum > 0 && limitNum > 0 && !submit.isPending && !needsWallet;

  // Display-only estimate: BOUSDT crossing the entered amount at the entered
  // price. Same for both sides (sell receives it, buy pays it); the actual
  // order math is untouched. Empty/0 amount or price -> "—".
  const estQuote =
    amountNum > 0 && limitNum > 0 ? fmtEst(amountNum * limitNum) : "—";
  const hasEst = estQuote !== "—";

  // Percent helpers fill the amount from the balance of the token this side
  // SPENDS: sell spends WBOT directly; buy spends BOUSDT, converted to a WBOT
  // amount at the entered limit price (live DEX ref as fallback).
  const pctPrice = limitNum > 0 ? limitNum : (agent?.dexPrice ?? 0);
  const pctReady =
    Boolean(balances) && (side === "sell" || pctPrice > 0);

  function fillPct(step: number) {
    if (!balances) return;
    const pct = step === 1 ? MAX_HEADROOM : step;
    if (side === "sell") {
      setAmount(trimNum(balances.base * pct));
      return;
    }
    if (pctPrice <= 0) return;
    setAmount(trimNum((balances.quote * pct) / pctPrice));
  }

  // Live DEX reference (same source the % chips fall back to). Null when the
  // agent is offline AND the chain read failed, in which case the chip flattens.
  const marketPrice = agent?.dexPrice ?? null;
  const marketReady = marketPrice != null && marketPrice > 0;

  function fillMarket() {
    if (marketPrice == null || marketPrice <= 0) return;
    setLimit(marketPrice.toFixed(4));
  }

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

  function notifyPlaced(res: SealResult) {
    push({
      variant: "settle",
      title: "Order placed",
      message: "Hidden until the agent settles it.",
      href: res.txHash ? txUrl(res.txHash) : undefined,
      hrefLabel: "receipt ↗",
    });
    if (!res.revealDelivered && res.reveal) {
      const reveal = res.reveal;
      push({
        variant: "alert",
        title: "Reveal not delivered",
        message:
          "Placed on-chain, but the agent hasn't received the order details. It stays unmatched until it does.",
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
      notifyPlaced(res);
      setAmount("");
      setLimit("");
    } catch (error) {
      const err = error as { shortMessage?: string; message?: string };
      push({
        variant: "alert",
        title: "Order not placed",
        message: (err.shortMessage ?? err.message ?? "Unknown error").slice(0, 140),
      });
    }
  }

  return (
    <Window title="place-order.exe" icon={<OrderPadIcon />}>
      <h2 className="font-display text-[1.25rem] font-semibold text-text">
        Place a hidden order
      </h2>
      <p className="mt-1 mb-4 text-balance text-[0.875rem] leading-snug text-muted">
        Your order stays hidden until the agent settles it. Only the final
        price becomes public.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <div className="grid grid-cols-2 gap-1 border-2 border-border bg-ground p-1">
            {(["buy", "sell"] as OrderSide[]).map((s) => {
              const active = side === s;
              // settle-dim keeps >=4.5:1 with white text in both themes
              const activeClass =
                s === "buy" ? "bg-navy text-white" : "bg-settle-dim text-white";
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSide(s)}
                  aria-pressed={active}
                  className={`tap95 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-mono text-[0.8125rem] font-medium capitalize transition-colors ${
                    active ? activeClass : "text-muted hover:text-text"
                  }`}
                >
                  {s}
                  {baseSymbol !== "—" && (
                    <>
                      <PngIcon src="/icons/wbot.png" /> {baseSymbol}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-[0.75rem] tabular-nums text-muted">
            {balances ? (
              <>
                You have {trimNum(balances.base, 4)}{" "}
                <PngIcon src="/icons/wbot.png" size={13} className="align-[-2px]" />{" "}
                {baseSymbol} · {trimNum(balances.quote, 4)}{" "}
                <BousdtIcon size={13} /> {quoteSymbol} ·{" "}
                {trimNum(balances.bot, 4)} BOT (gas)
              </>
            ) : (
              "Connect a wallet to see balances"
            )}
          </p>
        </div>

        <div>
          <Field
            label="Amount"
            suffix={baseSymbol}
            value={amount}
            onChange={setAmount}
            placeholder="0.00"
          />
          <div className="mt-2 flex gap-2">
            {PCT_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                disabled={!pctReady}
                onClick={() => fillPct(step)}
                className="btn95 bg-surface px-2 py-0.5 font-mono text-[0.6875rem] text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint"
              >
                {step === 1 ? "Max" : `${step * 100}%`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Field
            label={`${side === "sell" ? "Lowest price you'll accept" : "Highest price you'll pay"} (${quoteSymbol} per ${baseSymbol})`}
            suffix={quoteSymbol}
            value={limit}
            onChange={setLimit}
            placeholder="0.0000"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              aria-label="Use market price"
              disabled={!marketReady}
              onClick={fillMarket}
              className="btn95 bg-surface px-2 py-0.5 font-mono text-[0.6875rem] text-text hover:bg-surface-2 disabled:cursor-not-allowed disabled:bg-ground disabled:text-faint"
            >
              Market
            </button>
          </div>
        </div>

        <div>
          <div className="sunken95 flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="font-mono text-[0.6875rem] text-faint">
              {side === "sell" ? "You receive (est.)" : "You pay (est.)"}
            </span>
            <span className="min-w-0 text-right">
              <span className="block font-mono text-[0.875rem] tabular-nums text-text">
                {hasEst ? (
                  <>
                    {estQuote} {quoteSymbol}
                  </>
                ) : (
                  "—"
                )}
              </span>
              {side === "buy" && hasEst && (
                <span className="mt-0.5 block font-mono text-[0.6875rem] tabular-nums text-faint">
                  for {trimNum(amountNum)} {baseSymbol}
                </span>
              )}
            </span>
          </div>
          <p className="mt-1.5 text-[0.6875rem] leading-snug text-muted">
            Estimate at this price. The agent settles at a single clearing price
            within the pool's deviation guard.
          </p>
        </div>

        <button
          type="submit"
          disabled={!valid}
          className="btn95 w-full bg-navy px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint disabled:hover:brightness-100"
        >
          {submit.isPending ? "Placing…" : "Place hidden order"}
        </button>
        {needsWallet && (
          <p className="font-mono text-[0.75rem] text-faint">
            Connect a wallet to place orders.
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
      <span className="mb-1.5 block font-mono text-[0.6875rem] text-faint">
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
