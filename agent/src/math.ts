const X18 = 1_000000000000000000n;

export function toX18(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals < 18) return amount * 10n ** BigInt(18 - decimals);
  return amount / 10n ** BigInt(decimals - 18);
}

export function fromX18(amountX18: bigint, decimals: number): bigint {
  if (decimals === 18) return amountX18;
  if (decimals < 18) return amountX18 / 10n ** BigInt(18 - decimals);
  return amountX18 * 10n ** BigInt(decimals - 18);
}

export function previewBuyAmount(params: {
  sellToken: string;
  sellAmount: bigint;
  clearingPriceX18: bigint;
  token0: string;
  token1: string;
  token0Decimals: number;
  token1Decimals: number;
}): bigint {
  const sellToken = params.sellToken.toLowerCase();
  const token0 = params.token0.toLowerCase();
  const token1 = params.token1.toLowerCase();

  if (params.clearingPriceX18 <= 0n) {
    throw new Error("clearing price must be positive");
  }

  if (sellToken === token0) {
    const sellX18 = toX18(params.sellAmount, params.token0Decimals);
    return fromX18((sellX18 * params.clearingPriceX18) / 1_000000000000000000n, params.token1Decimals);
  }

  if (sellToken === token1) {
    const sellX18 = toX18(params.sellAmount, params.token1Decimals);
    return fromX18((sellX18 * X18) / params.clearingPriceX18, params.token0Decimals);
  }

  throw new Error(`unsupported sell token ${params.sellToken}`);
}

export function absDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}
