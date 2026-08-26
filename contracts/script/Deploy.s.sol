// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { NyxBatchAuction } from "../src/NyxBatchAuction.sol";
import { BotV3TwapOracle } from "../src/BotV3TwapOracle.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address value);
    function envOr(string calldata name, address defaultValue) external view returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256 value);
    function envUint(string calldata name) external view returns (uint256 value);
    function addr(uint256 privateKey) external pure returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct RiskLimits {
        uint256 perOrder;
        uint256 perBatch;
        uint256 global;
    }

    struct DeployConfig {
        uint256 deployerPrivateKey;
        address deployer;
        address wbot;
        address bousdt;
        address v3Pool;
        address v3Factory;
        address initialAgent;
        address owner;
        address initialAllowedTrader;
        address initialQuoteProvider;
        uint32 twapWindow;
        uint128 minV3Liquidity;
        uint16 maxSpotTwapDeviationBps;
        uint256 maxClearingDeviationBps;
        uint256 cancelDelaySeconds;
        RiskLimits wbotLimits;
        RiskLimits bousdtLimits;
    }

    function run() external returns (BotV3TwapOracle oracle, NyxBatchAuction auction) {
        DeployConfig memory config = _loadConfig();

        vm.startBroadcast(config.deployerPrivateKey);
        oracle = new BotV3TwapOracle(
            config.v3Pool,
            config.v3Factory,
            config.wbot,
            config.bousdt,
            config.twapWindow,
            config.minV3Liquidity,
            config.maxSpotTwapDeviationBps
        );
        auction = new NyxBatchAuction(
            config.wbot,
            config.bousdt,
            address(oracle),
            config.initialAgent,
            config.cancelDelaySeconds,
            config.maxClearingDeviationBps
        );
        auction.setRiskLimits(
            config.wbot,
            config.wbotLimits.perOrder,
            config.wbotLimits.perBatch,
            config.wbotLimits.global
        );
        auction.setRiskLimits(
            config.bousdt,
            config.bousdtLimits.perOrder,
            config.bousdtLimits.perBatch,
            config.bousdtLimits.global
        );
        if (config.initialAllowedTrader != address(0)) {
            auction.setAllowedTrader(config.initialAllowedTrader, true);
        }
        if (config.initialQuoteProvider != address(0)) {
            auction.setAllowedTrader(config.initialQuoteProvider, true);
        }
        if (config.owner != config.deployer) auction.transferOwnership(config.owner);
        vm.stopBroadcast();

        // This read fails the deployment simulation when the pool cannot serve
        // the configured observation window, liquidity floor, or deviation guard.
        // The auction deliberately remains paused after a successful deployment.
        auction.getReferencePriceX18();
        require(auction.paused(), "auction must start paused");
    }

    function _loadConfig() internal view returns (DeployConfig memory config) {
        config.deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        config.deployer = vm.addr(config.deployerPrivateKey);
        config.wbot = vm.envAddress("WBOT");
        config.bousdt = vm.envAddress("BOUSDT");
        config.v3Pool = vm.envAddress("BOT_V3_POOL");
        config.v3Factory = vm.envAddress("BOT_V3_FACTORY");
        config.initialAgent = vm.envAddress("AGENT_ADDRESS");
        config.owner = vm.envAddress("OWNER_ADDRESS");
        config.initialAllowedTrader = vm.envOr("INITIAL_ALLOWED_TRADER", address(0));
        config.initialQuoteProvider = vm.envOr("INITIAL_QUOTE_PROVIDER", address(0));

        uint256 value = vm.envOr("TWAP_WINDOW_SECONDS", uint256(15 minutes));
        require(value <= type(uint32).max, "TWAP_WINDOW_SECONDS exceeds uint32");
        // The preceding bound check makes this conversion exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        config.twapWindow = uint32(value);

        value = vm.envUint("MIN_V3_LIQUIDITY");
        require(value <= type(uint128).max, "MIN_V3_LIQUIDITY exceeds uint128");
        // The preceding bound check makes this conversion exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        config.minV3Liquidity = uint128(value);

        value = vm.envOr("MAX_SPOT_TWAP_DEVIATION_BPS", uint256(500));
        require(value <= type(uint16).max, "MAX_SPOT_TWAP_DEVIATION_BPS exceeds uint16");
        // The preceding bound check makes this conversion exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        config.maxSpotTwapDeviationBps = uint16(value);

        config.maxClearingDeviationBps = vm.envOr("MAX_CLEARING_DEVIATION_BPS", uint256(1_000));
        config.cancelDelaySeconds = vm.envOr("CANCEL_DELAY_SECONDS", uint256(2 days));
        config.wbotLimits =
            _loadRiskLimits("WBOT_PER_ORDER_CAP", "WBOT_PER_BATCH_CAP", "WBOT_GLOBAL_CAP");
        config.bousdtLimits =
            _loadRiskLimits("BOUSDT_PER_ORDER_CAP", "BOUSDT_PER_BATCH_CAP", "BOUSDT_GLOBAL_CAP");
    }

    function _loadRiskLimits(
        string memory perOrderName,
        string memory perBatchName,
        string memory globalName
    ) internal view returns (RiskLimits memory limits) {
        limits.perOrder = vm.envUint(perOrderName);
        limits.perBatch = vm.envUint(perBatchName);
        limits.global = vm.envUint(globalName);
    }
}
