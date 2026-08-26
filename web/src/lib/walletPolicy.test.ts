import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  requireExpectedChainId,
  upsertDiscoveredWallet,
  type DiscoveredWallet,
} from "./walletPolicy.ts";

const first: DiscoveredWallet = {
  id: "wallet-1",
  name: "First",
  provider: { request: async () => null },
};

describe("upsertDiscoveredWallet", () => {
  it("adds a newly announced wallet", () => {
    assert.deepEqual(upsertDiscoveredWallet([], first), [first]);
  });

  it("replaces a repeated EIP-6963 announcement without duplicating the picker", () => {
    const refreshed = { ...first, name: "First refreshed" };
    assert.deepEqual(upsertDiscoveredWallet([first], refreshed), [refreshed]);
  });

  it("keeps independently announced wallets", () => {
    const second = { ...first, id: "wallet-2", name: "Second" };
    assert.deepEqual(upsertDiscoveredWallet([first], second), [first, second]);
  });
});

describe("requireExpectedChainId", () => {
  it("accepts the wallet's hexadecimal chain id", () => {
    assert.equal(requireExpectedChainId("0x2a5", 677), 677);
  });

  it("rejects a provider that reports success without switching", () => {
    assert.throws(() => requireExpectedChainId("0x3c8", 677), /still on chain 968/i);
  });
});
