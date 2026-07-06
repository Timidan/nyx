// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { NyxBatchAuction } from "../src/NyxBatchAuction.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function addr(uint256 privateKey) external returns (address);
}

contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (NyxBatchAuction auction) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address wbot = vm.envAddress("WBOT");
        address bousdt = vm.envAddress("BOUSDT");
        address referencePair = vm.envAddress("BOT_DEX_PAIR");

        vm.startBroadcast(deployerPrivateKey);
        auction = new NyxBatchAuction(wbot, bousdt, referencePair, deployer, 2 days);
        vm.stopBroadcast();
    }
}
