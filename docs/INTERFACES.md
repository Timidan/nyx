# Nyx — Protocol & API reference

The stable contract between the three components: the Solidity interface the
contract implements, the reason-code table, and the agent's local HTTP API the
frontend consumes. Changes land here first, then in code.

## Design notes

Nyx is a sealed-bid commit-reveal batch auction driven by an autonomous agent.
Orders are **sealed from public chain observers until settlement**; the agent
sees preimages in order to match, single-agent settlement is centralized in
the current deployment, and `cancelOrder` guarantees an exit from escrow after
the cancel delay. A ZK settlement layer can replace the reveal step without
changing the order flow; the commitment and event model was shaped for that.

## Chain facts (verified on-chain)

| Item | Value |
|---|---|
| RPC | https://rpc.bohr.life (chainId 968 / 0x3c8) |
| Explorer | https://scan.bohr.life (Blockscout) |
| Faucet | https://faucet.bohr.life (browser only, no public API) |
| BOT DEX V2 pair (BOUSDT/WBOT) | `0x4C7a5bE488491A76b2839AcCFc13d8Dd5276a5e0` — live reserves, actively traded |
| BOUSDT (token0) | `0xAfea2A5e0587615ceD6972e271E5bfe8622ebcA2` |
| WBOT (token1) | `0xD5452816194a3784dBa983426cCe7c122F4abd30` |
| SwapRouter | `0x07032d47A1b9f8460cBeE9dC17c1d3E438693929` |
| Second pair (same tokens) | `0xC5EAf0a5b0E6af9572a7B673f1d59659A69Cb896` |

Token orientation: `NyxBatchAuction.token0 = WBOT` (18 decimals), `token1 =
BOUSDT` (6 decimals); `referencePair` is the live BOUSDT/WBOT pair above and
`clearingPriceX18` means normalized BOUSDT per WBOT. Note the DEX pair's own
token order is reversed (BOUSDT is its token0); the contract normalizes.

