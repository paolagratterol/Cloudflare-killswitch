import { count } from "./api.ts";
import type { Plan } from "./configuration.ts";
export interface Usage {
  requests: number;
  cpuMs: number;
  rowsRead: number;
  rowsWritten: number;
  d1Bytes: number;
  r2A: number;
  r2B: number;
  r2Bytes: number;
}
// Integer microdollars; BigInt intermediates avoid multiplication overflow.
const excess = (n: number, free: number) =>
  BigInt(Math.max(0, count(n) - free));
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const freeLimits = {
  requests: 100_000,
  d1Read: 5_000_000,
  d1Write: 100_000,
  d1Storage: 5_000_000_000,
} as const;
export function estimate(
  u: Usage,
  fixed: number,
  reserve: number,
  plan: Plan = "paid",
) {
  if (plan !== "free" && plan !== "paid") throw Error("unsupported plan");
  for (const key of [
    "requests",
    "cpuMs",
    "rowsRead",
    "rowsWritten",
    "d1Bytes",
    "r2A",
    "r2B",
    "r2Bytes",
  ] as const)
    count(u[key]);
  const paid = plan === "paid";
  const bill = {
    fixed: BigInt(count(fixed)),
    reserve: BigInt(count(reserve)),
    requests: paid
      ? ceil(excess(u.requests, 10_000_000) * 300_000n, 1_000_000n)
      : 0n,
    cpu: paid ? ceil(excess(u.cpuMs, 30_000_000) * 20_000n, 1_000_000n) : 0n,
    d1Read: paid
      ? ceil(excess(u.rowsRead, 25_000_000_000) * 1_000n, 1_000_000n)
      : 0n,
    d1Write: paid
      ? ceil(excess(u.rowsWritten, 50_000_000) * 1_000_000n, 1_000_000n)
      : 0n,
    // Whole-period per-resource peak reserves retained storage through period end.
    // Decimal GB deliberately overcounts prices expressed in binary GB.
    d1Storage: paid
      ? ceil(excess(u.d1Bytes, 5_000_000_000) * 750_000n, 1_000_000_000n)
      : 0n,
    r2A: ceil(excess(u.r2A, 1_000_000), 1_000_000n) * 4_500_000n,
    r2B: ceil(excess(u.r2B, 10_000_000), 1_000_000n) * 360_000n,
    r2Storage:
      ceil(excess(u.r2Bytes, 10_000_000_000), 1_000_000_000n) * 15_000n,
  };
  const total = Object.values(bill).reduce((a, b) => a + b, 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("cost overflow");
  return {
    plan,
    microUsd: Number(total),
    items: Object.fromEntries(
      Object.entries(bill).map(([k, v]) => [k, Number(v)]),
    ),
    freeQuota: paid
      ? undefined
      : {
          requests: { used: count(u.requests), limit: freeLimits.requests },
          d1Read: { used: count(u.rowsRead), limit: freeLimits.d1Read },
          d1Write: { used: count(u.rowsWritten), limit: freeLimits.d1Write },
          d1Storage: { used: count(u.d1Bytes), limit: freeLimits.d1Storage },
        },
    coverage: paid
      ? "Workers Standard + D1 + R2 Standard estimate with reserves; NOT account invoice total"
      : "Workers Free + D1 Free (service limits, no overage charges) + R2 Standard estimate with reserves; NOT account invoice total",
  };
}
export type Estimate = ReturnType<typeof estimate>;
export const quotaWarning = (e: Estimate) =>
  Object.values(e.freeQuota ?? {}).some((q) => q.used >= q.limit * 0.8);
const product = {
  fixed: "any",
  reserve: "any",
  requests: "workers",
  cpu: "workers",
  d1Read: "d1",
  d1Write: "d1",
  d1Storage: "d1",
  r2A: "r2",
  r2B: "r2",
  r2Storage: "r2",
} as const;
export function validateEstimate(e: Estimate): void {
  if (
    !e ||
    !e.items ||
    Object.keys(e.items).length !== Object.keys(product).length
  )
    throw Error("invalid saved estimate");
  if (e.plan !== undefined && e.plan !== "free" && e.plan !== "paid")
    throw Error("invalid saved pricing plan");
  if (e.plan === "free" && !e.freeQuota)
    throw Error("missing saved Free quota");
  if (e.freeQuota !== undefined) {
    if (
      e.plan !== "free" ||
      !e.freeQuota ||
      Object.keys(e.freeQuota).length !== Object.keys(freeLimits).length
    )
      throw Error("invalid saved Free quota");
    for (const key of Object.keys(freeLimits) as (keyof typeof freeLimits)[]) {
      const q = e.freeQuota[key];
      if (
        !q ||
        !Number.isSafeInteger(q.used) ||
        q.used < 0 ||
        q.limit !== freeLimits[key]
      )
        throw Error("invalid saved Free quota");
    }
  }
  let total = 0n;
  for (const key of Object.keys(product)) {
    const n = e.items[key];
    if (!Number.isSafeInteger(n) || n < 0) throw Error("invalid saved cost");
    total += BigInt(n);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || Number(total) !== e.microUsd)
    throw Error("invalid saved total");
}
// A disappearing/sampled dataset must not erase already observed estimated
// charges, including during recovery. Reset each product only at a verified
// change of its billing interval; do not add the old and new estimates.
export function retainEstimate(
  next: Estimate,
  previous: Estimate | undefined,
  same: Record<"workers" | "d1" | "r2", boolean>,
): Estimate {
  if (!previous) return next;
  validateEstimate(previous);
  for (const [key, p] of Object.entries(product)) {
    if (p === "any" ? Object.values(same).some(Boolean) : same[p])
      next.items[key] = Math.max(next.items[key], previous.items[key]);
  }
  next.microUsd = Object.values(next.items).reduce((s, n) => s + n, 0);
  validateEstimate(next);
  return next;
}
const A = new Set(
  "ListBuckets PutBucket CreateBucket ListObjects ListObjectsV2 PutObject CopyObject CompleteMultipartUpload CreateMultipartUpload LifecycleStorageTierTransition ListMultipartUploads UploadPart UploadPartCopy ListParts PutBucketEncryption PutBucketCors PutBucketLifecycleConfiguration".split(
    " ",
  ),
);
const B = new Set(
  "HeadBucket HeadObject GetObject UsageSummary GetBucketEncryption GetBucketLocation GetBucketCors GetBucketLifecycleConfiguration".split(
    " ",
  ),
);
const FREE = new Set(
  "DeleteObject DeleteObjects DeleteBucket AbortMultipartUpload".split(" "),
);
export function r2Class(name: string): "A" | "B" | "free" {
  if (A.has(name)) return "A";
  if (B.has(name)) return "B";
  if (FREE.has(name)) return "free";
  throw Error(
    `unclassified R2 operation: ${name.replace(/[^a-zA-Z]/g, "").slice(0, 60)}`,
  );
}
export function cpuFromCeiling(requests: number, ceilingMs: number) {
  const n = BigInt(count(requests)) * BigInt(count(ceilingMs));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("CPU overflow");
  return Number(n);
}
