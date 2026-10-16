# Workers Free adaptation — 2026-10-16

The default example explicitly selects `"plan": "free"`, keeps `enabled=false`,
sets `fixed=0` and omits a Paid-only Worker CPU override. The runtime still has
zero package dependencies. No customer subscription, application or deployment
pipeline is modified by this change.

## Cost and service limits

Free Workers requests/CPU and D1 reads/writes/storage do not become Paid overages.
The estimate records zero for those line items. Configured other fixed costs
and the minimum $1 uncertainty reserve remain; the reserve is an assumption,
not a charge or a verified ceiling. R2 Standard retains its account-shared free
allowances, upward-rounded operations/storage charges and retained cost floors.

`cost.freeQuota` reports account requests and D1 rows for the current UTC day,
plus a conservative D1 storage peak across the configured review interval. At
80% of a limit, `warning=true`; a quota advisory alone does not latch a dollar
cutoff. Request/read/write allowances reset at midnight UTC without clearing a
cutoff latch. Storage does not have a daily reset. Adaptive analytics can lag or
sample usage; these signals are not exact remaining-quota counters.

The reviewed limits are 100,000 Workers requests/day, 5 million D1 rows read/day,
100,000 D1 rows written/day and 5 GB total D1 storage. The storage advisory uses
decimal GB conservatively. Per-invocation CPU and per-database limits can stop
work sooner and are not measured here. No synthetic CPU charges are calculated.

The SQLite Durable Object remains available on Free. Its request, duration and
storage quotas can fail independently of the app's request quota. DO and log
quota usage is not queried. An independent external status check remains
necessary; a guard in an exhausted account cannot promise continued monitoring.
Free scope is limited to two zones to bound preflight plus full REST retries and
cutoff to 41 external fetches, below the 50 external-subrequest allowance.

Ordinary Free Workers Logs are included only when traces are explicitly off and
the review expires by December 1, 2026, before announced Observability repricing.
Logpush, traces, tail consumers and unsupported bindings still require separate
coverage. Nothing changes the application's logging configuration.

## Configuration and recovery

Paid remains supported with explicit `"plan": "paid"` and at least $5 in fixed
charges. Legacy configurations and cutoff records without a plan still mean
Paid. Invalid plan values are rejected. Changing the plan of an existing saved
state is refused before replacing its recorded configuration or costs. Recovery
also requires the original plan. A future actual subscription change needs a
separately reviewed state migration; deleting or renaming the DO is unsafe.

Plan selection is an operator attestation refreshed with the existing coverage
review. A script's `usage_model` is not account-plan proof. There is no automatic
subscription-change detection and no additional Billing Read permission. Keep
the guard under review before any account upgrade or new billable product.

The three configured windows still expire and bound saved estimate retention.
On Free, Workers/D1 windows are review intervals and can match the verified R2
billing interval; current-day quota queries ignore their starts. R2 must retain
its actual subscription boundaries. No monthly rollover or quota reset reopens
production. Cutoff, partial retry, snapshots, authenticated readiness and human
restoration retain the same behavior on both plans.

## Official sources

- [Workers pricing and included Logs](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits, daily reset and external subrequests](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing and behavior at Free limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [Durable Objects Free availability and quotas](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [R2 Standard pricing](https://developers.cloudflare.com/r2/pricing/)

Free/Paid pricing, invalid inputs, midnight boundaries, quota advisories,
unchanged R2 cutoff/retry, disabled enforcement, legacy saved state and rejected
plan-change recovery are covered by the regression suite. Live Free CPU/quota
behavior and account-specific analytics access still require a staging drill.
