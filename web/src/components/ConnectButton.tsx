import { useState } from "react";
import { truncateHash } from "../lib/format";
import { useBrowserWallet } from "../lib/wallet";
import type { DiscoveredWallet } from "../lib/walletPolicy";
import { useToast } from "./ToastProvider";

/** Header wallet control — secondary button recipe from the design system.
 *
 *  Multi-wallet browsers (Rabby + TronLink + …) fight over window.ethereum,
 *  so the generic `injected` connector can hang forever without ever opening
 *  a wallet popup. Prefer the EIP-6963-discovered per-wallet connectors
 *  (stable ids like "io.rabby"); the generic one is only a fallback when
 *  discovery found nothing. */
export function ConnectButton() {
  const { address, isConnected, isConnecting, wallets, connect, disconnect } =
    useBrowserWallet();
  const { push } = useToast();
  const [showPicker, setShowPicker] = useState(false);

  const discovered = wallets.filter((wallet) => wallet.id !== "injected");
  const usable = discovered.length > 0 ? discovered : wallets;

  const base = "btn95 bg-surface px-4 py-2 text-[0.875rem] text-text";

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        title="Disconnect"
        className={`${base} font-mono text-[0.8125rem]`}
      >
        {truncateHash(address)}
      </button>
    );
  }

  async function connectWith(wallet: DiscoveredWallet) {
    setShowPicker(false);
    try {
      await connect(wallet);
    } catch (error) {
      const message = error as { shortMessage?: string; message?: string };
      push({
        variant: "alert",
        title: "Wallet not connected",
        message:
          message.shortMessage ??
          message.message ??
          "No wallet found. Install a browser wallet to seal orders on-chain.",
      });
    }
  }

  function onConnect() {
    if (usable.length === 0) {
      push({
        variant: "alert",
        title: "No wallet found",
        message: "Install a browser wallet to seal orders on-chain.",
      });
      return;
    }
    if (usable.length === 1) {
      void connectWith(usable[0]);
      return;
    }
    setShowPicker((v) => !v);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onConnect}
        disabled={isConnecting}
        className={`${base} disabled:opacity-60`}
      >
        {isConnecting ? "Connecting…" : "Connect wallet"}
      </button>
      {showPicker && (
        <div className="absolute right-0 top-full z-20 mt-2 min-w-44 border-2 border-border bg-surface shadow-win">
          {usable.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              onClick={() => void connectWith(wallet)}
              className="tap95 block w-full px-3 py-2 text-left text-[0.875rem] text-text hover:bg-navy hover:text-white"
            >
              {wallet.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
