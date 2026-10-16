import test from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, apiFailure, type Api } from "../src/api.ts";
import { Engine } from "../src/engine.ts";
import { Cloud, config, environment, Memory, NOW } from "./helpers.ts";

test("API diagnostics expose only validated HTTP status, never arbitrary secrets", () => {
  assert.equal(apiFailure(new ApiError(401)), "Cloudflare HTTP 401");
  assert.equal(apiFailure(new ApiError(403)), "Cloudflare HTTP 403");
  assert.equal(
    apiFailure(new Error("private-token-in-error")),
    "request/response failed",
  );
  assert.equal(
    apiFailure(new ApiError("private-token" as unknown as number)),
    "request/response failed",
  );
  assert.equal(
    apiFailure({ status: 403, message: "private response body" }),
    "request/response failed",
  );
});

test("malformed API token values fail before fetch without exposing the value", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({ success: true, result: [] });
  }) as typeof fetch;
  for (const token of [
    "private-token\n",
    "Bearer private-token",
    "private-🔐-token",
  ]) {
    await assert.rejects(
      api(token, fetcher)("/example"),
      (error) => apiFailure(error) === "API token format invalid",
    );
  }
  assert.equal(calls, 0);
  assert.equal(
    apiFailure(new Error("inventory truncated")),
    "inventory truncated",
  );
  assert.equal(
    apiFailure(new TypeError("private-token")),
    "fetch/header type error",
  );
});

test("observe mode reports read-token rejection without invoking control", async () => {
  const c = config();
  c.plan = "free";
  c.fixed = 0;
  c.enabled = false;
  c.zones = [];
  let controlCalls = 0;
  const read: Api = async () => {
    throw new ApiError(401);
  };
  const control: Api = async () => {
    controlCalls++;
    throw Error("control must not run");
  };
  const state = await new Engine(
    new Memory(),
    environment(c),
    read,
    control,
  ).tick(NOW);
  assert.equal(state.latched, false);
  assert.equal(controlCalls, 0);
  assert.ok(
    state.errors.some((message) => message.includes("Cloudflare HTTP 401")),
  );
  assert.ok(
    state.gaps.some((message) =>
      message.includes(
        "subdomain unavailable or invalid (Cloudflare HTTP 401)",
      ),
    ),
  );
});

test("observe mode retries failed inventory on the next tick after access recovers", async () => {
  const c = config();
  c.enabled = false;
  const cloud = new Cloud();
  cloud.failed.add("/subdomain");
  const engine = new Engine(
    new Memory(),
    environment(c),
    cloud.call,
    cloud.call,
  );
  const failed = await engine.tick(NOW);
  assert.ok(failed.errors.includes("entrypoint/cost coverage incomplete"));
  cloud.failed.clear();
  const recovered = await engine.tick(NOW + 60000);
  assert.deepEqual(recovered.errors, []);
  assert.equal(recovered.lastInventory, new Date(NOW + 60000).toISOString());
  assert.equal(recovered.latched, false);
  assert.deepEqual(cloud.mutations, []);
});
