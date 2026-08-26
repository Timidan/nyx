# Nyx Protocol and API Reference

The Solidity interface is canonical in
[`contracts/src/interfaces/INyxBatchAuction.sol`](../contracts/src/interfaces/INyxBatchAuction.sol).
This document records the cross-component contract used by the agent and web.

## Product truth

Nyx is a sealed-limit batch auction, not a dark pool. `OrderSubmitted` publishes
the trader, batch, sell token, sell amount, expiry, and commitment. The limit
(`minBuyAmount`) and salt are sent to the matching agent off-chain and become
public if included in settlement calldata.

The agent is the sole settlement authority in the current design. It cannot
violate a committed limit, mint a counterparty, exceed escrow, clear outside
the oracle band, settle an expired order, or use one wallet on both sides.

## Mainnet market facts

Read directly from BOT Chain on 2026-08-08:

| Item | Value |
|---|---|
| Chain | BOT Chain mainnet, `677` |
| RPC | `https://rpc.botchain.ai` |
| Explorer | `https://scan.botchain.ai` |
| WBOT | `0xD5452816194a3784dBa983426cCe7c122F4abd30`, 18 decimals |
| USDT | `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`, 6 decimals |
| V3 pool | `0x64F418471a1A7932a190E10da5A8551dB5AbeC05` |
| Pool orientation | token0 USDT, token1 WBOT |
| Fee / spacing | 3,000 / 60 |
| Observation cardinality | 1,024 |

The auction orientation is `token0 = WBOT`, `token1 = USDT`; prices are USDT
per WBOT scaled by `1e18`. Re-verify all market facts before deployment.

## Order structures

```solidity
struct OrderReveal {
    address trader;
    uint64 batchId;
    address sellToken;
    uint256 sellAmount;
    uint256 minBuyAmount;
    uint64 expiresAt;
    bytes32 salt;
}

struct MatchedOrder {
    bytes32 commitment;
    OrderReveal order;
}
```

The commitment is contract- and chain-bound:

```solidity
keccak256(
    abi.encode(
        address(auction),
        block.chainid,
        trader,
        batchId,
        sellToken,
        sellAmount,
        minBuyAmount,
        expiresAt,
        salt
    )
)
```

Clients should call `hashOrder` on the deployed contract rather than maintain a
second encoder.

## Core reads

```solidity
token0() -> address
token1() -> address
referenceOracle() -> address
referencePair() -> address // deprecated compatibility alias for the oracle
agent() -> address
pendingAgent() -> address
owner() -> address
pendingOwner() -> address
currentBatchId() -> uint64
cancelDelaySeconds() -> uint256
maxReferenceDeviationBps() -> uint256
paused() -> bool
allowlistEnabled() -> bool
allowedTraders(address) -> bool
riskLimits(address) -> (uint256 perOrder, uint256 perBatch, uint256 global)
totalEscrowed(address) -> uint256
batchEscrowed(uint64,address) -> uint256
claimableBalances(address token,address trader) -> uint256
getReferencePriceX18() -> uint256
previewBuyAmount(address,uint256,uint256) -> uint256
getOrder(bytes32) -> (
    address trader,
    uint64 batchId,
    address sellToken,
    uint256 sellAmount,
    uint64 submittedAt,
    uint64 expiresAt,
    uint8 status
)
```

Order statuses are `0 NONE`, `1 SUBMITTED`, `2 SETTLED`, `3 CANCELLED`.

## State changes

```solidity
submitOrder(
    uint64 batchId,
    bytes32 commitment,
    address sellToken,
    uint256 sellAmount,
    uint64 expiresAt
)

settleBatch(
    uint64 batchId,
    uint256 clearingPriceX18,
    uint8 reason,
    MatchedOrder[] orders
) -> (uint256 matchCount, bytes32 settlementHash)

cancelOrder(bytes32 commitment)
claimPayout(address token)

setAgent(address) / acceptAgent()
transferOwnership(address) / acceptOwnership()
setRiskLimits(address,uint256,uint256,uint256)
setAllowedTrader(address,bool)
setAllowlistEnabled(bool)
pause() / unpause()
```

