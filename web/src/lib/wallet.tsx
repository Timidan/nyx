import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isHash,
  numberToHex,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import { botChain } from "./chain";
import {
  requireExpectedChainId,
  upsertDiscoveredWallet,
  type BrowserProvider,
  type DiscoveredWallet,
} from "./walletPolicy";

interface SendContractRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export interface BrowserWalletSession {
  address?: Address;
  chainId?: number;
  isConnected: boolean;
  isConnecting: boolean;
  wallets: DiscoveredWallet[];
  connect(wallet: DiscoveredWallet): Promise<void>;
  disconnect(): void;
  ensureChain(): Promise<void>;
  sendContract(request: SendContractRequest): Promise<Hash>;
}

const WalletContext = createContext<BrowserWalletSession | null>(null);

export function BrowserWalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<DiscoveredWallet>();
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const announce = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{
        info?: { uuid?: string; rdns?: string; name?: string; icon?: string };
        provider?: BrowserProvider;
      }>;
      const { info, provider } = event.detail ?? {};
      if (!provider || !info?.name) return;
      const id = info.uuid ?? info.rdns ?? info.name;
      setWallets((current) =>
        upsertDiscoveredWallet(current, {
          id,
          name: info.name!,
          icon: info.icon,
          provider,
        }),
      );
    };

    window.addEventListener("eip6963:announceProvider", announce);
    const fallback = (window as Window & { ethereum?: BrowserProvider }).ethereum;
    if (fallback) {
      setWallets((current) =>
        upsertDiscoveredWallet(current, {
          id: "injected",
          name: "Browser wallet",
          provider: fallback,
        }),
      );
    }
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", announce);
  }, []);

  useEffect(() => {
    const provider = activeWallet?.provider;
    if (!provider?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof first === "string" && isAddress(first)) {
        setAddress(getAddress(first));
      } else {
        setAddress(undefined);
        setActiveWallet(undefined);
      }
    };
    const onChainChanged = (...args: unknown[]) => {
      setChainId(parseChainId(args[0]));
    };
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [activeWallet]);

  const connect = useCallback(async (wallet: DiscoveredWallet) => {
    setIsConnecting(true);
    try {
      const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (typeof first !== "string" || !isAddress(first)) {
        throw new Error("Wallet did not return an EVM account.");
      }
      const rawChainId = await wallet.provider.request({ method: "eth_chainId" });
      setActiveWallet(wallet);
      setAddress(getAddress(first));
      setChainId(parseChainId(rawChainId));
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setActiveWallet(undefined);
    setAddress(undefined);
    setChainId(undefined);
  }, []);

  const ensureChain = useCallback(async () => {
    if (!activeWallet || !address) throw new Error("Connect a wallet first.");
    const provider = activeWallet.provider;
    const currentChainId = parseChainId(await provider.request({ method: "eth_chainId" }));
    if (currentChainId === botChain.id) {
      setChainId(currentChainId);
      return;
    }

    const chainIdHex = numberToHex(botChain.id);
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (error) {
      if (errorCode(error) !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: botChain.name,
            nativeCurrency: botChain.nativeCurrency,
            rpcUrls: botChain.rpcUrls.default.http,
            blockExplorerUrls: botChain.blockExplorers
              ? [botChain.blockExplorers.default.url]
              : undefined,
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    }
    const confirmed = await provider.request({ method: "eth_chainId" });
    setChainId(requireExpectedChainId(confirmed, botChain.id));
  }, [activeWallet, address]);

  const sendContract = useCallback(
    async (request: SendContractRequest): Promise<Hash> => {
      if (!activeWallet || !address) throw new Error("Connect a wallet first.");
      await ensureChain();
      const data = encodeFunctionData({
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
      } as never);
      const result = await activeWallet.provider.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: request.address, data }],
      });
      if (typeof result !== "string" || !isHash(result)) {
        throw new Error("Wallet did not return a transaction hash.");
      }
      return result;
    },
    [activeWallet, address, ensureChain],
  );

  const value = useMemo<BrowserWalletSession>(
    () => ({
      address,
      chainId,
      isConnected: Boolean(address && activeWallet),
      isConnecting,
      wallets,
      connect,
      disconnect,
      ensureChain,
      sendContract,
    }),
    [address, chainId, activeWallet, isConnecting, wallets, connect, disconnect, ensureChain, sendContract],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useBrowserWallet(): BrowserWalletSession {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useBrowserWallet must be used inside BrowserWalletProvider");
  return value;
}

function parseChainId(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return undefined;
  }
  try {
    return Number(BigInt(value));
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return Number((error as { code: unknown }).code);
}
