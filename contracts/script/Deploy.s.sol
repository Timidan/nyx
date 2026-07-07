// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { NyxBatchAuction } from "../src/NyxBatchAuction.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256 value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (NyxBatchAuction auction) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address wbot = vm.envAddress("WBOT");
        address bousdt = vm.envAddress("BOUSDT");
        address referencePair = vm.envAddress("BOT_DEX_PAIR");
        address initialAgent = vm.envAddress("AGENT_ADDRESS");
        uint256 maxClearingDeviationBps = vm.envOr("MAX_CLEARING_DEVIATION_BPS", uint256(1_000));
        uint256 cancelDelaySeconds = vm.envOr("CANCEL_DELAY_SECONDS", uint256(2 days));

        vm.startBroadcast(deployerPrivateKey);
        auction = new NyxBatchAuction(
            wbot, bousdt, referencePair, initialAgent, cancelDelaySeconds, maxClearingDeviationBps
        );
        vm.stopBroadcast();
    }
}