`submitOrder` requires a future expiry no later than the fallback cancel delay,
an allowed trader when allowlisting is enabled, and all three token caps. Exact
token receipt is measured around `transferFrom`.

`settleBatch` requires the current batch, 1-64 matched orders, a valid reason,
unexpired and unique commitments, no trader on opposite sides, exact token
conservation, all user limits, and clearing price inside the oracle band.

`cancelOrder` is available when any condition is true: the order expired, its
batch is stale, or `submittedAt + cancelDelaySeconds` elapsed. Pause does not
disable cancellation or payout claims.

## Events

```solidity
OrderSubmitted(batchId, commitment, trader, sellToken, sellAmount, expiresAt)
OrderSettled(batchId, commitment, trader, sellToken, sellAmount, buyAmount)
OrderCancelled(batchId, commitment, trader, sellToken, refunded)
BatchSettled(
    batchId,
    matchCount,
    clearingPriceX18,
    reason,
    referencePriceX18,
    settlementHash
)
BatchOpened(batchId, openedAt)
PayoutDeferred(token, trader, amount)
PayoutClaimed(token, trader, amount)
AgentUpdateStarted(oldAgent, pendingAgent)
AgentUpdated(oldAgent, newAgent)
OwnershipTransferStarted(oldOwner, pendingOwner)
OwnershipTransferred(oldOwner, newOwner)
RiskLimitsUpdated(token, perOrder, perBatch, global)
TraderAllowlistUpdated(trader, allowed)
AllowlistModeUpdated(enabled)
PauseStateUpdated(paused)
```

Settlement reason codes:

| Code | Agent trigger |
|---|---|
| 0 | Queue depth threshold |
| 1 | Side balance condition |
| 2 | Queued notional threshold |
| 3 | Liveness interval |
| 4 | Favorable spread condition |

The reason is descriptive agent policy, not permission to bypass settlement
invariants.

## Oracle interface

```solidity
interface INyxPriceOracle {
    function baseToken() external view returns (address);
    function quoteToken() external view returns (address);
    function priceX18() external view returns (uint256);
}
```

`BotV3TwapOracle` additionally exposes `pool`, `twapWindow`, `minLiquidity`, and
`maxSpotTwapDeviationBps`. `priceX18` fails closed when current or harmonic-mean
liquidity is below the floor, observations are unavailable, spot/TWAP deviation
is too high, or normalized price is zero.

## Agent HTTP API

### `POST /orders`

Sent only after the commitment transaction confirms:

```json
{
  "trader": "0x...",
  "batchId": "1",
  "sellToken": "0x...",
  "sellAmount": "10000000000000000",
  "minBuyAmount": "100000",
  "expiresAt": "2000000000",
  "salt": "0x...32-bytes..."
}
```

The agent hashes the reveal through the auction, reads `getOrder`, and rejects
any mismatch, non-submitted status, wrong batch, or expiry. JSON integer fields
are decimal strings.

### `GET /health`

Re-runs deployment identity checks and reports process/RPC health,
`deploymentVerified`, pause state, and authority. Treat `ok: false` as
fail-closed.

### `GET /status`

Returns current batch, queue depth, reference price, last settlement tx/reason,
time since last clear, decision trace, thresholds, and local agent state.

### `GET /quote-requests`

Disabled with `404` unless `QUOTE_PROVIDER_BEARER_TOKEN` is configured. With a
valid server-to-server bearer token it returns queued public-flow projections:

```json
[
  {
    "commitment": "0x...",
    "batchId": "1",
    "sellToken": "0x...",
    "sellAmount": "10000000000000000",
    "expiresAt": "2000000000"
  }
]
```

The provider feed deliberately excludes trader, `minBuyAmount`, and salt. A
provider submits its own independent complementary order; the endpoint does not
delegate custody, execute a hedge, or guarantee a fill.
