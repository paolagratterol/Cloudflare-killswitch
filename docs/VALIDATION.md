# Local validation — 2026-10-16

Passed on Node **24.19.0**, using locked Wrangler **4.150.0**:

- `npm run check`: release-age/source/integrity verification, registry signature
  verification, vulnerability audit, strict TypeScript check, **70 passing tests** (21 final-review regression cases and 14 Free-plan cases added)
  and an ES module Worker build.
- Every one of **117 locked package versions** is older than **72 hours**; the
  youngest was over **80 hours** old at initial review. The unchanged lock tree's initial audit verified 117 registry signatures and 78 attestations; the follow-up audit of 43 installed packages verified all 43 signatures and 24 attestations. No known
  vulnerabilities were reported. Lifecycle install scripts stayed disabled.
- `npm run dry-run`: successful local Wrangler bundle, **37.35 KiB upload /
  10.70 KiB gzip** after Free adaptation. This is a bundle size measurement, not a CPU/memory benchmark.
- Local workerd run with a fake 32+ character admin credential and deliberately invalid account
  placeholder: unauthenticated status returned 404; authenticated initial state
  returned 503; valid native timing-safe auth passed and an equal-length wrong secret was refused; local cron reported failure (500); the configuration error and heartbeat persisted
  in local SQLite; status remained unarmed/503; cutoff, recovery readiness and rearm were refused with 503.
  The local server was stopped after the check.

The tests cover pricing examples, integer rounding/overflow, CPU milliseconds,
shared allowances, D1 rows versus query counts, R2 classification, storage reserve,
billing/leap-year/timezone boundaries, stale/missing/truncated/error metrics,
threshold crossings, disabled enforcement, durable intent, partial failures,
retry/reconciliation after lost responses, WAF position, script/preview/cron
coverage, redeployment drift, original disabled settings, recovery checks,
authentication and concurrent control-object requests. The final review also covers independent shutdown budgets, slow WAF fairness, immutable snapshot writes, same-period cost floors and recovery write failures. See [FINAL-REVIEW.md](FINAL-REVIEW.md).
Free-plan cases cover zero Workers/D1 overage charges, unchanged R2 pricing,
UTC-day quota boundaries, 80% advisories, CPU-limit compatibility, bounded zone
scope, Free logging review expiry, disabled enforcement and preserved legacy
Paid state. See [FREE-PLAN.md](FREE-PLAN.md).

Lockfile SHA-256:

```text
e7a1a94a2f9f84d2ce297f62c85b737357ff92561b02552edcc70d9e7e32c638
```

Read-only customer setup used installer OAuth and the customer's existing browser
to verify resource metadata and subscription labels. No runtime token, account
GraphQL analytics, edge mutation, production deployment or live recovery was
exercised. Customer schema/permissions, Images coverage,
background/direct-data clients, propagation and pipeline interlock require the
staging and ownership checks in [OPERATIONS.md](OPERATIONS.md). No final-invoice
cap or CPU/memory improvement is claimed.
