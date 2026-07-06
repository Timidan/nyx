import { useAccount, useConnect, useDisconnect } from "wagmi";
import { truncateHash } from "../lib/format";
import { useToast } from "./ToastProvider";

/** Header wallet control — secondary button recipe from the design system. */
export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { push } = useToast();

  const base =
    "rounded-input border border-border bg-surface px-4 py-2 text-[0.875rem] text-text hover:border-signal";

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

  async function onConnect() {
    const connector = connectors[0];
    if (!connector) return;
    try {
      await connectAsync({ connector });
    } catch (error) {
      const message = (error as { shortMessage?: string; message?: string });
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

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={isPending}
      className={`${base} disabled:opacity-60`}
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
