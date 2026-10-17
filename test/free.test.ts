import test from "node:test";
import assert from "node:assert/strict";
import { configuration, storedConfiguration } from "../src/configuration.ts";
import {
  estimate,
  quotaWarning,
  validateEstimate,
  type Usage,
} from "../src/cost.ts";
import { Engine, type State } from "../src/engine.ts";
import { inventory } from "../src/control.ts";
import { metrics, query } from "../src/metrics.ts";
import {
  NOW,
  config,
  environment,
  Cloud,
  Memory,
  analytics,
} from "./helpers.ts";
import type { Api } from "../src/api.ts";

const free = () => ({ ...config(), plan: "free" as const, fixed: 0 });
const zero: Usage = {
  requests: 0,
  cpuMs: 0,
  rowsRead: 0,
  rowsWritten: 0,
  d1Bytes: 0,
  r2A: 0,
  r2B: 0,
  r2Bytes: 0,
};

test("Free requires explicit selection; missing legacy plan remains Paid", () => {
  const c = free();
  assert.equal(configuration(environment(c), NOW).fixed, 0);
  const legacy = { ...config() } as any;
  delete legacy.plan;
  assert.equal(configuration(environment(legacy), NOW).plan, "paid");
  assert.equal(storedConfiguration(legacy).plan, "paid");
  legacy.fixed = 0;
  assert.throws(() => configuration(environment(legacy), NOW));
  for (const plan of ["enterprise", null, false, {}])
    assert.throws(() => configuration(environment({ ...c, plan } as any), NOW));
});

test("Free never invents Workers/D1 overage or subscription charges", () => {
  const cost = estimate(
    {
      ...zero,
      requests: 15_000_000,
      cpuMs: Number.MAX_SAFE_INTEGER,
      rowsRead: 60_000_000_000,
      rowsWritten: 60_000_000,
      d1Bytes: 6_000_000_000,
    },
    0,
    1_000_000,
    "free",
  );
  assert.equal(cost.microUsd, 1_000_000);
  for (const key of [
    "fixed",
    "requests",
    "cpu",
    "d1Read",
    "d1Write",
    "d1Storage",
  ])
    assert.equal(cost.items[key], 0);
  assert.match(cost.coverage, /service limits, no overage charges/);
  assert.equal(cost.freeQuota?.requests.limit, 100_000);
  assert.equal(cost.freeQuota?.d1Read.limit, 5_000_000);
  assert.equal(cost.freeQuota?.d1Write.limit, 100_000);
});

test("R2 Standard charges and configured non-Workers fixed fees survive Free mode", () => {
  const usage = {
    ...zero,
    r2A: 1_000_001,
    r2B: 10_000_001,
    r2Bytes: 10_000_000_001,
  };
  const paid = estimate(usage, 2_000_000, 1_000_000, "paid");
  const cost = estimate(usage, 2_000_000, 1_000_000, "free");
  for (const key of ["fixed", "reserve", "r2A", "r2B", "r2Storage"])
    assert.equal(cost.items[key], paid.items[key]);
  assert.equal(cost.microUsd, 7_875_000);
});

test("Free still rejects malformed usage, pricing plans and saved quota records", () => {
  for (const key of Object.keys(zero))
    for (const value of [undefined, NaN, Infinity, -1])
      assert.throws(() =>
        estimate({ ...zero, [key]: value } as Usage, 0, 0, "free"),
      );
  assert.throws(() => estimate(zero, 0, 0, "enterprise" as any));
  const cost = estimate(zero, 0, 0, "free");
  validateEstimate(cost);
  for (const invalid of [
    { ...cost, freeQuota: undefined },
    { ...cost, plan: "enterprise" },
    {
      ...cost,
      freeQuota: { ...cost.freeQuota, requests: { used: -1, limit: 100_000 } },
    },
    {
      ...cost,
      freeQuota: { ...cost.freeQuota, requests: { used: 0, limit: 1_000_000 } },
    },
  ])
    assert.throws(() => validateEstimate(invalid as any));
});

