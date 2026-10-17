import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.ts";
import { configuration, storedConfiguration } from "../src/configuration.ts";
import { FREE_LOGS_PRICING_CHANGE } from "../src/control.ts";
import type { Api } from "../src/api.ts";
import {
  NOW,
  config,
  environment,
  Memory,
  Cloud,
  analytics,
} from "./helpers.ts";

function fresh(cloud: Cloud, now: number, requests = 0) {
  cloud.data = analytics(requests);
  const account = cloud.data.viewer.accounts[0];
  account.heartbeat[0].dimensions.datetime = new Date(
    now - 60000,
  ).toISOString();
  account.r2Recent[0].dimensions.datetime = new Date(
    now - 3600000,
  ).toISOString();
}

test("only explicit null disables review expiry; invalid, omitted and elapsed dates still fail", () => {
  const c = config();
  c.reviewedUntil = null;
  assert.equal(configuration(environment(c), NOW).reviewedUntil, null);
  assert.equal(storedConfiguration(c).reviewedUntil, null);
  for (const value of [
    undefined,
    false,
    0,
    "",
    "never",
    "2026-10-15T00:00:00Z",
  ])
    assert.throws(() =>
      configuration(environment({ ...c, reviewedUntil: value } as any), NOW),
    );
  // Explicit billing boundaries still guard against silently resetting spend.
  assert.throws(() =>
    configuration(environment(c), Date.parse(c.windows.r2.end)),
  );
});

test("removing the review timer retains known charges and remains armed past its former deadline", async () => {
  const c = config(),
    cloud = new Cloud(),
    store = new Memory();
  c.reviewedUntil = "2026-10-23T00:00:00Z";
  fresh(cloud, NOW, 128);
  const first = await new Engine(
    store,
    environment(c),
    cloud.call,
    cloud.call,
  ).tick(NOW);
  assert.equal(first.latched, false);
  c.reviewedUntil = null;
  const later = Date.parse("2026-10-24T18:00:00Z");
  fresh(cloud, later);
  const state = await new Engine(
    store,
    environment(c),
    cloud.call,
    cloud.call,
  ).tick(later);
  assert.equal(state.latched, false);
  assert.equal(state.config?.enabled, true);
  assert.equal(state.config?.reviewedUntil, null);
  assert.deepEqual(state.errors, []);
  assert.equal(state.cost?.microUsd, first.cost?.microUsd);
  assert.equal(cloud.sub.enabled, true);
  assert.deepEqual(cloud.mutations, []);
});

test("no review expiry preserves budget cutoff, partial-action retry and the recovery cost floor", async () => {
  const c = config(),
    cloud = new Cloud(),
    store = new Memory();
  c.reviewedUntil = null;
  fresh(cloud, NOW, 267);
  cloud.failed.add("/subdomain");
  const engine = new Engine(store, environment(c), cloud.call, cloud.call);
  let state = await engine.tick(NOW);
  assert.equal(state.reason, "monitor/coverage failure");
  assert.ok(state.cost!.microUsd >= c.cutoff);
  assert.equal(state.latched, true);
  assert.ok(state.errors.length);
  cloud.failed.clear();
  state = await engine.tick(NOW + 60000);
  assert.equal(state.latched, true);
  assert.equal(cloud.sub.enabled, false);
  assert.deepEqual(cloud.schedules, []);
  assert.deepEqual(state.errors, []);
  fresh(cloud, NOW + 60000);
  await assert.rejects(
    engine.recoveryCheck(state.cutoffAt!, NOW + 60000),
    /cost remains/,
  );
});

test("without a review deadline budget alone still cuts off and analytics loss still fails closed", async () => {
  for (const failure of [false, true]) {
    const c = config(),
      cloud = new Cloud(),
      store = new Memory();
    c.reviewedUntil = null;
    await new Engine(store, environment(c), cloud.call, cloud.call).tick(NOW);
    fresh(cloud, NOW + 60000, 267);
    if (failure) cloud.failed.add("/graphql");
    const state = await new Engine(
      store,
      environment(c),
      cloud.call,
      cloud.call,
    ).tick(NOW + 60000);
    assert.equal(state.latched, true);
    assert.equal(
      state.reason,
      failure ? "monitor/coverage failure" : "estimated cutoff reached",
    );
    assert.equal(cloud.sub.enabled, false);
    assert.deepEqual(cloud.schedules, []);
  }
});

test("review expiry removal never releases an existing cutoff; explicit recovery still succeeds", async () => {
  const c = config(),
    cloud = new Cloud(),
    store = new Memory();
  const cutoff = await new Engine(
    store,
    environment(c),
    cloud.call,
    cloud.call,
  ).tick(NOW, true);
  c.reviewedUntil = null;
  const engine = new Engine(store, environment(c), cloud.call, cloud.call);
  assert.equal((await engine.tick(NOW + 60000)).latched, true);
  assert.equal(cloud.sub.enabled, false);
  assert.equal(
    (await engine.recoveryCheck(cutoff.cutoffAt!, NOW + 60000)).ready,
    true,
  );
  cloud.sub = { enabled: true, previews_enabled: true };
  cloud.schedules = [{ cron: "* * * * *" }];
  cloud.rules = [];
  const active = await engine.rearm(cutoff.cutoffAt!, NOW + 60000);
  assert.equal(active.latched, false);
  assert.equal(active.config?.enabled, true);
  assert.equal(active.config?.reviewedUntil, null);
  assert.ok(await store.get("previous-cutoff"));
});

test("known log repricing invalidates the inventory cache even without a review deadline", async () => {
  const c = config(),
    cloud = new Cloud(),
    store = new Memory();
  c.plan = "free";
  c.fixed = 0;
  c.reviewedUntil = null;
  for (const p of ["workers", "d1", "r2"] as const)
    c.windows[p] = {
      start: "2026-11-16T00:00:00Z",
      end: "2026-12-16T00:00:00Z",
    };
  const read: Api = async <T>(path: string, body?: unknown, method?: string) =>
    path.endsWith("/settings")
      ? ({
          usage_model: "standard",
          bindings: [],
          observability: { enabled: true, traces: { enabled: false } },
        } as T)
      : cloud.call<T>(path, body, method);
  const engine = new Engine(store, environment(c), read, cloud.call);
  fresh(cloud, FREE_LOGS_PRICING_CHANGE - 60000);
  assert.equal(
    (await engine.tick(FREE_LOGS_PRICING_CHANGE - 60000)).latched,
    false,
  );
  fresh(cloud, FREE_LOGS_PRICING_CHANGE);
  const state = await engine.tick(FREE_LOGS_PRICING_CHANGE);
  assert.equal(state.latched, true);
  assert.ok(state.gaps.some((s) => s.includes("logs, traces")));
  assert.equal(cloud.sub.enabled, false);
});
