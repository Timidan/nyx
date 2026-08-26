// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The narrow Uniswap math surface Nyx needs for V3 oracle quotes.
/// @dev Derived from Uniswap v4-core TickMath and FullMath (MIT). Only
///      getSqrtPriceAtTick and full-precision mulDiv are retained.
library V3OracleMath {
    int24 internal constant MIN_TICK = -887_272;
    int24 internal constant MAX_TICK = 887_272;

    error InvalidTick(int24 tick);
    error MulDivOverflow();
    error DivisionByZero();

    function getSqrtPriceAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
            uint256 absTick;
            if (tick < 0) {
                // An int24 promoted to int256 can be negated without overflow.
                // forge-lint: disable-next-line(unsafe-typecast)
                absTick = uint256(-int256(tick));
            } else {
                // This branch proves the promoted int24 is non-negative.
                // forge-lint: disable-next-line(unsafe-typecast)
                absTick = uint256(int256(tick));
            }
            if (absTick > 887_272) revert InvalidTick(tick);

            uint256 ratio = absTick & 0x1 != 0
                ? 0xfffcb933bd6fad37aa2d162d1a594001
                : 0x100000000000000000000000000000000;
            if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
            if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
            if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
            if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
            if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
            if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
            if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
            if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
            if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
            if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
            if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
            if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
            if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
            if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
            if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
            if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
            if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
            if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
            if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

            if (tick > 0) ratio = type(uint256).max / ratio;
            sqrtPriceX96 = uint160((ratio >> 32) + (ratio & type(uint32).max == 0 ? 0 : 1));
        }
    }

    function quoteAtTick(int24 tick, uint128 baseAmount, address baseToken, address quoteToken)
        internal
        pure
        returns (uint256 quoteAmount)
    {
        uint160 sqrtRatioX96 = getSqrtPriceAtTick(tick);
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            return baseToken < quoteToken
                ? mulDiv(ratioX192, baseAmount, 1 << 192)
                : mulDiv(1 << 192, baseAmount, ratioX192);
        }

        uint256 ratioX128 = mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
        return baseToken < quoteToken
            ? mulDiv(ratioX128, baseAmount, 1 << 128)
            : mulDiv(1 << 128, baseAmount, ratioX128);
    }

    function mulDiv(uint256 a, uint256 b, uint256 denominator)
        internal
        pure
        returns (uint256 result)
    {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly ("memory-safe") {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            if (prod1 == 0) {
                if (denominator == 0) revert DivisionByZero();
                return prod0 / denominator;
            }
            if (denominator <= prod1) revert MulDivOverflow();

            uint256 remainder;
            assembly ("memory-safe") {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            uint256 twos = denominator & (0 - denominator);
            assembly ("memory-safe") {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;

            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            return prod0 * inverse;
        }
    }
}
