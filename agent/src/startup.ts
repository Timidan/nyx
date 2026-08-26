import type { AgentConfig } from "./config.js";
import type { Address, Hex32 } from "./types.js";

/** BOT Chain mainnet. The canonical-pool binding is not optional here. */
const MAINNET_CHAIN_ID = 677;

export interface StartupState {
  chainId: number;
  latestBlock: bigint;
  auctionCodeHash: Hex32;
  token0: Address;
  token1: Address;
  referenceOracle: Address;
  oracleBaseToken: Address;
  oracleQuoteToken: Address;
  oraclePool: Address;
  oracleFactory?: Address;
  contractAgent: Address;
  signer?: Address;
  paused: boolean;
}

export function validateStartupState(config: AgentConfig, state: StartupState): void {
  if (!config.auctionAddress) throw new Error("NYX_BATCH_AUCTION is required");
  if (state.chainId !== config.chainId) {
    throw new Error(`chain id mismatch: expected ${config.chainId}, received ${state.chainId}`);
  }
  if (config.fromBlock <= 0n) {
    throw new Error("START_BLOCK must be the deployment block, not zero");
  }
  if (config.fromBlock > state.latestBlock) {
    throw new Error("START_BLOCK is after the latest block");
  }
  if (!config.expectedAuctionCodeHash) {
    throw new Error("AUCTION_RUNTIME_CODE_HASH is required");
  }
  if (state.auctionCodeHash.toLowerCase() !== config.expectedAuctionCodeHash.toLowerCase()) {
    throw new Error("auction runtime code hash mismatch");
  }
  requireAddress("token0", state.token0, config.wbot);
  requireAddress("token1", state.token1, config.bousdt);

  if (!config.referenceOracle) throw new Error("REFERENCE_ORACLE is required");
  requireAddress("reference oracle", state.referenceOracle, config.referenceOracle);
  requireAddress("oracle base token", state.oracleBaseToken, config.wbot);
  requireAddress("oracle quote token", state.oracleQuoteToken, config.bousdt);

  if (!config.v3Pool) throw new Error("BOT_V3_POOL is required");
  requireAddress("oracle pool", state.oraclePool, config.v3Pool);

  // The agent refuses to run against an oracle bound to any other factory, so a
  // pool swapped between deployment and startup is caught before the first
  // settlement. Testnet still tolerates an unset value because the oracle
  // deployed there predates the binding and does not answer factory().
  if (state.chainId === MAINNET_CHAIN_ID && !config.v3Factory) {
    throw new Error("BOT_V3_FACTORY is required on mainnet");
  }
  if (config.v3Factory) {
    if (!state.oracleFactory) {
      throw new Error("oracle does not expose factory(); it predates the canonical pool binding");
    }
    requireAddress("oracle factory", state.oracleFactory, config.v3Factory);
  }

  if (!config.expectedAgent) throw new Error("AGENT_ADDRESS is required");
  requireAddress("contract agent", state.contractAgent, config.expectedAgent);
  if (!config.dryRun) {
    if (!state.signer || !sameAddress(state.signer, state.contractAgent)) {
      throw new Error("configured signer does not control contract settlement authority");
    }
  }
}

function requireAddress(label: string, actual: string, expected: string): void {
  if (!sameAddress(actual, expected)) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
