// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Normalized quote-token price for one whole base token, scaled by 1e18.
interface INyxPriceOracle {
    function baseToken() external view returns (address);
    function quoteToken() external view returns (address);
    function priceX18() external view returns (uint256);
}
