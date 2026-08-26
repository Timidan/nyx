// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { BotV3TwapOracle } from "../src/BotV3TwapOracle.sol";

interface VmMainnetFork {
    function envOr(string calldata name, string calldata defaultValue)
        external
        view
        returns (string memory value);
    function createSelectFork(string calldata urlOrAlias) external returns (uint256 forkId);
}

contract BotV3TwapOracleMainnetTest {
    VmMainnetFork private constant vm =
        VmMainnetFork(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant WBOT = 0xD5452816194a3784dBa983426cCe7c122F4abd30;
    address private constant USDT = 0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C;
    address private constant V3_POOL = 0x64F418471a1A7932a190E10da5A8551dB5AbeC05;
    address private constant V3_FACTORY = 0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419;

    function testMainnetPoolServesConfiguredTwapWhenRpcIsProvided() external {
        string memory rpcUrl = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);

        // Constructing against the published BDEX factory proves on live state
        // that the configured pool is the canonical WBOT/USDT pool, not a
        // sibling fee tier or a clone.
        BotV3TwapOracle oracle =
            new BotV3TwapOracle(V3_POOL, V3_FACTORY, WBOT, USDT, 15 minutes, 9e18, 500);
        uint256 priceX18 = oracle.priceX18();

        require(priceX18 > 0, "zero live TWAP");
        require(oracle.baseToken() == WBOT, "wrong live base");
        require(oracle.quoteToken() == USDT, "wrong live quote");
        require(oracle.factory() == V3_FACTORY, "wrong live factory");
    }
}