test("Free quota advisory starts at 80 percent independently of dollar cutoff", () => {
  for (const [key, limit] of [
    ["requests", 100_000],
    ["rowsRead", 5_000_000],
    ["rowsWritten", 100_000],
    ["d1Bytes", 5_000_000_000],
  ] as const) {
    assert.equal(
      quotaWarning(estimate({ ...zero, [key]: limit * 0.8 - 1 }, 0, 0, "free")),
      false,
    );
    assert.equal(
      quotaWarning(estimate({ ...zero, [key]: limit * 0.8 }, 0, 0, "free")),
      true,
    );
  }
  assert.equal(quotaWarning(estimate(zero, 5_000_000, 0)), false);
});

test("Free requests and D1 rows use UTC days while R2 keeps its subscription interval", () => {
  const c = free();
  const before = query(c, Date.parse("2026-10-16T23:59:59Z"));
  const after = query(c, Date.parse("2026-10-17T00:00:01Z"));
  assert.match(
    before,
    /workersInvocationsAdaptive\(limit:100,filter:\{datetime_geq:"2026-10-16T00:00:00.000Z"/,
  );
  assert.match(
    after,
    /workersInvocationsAdaptive\(limit:100,filter:\{datetime_geq:"2026-10-17T00:00:00.000Z"/,
  );
  assert.match(
    after,
    /d1AnalyticsAdaptiveGroups\(limit:2,filter:\{date_geq:"2026-10-17",date_leq:"2026-10-17"/,
  );
  assert.match(
    after,
    /r2OperationsAdaptiveGroups\(limit:100,filter:\{datetime_geq:"2026-10-10T00:00:00.000Z"/,
  );
});

test("Free does not require a Paid CPU limit or apply a CPU ceiling to other scripts", async () => {
  const c = free(),
    cloud = new Cloud();
  c.cpuCeilingMs = 1;
  cloud.schedules = [];
  const read: Api = async <T>(p: string, b?: unknown, m?: string) =>
    p.endsWith("/settings")
      ? ({ usage_model: "standard", bindings: [] } as T)
      : cloud.call<T>(p, b, m);
  assert.equal((await inventory(read, c)).issues.length, 0);
  cloud.data.viewer.accounts[0].workersInvocationsAdaptive[0].dimensions.scriptName =
    "another-worker";
  assert.equal((await metrics(read, c, NOW)).usage.cpuMs, 0);
  c.plan = "paid" as any;
  assert.ok(
    (await inventory(read, c)).issues.some((s) => s.includes("CPU ceiling")),
  );
});

test("Free near-quota warning does not latch or mutate production", async () => {
  const cloud = new Cloud(),
    store = new Memory(),
    c = free();
  cloud.data = analytics(35_000); // Includes the guard's 45,000 requests.
  const s = await new Engine(
    store,
    environment(c),
    cloud.call,
    cloud.call,
  ).tick(NOW);
  assert.equal(s.warning, true);
  assert.equal(s.latched, false);
  assert.equal(s.cost?.microUsd, 1_000_000);
  assert.equal(s.cost?.freeQuota?.requests.used, 80_000);
  assert.deepEqual(cloud.mutations, []);
});

test("Free R2 cutoff retains original snapshots, retries and requires manual recovery", async () => {
  const cloud = new Cloud(),
    store = new Memory(),
    c = free();
  cloud.data.viewer.accounts[0].r2OperationsAdaptiveGroups = [
    { sum: { requests: 4_000_001 }, dimensions: { actionType: "PutObject" } },
  ];
  cloud.failed.add("/subdomain");
  const engine = new Engine(store, environment(c), cloud.call, cloud.call);
  const first = await engine.tick(NOW);
  assert.equal(first.latched, true);
  assert.equal(first.cost?.items.r2A, 18_000_000);
  assert.ok(first.errors.length);
  cloud.failed.clear();
  const next = await engine.tick(NOW + 60_000);
  assert.equal(next.latched, true);
  assert.equal(cloud.sub.enabled, false);
  assert.deepEqual(next.snapshot?.subdomain, {
    enabled: true,
    previews_enabled: true,
  });
  await assert.rejects(
    engine.recoveryCheck(next.cutoffAt!, NOW + 120_000),
    /cost remains/,
  );
});

test("disabled Free enforcement observes R2 cutoff without mutations", async () => {
  const c = free(),
    cloud = new Cloud();
  c.enabled = false;
  cloud.data.viewer.accounts[0].r2OperationsAdaptiveGroups = [
    { sum: { requests: 4_000_001 }, dimensions: { actionType: "PutObject" } },
  ];
  const s = await new Engine(
    new Memory(),
    environment(c),
    cloud.call,
    cloud.call,
  ).tick(NOW);
  assert.equal(s.latched, false);
  assert.match(s.reason!, /OBSERVE ONLY/);
  assert.deepEqual(cloud.mutations, []);
});

test("changing pricing plan cannot erase saved charges or bypass the cutoff latch", async () => {
  const cloud = new Cloud(),
    store = new Memory(),
    paid = config();
  paid.enabled = false;
  cloud.data = analytics(128);
  const first = await new Engine(
    store,
    environment(paid),
    cloud.call,
    cloud.call,
  ).tick(NOW);
  const c = free();
  c.enabled = false;
  const next = await new Engine(
    store,
    environment(c),
    cloud.call,
    cloud.call,
  ).tick(NOW + 60_000);
  assert.equal(next.config?.plan, "paid");
  assert.deepEqual(next.cost, first.cost);
  assert.ok(next.errors.length);
  assert.deepEqual(cloud.mutations, []);

  const armed = config();
  const activeStore = new Memory();
  cloud.data = analytics(0);
  await new Engine(
    activeStore,
    environment(armed),
    cloud.call,
    cloud.call,
  ).tick(NOW);
  const latched = await new Engine(
    activeStore,
    environment(free()),
    cloud.call,
    cloud.call,
  ).tick(NOW + 60_000);
  assert.equal(latched.latched, true);
  assert.equal(latched.config?.plan, "paid");
  await assert.rejects(
    new Engine(
      activeStore,
      environment(free()),
      cloud.call,
      cloud.call,
    ).recoveryCheck(latched.cutoffAt!, NOW + 120_000),
    /original scope/,
  );
});

test("saved legacy Paid records remain valid without new pricing metadata", async () => {
  const cloud = new Cloud(),
    store = new Memory();
  const engine = new Engine(store, environment(), cloud.call, cloud.call);
  await engine.tick(NOW);
  const legacy = await store.get<State>("state");
  delete (legacy!.config as any).plan;
  delete (legacy!.cost as any).plan;
  delete (legacy!.cost as any).freeQuota;
  await store.put("state", legacy);
  const restored = await engine.state();
  assert.equal(restored.config?.plan, "paid");
  assert.equal(restored.cost?.microUsd, 6_000_000);
});

test("Free scope stays within its external subrequest allowance under retries", () => {
  const c = free();
  c.zones.push({ id: "c".repeat(32), hosts: ["second.example.com"] });
  assert.doesNotThrow(() => configuration(environment(c), NOW));
  c.zones.push({ id: "d".repeat(32), hosts: ["third.example.com"] });
  assert.throws(() => configuration(environment(c), NOW));
  assert.doesNotThrow(() =>
    configuration(environment({ ...c, plan: "paid", fixed: 5_000_000 }), NOW),
  );
});

test("Free includes ordinary Workers Logs only with traces disabled and before actual repricing", async () => {
  const c = free(),
    cloud = new Cloud();
  c.reviewedUntil = null;
  const check = async (traces: unknown, now = NOW) => {
    const read: Api = async <T>(p: string, b?: unknown, m?: string) =>
      p.endsWith("/settings")
        ? ({
            usage_model: "standard",
            bindings: [],
            observability: { enabled: true, traces },
          } as T)
        : cloud.call<T>(p, b, m);
    return (await inventory(read, c, false, now)).issues;
  };
  assert.deepEqual(await check({ enabled: false }), []);
  assert.ok(
    (await check({ enabled: true })).some((s) => s.includes("logs, traces")),
  );
  assert.ok((await check(undefined)).some((s) => s.includes("logs, traces")));
  assert.ok(
    (await check({ enabled: false }, Date.parse("2026-12-01T00:00:00Z"))).some(
      (s) => s.includes("logs, traces"),
    ),
  );
});
