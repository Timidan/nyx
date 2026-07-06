# Nyx — Frozen Interfaces (v1, Jul 6)

Locked after Codex ideation. Backend implements exactly this; frontend wires
against exactly this. Changes require updating this file first.

## Scope decision (recorded)

**No ZK.** Sealed-bid commit-reveal batch auction driven by an autonomous
agent. Rationale: the Crossed ZK codebase the original plan assumed does not
exist; ~2 days remain; ZK is not a rubric item; the track is AI Agent.
Privacy claim stated honestly: **orders are sealed from public chain observers
until settlement** (the agent sees preimages; single-agent settlement is
centralized for the demo; `cancelOrder` mitigates stuck funds).

## Chain facts (verified on-chain Jul 6)

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

Integration hierarchy: **primary** — auction trades WBOT/BOUSDT itself and
reads the reference price from the real BOT DEX pair. **Fallback** (if
acquiring BOUSDT or wrapping WBOT proves fragile; timebox ~90 min) — auction
trades two FaucetERC20 demo tokens via NyxAMMPair, but the agent still reads
the real BOT DEX pair price every cycle as its reference input, stated
honestly in the write-up.

Implementation decision (Jul 6): **primary selected; fallback not used.**
`NyxBatchAuction.token0 = WBOT`, `token1 = BOUSDT`, and `referencePair` is the
real BOUSDT/WBOT pair above. `clearingPriceX18` means normalized BOUSDT per
WBOT. Read-only verification found BOUSDT has 6 decimals, WBOT has 18 decimals,
and the pair reserves were about 98.531658 BOUSDT / 10.160298162694176879 WBOT
at verification time. WBOT bytecode contains WETH9-style `deposit()` and
`withdraw(uint256)` selectors; `WETH9()` on the router returns the WBOT
address. The published `SwapRouter` is verified as a Uniswap V3 SwapRouter, not
a UniV2 router: `getAmountsOut` reverts, while V3 WBOT/BOUSDT pools exist at
fee tiers 500, 3000, and 10000. Demo token prep should use tiny WBOT wraps and
V3 `exactInputSingle` swaps; BOUSDT `mint` is role-restricted.

## Contracts

### IFaucetERC20 (fallback path only)

```solidity
interface IFaucetERC20 {
    event FaucetClaimed(address indexed account, uint256 amount);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function faucet(address to) external;
    function mint(address to, uint256 amount) external;
}
```

### INyxAMMPair (fallback path only)

```solidity
interface INyxAMMPair {
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function quoteToken1PerToken0() external view returns (uint256 priceX18);
    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 liquidity);
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to) external returns (uint256 amountOut);
}
```

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
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function referencePair() external view returns (address);
    function agent() external view returns (address);
    function owner() external view returns (address);
    function currentBatchId() external view returns (uint64);
    function cancelDelaySeconds() external view returns (uint256);

    function submitOrder(uint64 batchId, bytes32 commitment, address sellToken, uint256 sellAmount) external;
    function settleBatch(uint64 batchId, uint256 clearingPriceX18, uint8 reason, MatchedOrder[] calldata orders) external returns (uint256 matchCount, bytes32 settlementHash);
    function cancelOrder(bytes32 commitment) external;

    function hashOrder(OrderReveal calldata order) external view returns (bytes32);
    function getReferencePriceX18() external view returns (uint256 priceX18);
    function previewBuyAmount(address sellToken, uint256 sellAmount, uint256 clearingPriceX18) external view returns (uint256 buyAmount);
    function getOrder(bytes32 commitment) external view returns (address trader, uint64 batchId, address sellToken, uint256 sellAmount, uint64 submittedAt, uint8 status);
    function setAgent(address newAgent) external;
}
```

## Reason codes (frozen)

| Code | Meaning | UI copy |
|---|---|---|
| 0 | depth-threshold | "depth threshold" |
| 1 | imbalance | "buy/sell imbalance at DEX midpoint" |
| 2 | notional-wait | "notional wait limit" |
| 3 | max-interval | "max interval" |
| 4 | dex-spread-trigger | "favorable DEX spread" |

## Agent local API (frontend ↔ agent)

CORS enabled for the frontend dev origin (http://localhost:5173) and
configurable via env.

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

## Deployment artifacts (fill in when deployed)

| Item | Value |
|---|---|
| NyxBatchAuction | _pending_ |
| Deployer | `0xcED560b8C815116C05F8C1045F10f0339bE11D60` |
| Agent wallet | `0x253CbCB3A6221E2542516E5CB765C754bf3695b0` |
| Milestone settlement tx | _pending_ |

ABIs: after `forge build`, canonical ABIs are copied to `shared/abi/*.json`
for the frontend.
