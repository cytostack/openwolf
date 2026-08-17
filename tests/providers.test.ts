import { test, describe } from "node:test";
import * as assert from "node:assert";

import {
  resolveProviderConfig,
  getProvider,
  getEndpoint,
  PROVIDERS,
  DEFAULT_REGION,
} from "../src/daemon/providers.ts";

describe("inference provider registry", () => {
  test("no provider selected resolves to null", () => {
    assert.strictEqual(resolveProviderConfig(null), null);
    assert.strictEqual(resolveProviderConfig(undefined), null);
    assert.strictEqual(resolveProviderConfig({}), null);
  });

  test("resolves the default region and model when only id is given", () => {
    const resolved = resolveProviderConfig({ id: "minimax" });
    assert.ok(resolved);
    assert.strictEqual(resolved!.provider.name, "MiniMax");
    assert.strictEqual(resolved!.endpoint.region, DEFAULT_REGION);
    assert.strictEqual(resolved!.model, PROVIDERS.minimax.defaultModel);
    assert.strictEqual(
      resolved!.endpoint.anthropicBaseUrl,
      "https://api.minimax.io/anthropic"
    );
  });

  test("id lookup is case-insensitive and trims whitespace", () => {
    assert.ok(getProvider("  MiniMax "));
    const resolved = resolveProviderConfig({ id: "MINIMAX" });
    assert.strictEqual(resolved!.provider.name, "MiniMax");
  });

  test("resolves the CN region endpoint", () => {
    const resolved = resolveProviderConfig({ id: "minimax", region: "cn_zh" });
    assert.strictEqual(
      resolved!.endpoint.anthropicBaseUrl,
      "https://api.minimaxi.com/anthropic"
    );
    assert.strictEqual(
      resolved!.endpoint.openaiBaseUrl,
      "https://api.minimaxi.com/v1"
    );
  });

  test("both regions are registered for minimax", () => {
    const regions = PROVIDERS.minimax.endpoints.map((e) => e.region).sort();
    assert.deepStrictEqual(regions, ["cn_zh", "global_en"]);
  });

  test("exposes complete metadata for both models", () => {
    const byId = new Map(PROVIDERS.minimax.models.map((model) => [model.id, model]));
    assert.deepStrictEqual(byId.get("MiniMax-M3"), {
      id: "MiniMax-M3",
      contextWindow: 1_000_000,
      pricingUsdPerMillionTokens: {
        input: 0.6,
        output: 2.4,
        cacheRead: 0.12,
        cacheWrite: null,
      },
      inputModalities: ["text", "image", "video"],
      thinking: ["adaptive", "disabled"],
    });
    assert.deepStrictEqual(byId.get("MiniMax-M2.7"), {
      id: "MiniMax-M2.7",
      contextWindow: 204_800,
      pricingUsdPerMillionTokens: {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.06,
        cacheWrite: 0.375,
      },
      inputModalities: ["text"],
      thinking: ["always_on"],
    });
  });

  test("accepts an explicitly named supported model", () => {
    const resolved = resolveProviderConfig({ id: "minimax", model: "MiniMax-M2.7" });
    assert.strictEqual(resolved!.model, "MiniMax-M2.7");
  });

  test("throws on unknown provider", () => {
    assert.throws(() => resolveProviderConfig({ id: "nope" }), /Unknown inference provider/);
  });

  test("throws on unknown region", () => {
    assert.throws(
      () => resolveProviderConfig({ id: "minimax", region: "mars" }),
      /Unknown region/
    );
  });

  test("throws on unknown model", () => {
    assert.throws(
      () => resolveProviderConfig({ id: "minimax", model: "MiniMax-Z9" }),
      /Unknown model/
    );
  });

  test("getEndpoint returns undefined for an unknown region", () => {
    assert.strictEqual(getEndpoint(PROVIDERS.minimax, "nowhere"), undefined);
  });
});