Ecosystem quirks worth knowing: WBOT is WETH9-style (`deposit()` /
`withdraw(uint256)`; the router's `WETH9()` returns it). The published
`SwapRouter` is a Uniswap **V3** SwapRouter, not V2 (`getAmountsOut` reverts);
V3 WBOT/BOUSDT pools exist at fee tiers 500/3000/10000 but carry little
liquidity, so small-amount token prep is better served by a direct V2-style
swap against the pair. `BOUSDT.mint` is role-restricted.

## Contracts

### INyxBatchAuction (core)

```solidity
interface INyxBatchAuction {
    struct OrderReveal {
        address trader;
        uint64 batchId;
        address sellToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        bytes32 salt;
    }

    struct MatchedOrder {
        bytes32 commitment;
        OrderReveal order;
    }

    event OrderSubmitted(uint64 indexed batchId, bytes32 indexed commitment, address indexed trader, address sellToken, uint256 sellAmount);
    event OrderSettled(uint64 indexed batchId, bytes32 indexed commitment, address indexed trader, address sellToken, uint256 sellAmount, uint256 buyAmount);
    event OrderCancelled(uint64 indexed batchId, bytes32 indexed commitment, address indexed trader, address sellToken, uint256 refunded);
    event BatchSettled(uint64 indexed batchId, uint256 matchCount, uint256 clearingPriceX18, uint8 indexed reason, uint256 referencePriceX18, bytes32 settlementHash);
    event BatchOpened(uint64 indexed batchId, uint64 openedAt);
    event AgentUpdateStarted(address indexed oldAgent, address indexed pendingAgent);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function referencePair() external view returns (address);
    function agent() external view returns (address);
    function pendingAgent() external view returns (address);
    function owner() external view returns (address);
    function currentBatchId() external view returns (uint64);
    function cancelDelaySeconds() external view returns (uint256);
    function maxReferenceDeviationBps() external view returns (uint256);

    function submitOrder(uint64 batchId, bytes32 commitment, address sellToken, uint256 sellAmount) external;
    function settleBatch(uint64 batchId, uint256 clearingPriceX18, uint8 reason, MatchedOrder[] calldata orders) external returns (uint256 matchCount, bytes32 settlementHash);
    function cancelOrder(bytes32 commitment) external;

    function hashOrder(OrderReveal calldata order) external view returns (bytes32);
    function getReferencePriceX18() external view returns (uint256 priceX18);
    function previewBuyAmount(address sellToken, uint256 sellAmount, uint256 clearingPriceX18) external view returns (uint256 buyAmount);
    function getOrder(bytes32 commitment) external view returns (address trader, uint64 batchId, address sellToken, uint256 sellAmount, uint64 submittedAt, uint8 status);
    function setAgent(address newAgent) external;
    function acceptAgent() external;
}
```

Production hardening in the current source requires `clearingPriceX18` to stay
inside `maxReferenceDeviationBps` of `getReferencePriceX18()` at settlement
time. `setAgent` starts a handoff by setting `pendingAgent`; the pending agent
must call `acceptAgent` before it can settle batches.

## Reason codes

| Code | Meaning | UI copy |
|---|---|---|
| 0 | depth-threshold | "enough orders queued" |
| 1 | imbalance | "buys and sells matched at market price" |
| 2 | notional-wait | "enough value queued" |
| 3 | max-interval | "time limit reached" |
| 4 | dex-spread-trigger | "market moved in traders' favor" |

## Agent local API (frontend ↔ agent)

CORS enabled for the frontend dev origin (http://localhost:5190 by default) and
configurable via env. Public deployments should bind the agent behind TLS and
enable `AGENT_REQUIRE_API_BEARER_TOKEN=true`, or enforce equivalent gateway
authentication before forwarding `POST /orders`.

```
POST /orders   — body: OrderReveal JSON (preimage), sent after the frontend
                 submits the commitment on-chain
GET  /status   — { currentBatchId, reasonCandidate, queueDepth, lastTx,
                 referencePriceX18, secondsSinceLastClear, agentState,
                 lastReason, depth, depthMin, notionalWaiting, notionalMax,
                 notionalUnit }
GET  /health   — process + RPC health
```

`/status` fields:

| Field | Type | Meaning |
|---|---|---|
| `currentBatchId` | `string \| null` | Current on-chain batch id as a decimal string, or `null` before the agent has a batch source. |
| `reasonCandidate` | `{ code: number, label: string } \| null` | Current local settlement trigger candidate from policy evaluation. |
| `queueDepth` | `number` | Current matched-queue depth. Kept for existing frontend consumers. |
| `lastTx` | `string \| null` | Last settlement transaction hash sent by this agent process. |
| `referencePriceX18` | `string \| null` | Current BOUSDT per WBOT reference price in X18. |
| `secondsSinceLastClear` | `number` | Seconds since the agent last confirmed a settlement it sent. |
| `agentState` | `string` | Current local agent state label. |
| `lastReason` | `number \| null` | Reason code from the most recent `BatchSettled` event the agent knows about, or `null` before any known settlement. |
| `depth` | `number` | Alias for the current matched-queue depth. |
| `depthMin` | `number` | Configured `DEPTH_MIN` threshold. |
| `notionalWaiting` | `string` | Current queued escrow notional as a decimal integer in `notionalUnit`. |
| `notionalMax` | `string` | Configured notional threshold as a decimal integer in `notionalUnit`. |
| `notionalUnit` | `string` | `token1X18`: token1-normalized X18 units. In the primary deployment, token1 is BOUSDT. |

Decision-trace fields (v3, additive):

| Field | Type | Meaning |
|---|---|---|
| `decision.side0X18` | `string` | Queued sell-side notional for token0 (WBOT), token1X18 units. |
| `decision.side1X18` | `string` | Queued sell-side notional for token1 (BOUSDT), token1X18 units. |
| `decision.imbalanceBps` | `number \| null` | Current side imbalance in bps (null when either side is empty). |
| `decision.dexSpreadOk` | `boolean` | Whether any queued order clears favorably vs the DEX reference at the configured spread. |
| `config.imbalanceBps` | `number` | Imbalance trigger threshold (bps). |
| `config.maxIntervalSeconds` | `number` | Liveness backstop interval. |
| `config.dexSpreadBps` | `number` | Favorable-spread trigger threshold (bps). |
| `config.maxClearingDeviationBps` | `number` | Max clearing-price deviation vs reference (bps). |

All optional for consumers; older agents may omit them.

## Deployment artifacts (BOT Chain testnet)

> This live demo instance was deployed **before** the immutable clearing-price
> deviation guard and the two-step `setAgent` / `acceptAgent` rotation were
> added to the contract. Its behaviour predates those checks; the interface
> above reflects current source. Fresh deployments include both — see
> [DEPLOY.md](DEPLOY.md).

| Item | Value |
|---|---|
| NyxBatchAuction | `0xc0405e50d1bf816b9fb1a741cb46941828c378ea` |
| Deploy tx | `0x4d255ffd772b5c0f7d399a9c6c0ce3accfc459eb36adb72332ba04f75b5e9917` |
| Deployer | `0xcED560b8C815116C05F8C1045F10f0339bE11D60` |
| Agent wallet | `0x253CbCB3A6221E2542516E5CB765C754bf3695b0` |
| Milestone settlement tx | `0x6a8a55dd60fa4e5863a2070036da113de74681f3f3f075cced4aee7d2c5f4683` (batch 1, reason 1 imbalance, clearing 9.66 BOUSDT/WBOT, sent by agent wallet, escrow fully drained) |

ABIs: after `forge build`, canonical ABIs are copied to `shared/abi/*.json`
for the frontend.
