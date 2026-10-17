# Customer setup and operation

This guide covers setup and operation; each client installation needs its own
live verification record. For the installed production guard and future
manual updates, follow [Manual guard updates](MANUAL-UPDATES.md). Its approved
enforcement remains enabled; the generic fresh-install example is disabled.
Use a customer-owned Cloudflare account, domain, payment method, GitHub access,
tokens and password manager. Give the customer this repository and recovery
instructions; remove installer access after handoff.

## Choose the actual Workers plan

The shipped example uses `"plan": "free"`, `"fixed": 0` and disabled enforcement.
Read [Free plan behavior and limits](FREE-PLAN.md). R2 is still metered on this
plan. Free has daily service limits rather than Workers/D1 overage charges.
For a customer already subscribed to Workers Paid, explicitly select `"paid"`
and include at least $5 in `fixed`. Omitted `plan` retains the old Paid meaning
for compatibility; it never implicitly selects Free. The example omits a Paid
`limits.cpu_ms` override, and Free does not require a configurable app CPU cap.

Confirm the plan in Billing > Subscriptions. Script `usage_model: standard`
does not establish that the account is subscribed to Paid. Runtime tokens do
not gain Billing Read; subscription changes require a separate guard review.
Changing `plan` on an existing saved guard state is refused, including recovery,
so changing a label cannot discard known charges. Request a reviewed state
migration for a future subscription change; do not delete the Durable Object.

## Scope and live inventory required before enforcement

Record the account ID; actual Worker name; all D1 database IDs; all R2 buckets and
storage classes; exact billing intervals for each subscription; fixed fees and
tax reserve; every zone, hostname, route, preview and version URL. The reference
names are `ferrecar-platform`, `ferrecar-production` and `ferrecar-uploads`.
Do not obtain secret values from Ferrecar's GitHub repository for this task.

The reference source has an Images binding. Images is **unpriced here**. Resolve
its cost coverage separately before turning on enforcement. Unknown bindings,
paid logging, traces, tail consumers and enabled custom-domain previews fail coverage checks.
Ordinary Workers Logs on Free are covered only with traces explicitly disabled
and while the current time is before December 1, 2026, when announced repricing
starts. That known pricing boundary forces a new inventory check even if its
15-minute cache is fresh, independently of the optional review expiry.
Do not remove existing Ferrecar features just to satisfy this guard.

Also inspect the customer dashboard for incoming service bindings, Queue
consumers, Workflow definitions/running instances, Durable Object alarms,
email/tail/socket handlers, dispatch namespaces, Pages Functions, Workers Builds,
public R2 domains, S3/API clients, presigned URLs, lifecycle transitions, multipart
uploads, and external scheduled jobs. Review routes in **every** zone, including
zones not listed in this configuration. This implementation does not discover
all of these from Worker settings. An absent binding does not establish absence
of an incoming trigger. Record the completed review. `reviewedUntil` is a required
property: a UTC timestamp opts into a scheduled review cutoff; explicit `null`
means no scheduled review expiry. Omitted, malformed and elapsed timestamps fail
validation. The installed client configuration uses `null`, so it needs no weekly
review renewal. This setting never disables budget or monitor-failure cutoff,
changes verified billing windows, resets known charges, releases an existing
cutoff, or extends API-token validity. Review pricing, plan, products and
entrypoints when they change. Keep a dedicated Ferrecar account if feasible.

Use only hostnames dedicated entirely to Ferrecar: cutoff blocks all paths on
each listed hostname. A shared hostname with unrelated routes/origins is outside
the supported scope. Wildcard Worker route hosts require resolving the exact
Ferrecar hosts first. The monitor hostname must be separate from every target.

## Minimum permissions

Create separate, customer-owned, expiring API tokens. Scope each account-level
permission to **this one account**, and each zone permission to **only the listed
Ferrecar zones**, never all accounts/zones. The names below are the API permission
names; the dashboard may label Write as Edit.

| Token             | Required permission                           | Calls                                                                                           |
| ----------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ANALYTICS_TOKEN` | Account Analytics Read                        | GraphQL usage and canary datasets                                                               |
| `ANALYTICS_TOKEN` | Workers Scripts Read, one account             | Worker settings, subdomain, schedules and domain inventory                                      |
| `ANALYTICS_TOKEN` | Workers Routes Read, listed zones             | Route inventory                                                                                 |
| `ANALYTICS_TOKEN` | Zone WAF Read, listed zones                   | Manual-recovery verification                                                                    |
| `CONTROL_TOKEN`   | Individual Workers Editor, target Worker only | Disable target workers.dev/previews and replace its cron list with `[]`; reads for verification |
| `CONTROL_TOKEN`   | Zone WAF Write, listed zones                  | Read, add/update and verify this guard's exact-host block rule                                  |

Use the modern account-owned token builder: **Specified Workers →
ferrecar-platform → Individual Workers Editor**. The installed token's scope was
verified by successful target access and denied access to the guard, D1 and R2
APIs. Editor can also update code/settings for this Worker; no narrower
cutoff-only role is available here. It cannot create/delete Workers. Legacy
account-scoped Workers Scripts Write is broader and is not the installed scope.
The separate analytics token retains account-level read for domain inventory.
Do not grant Account Admin or add D1/R2 permissions to the controller.

No D1 write, D1 query, R2 object read/write/delete, DNS edit, Workers Routes Write,
Queues Write, Workflows Write, Billing Read or account-wide WAF permissions are
needed by this software. Separate installer credentials need Workers deployment
and Durable Object migration permissions on the guard's account. Keep those out
of runtime secrets. The runtime controller already has broad Worker write power;
rotating/restricting it remains essential.

Permission references: [Analytics authentication](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/),
[permission groups and resource scope](https://developers.cloudflare.com/fundamentals/api/reference/permissions/),
[Worker subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/),
[route listing](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/),
[domain listing](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/),
[custom rules API](https://developers.cloudflare.com/waf/custom-rules/create-api/).
Validate each installation's actual permissions and queries. The current client
installation has verified the Worker-specific scope, real analytics, live cutoff,
scheduled recheck and recovery; see its private installation records. Re-test
after material scope or permission changes.

## Local verification

Use Node 22 or newer (24 recommended), with the checked-in lockfile:

```sh
npm ci --ignore-scripts
npm run verify-dependencies
npm run check
npm run dry-run
```

The release-age check requires every direct and transitive locked package,
including optional platform packages, to have been published at least **72 hours**
earlier. Missing metadata, non-npm sources or integrity mismatch fail the check.
It uses Node built-ins and never imports those packages. Lifecycle scripts remain
disabled. Signature/provenance checks and the vulnerability audit complement the
age rule; passing them does not establish that code is free of malicious behavior.

The `dry-run` command bundles locally; it does not publish. There is deliberately
no deployment script, GitHub deployment workflow or Codex recurring automation.

## Installation, only after review and authorization

1. Copy `wrangler.example.toml` to untracked `wrangler.toml`. Replace account/D1
   placeholders, zones and dedicated Ferrecar hostnames. Keep `enabled=false`.
   All monetary values are integer **micro-US dollars**: $10 = 10,000,000.
   Configure your verified subscription intervals as exact UTC start/end
   timestamps. The intervals need not be calendar months or identical between
   subscriptions. On Free, Workers/D1 windows are reviewed retention intervals
   for saved estimates and may match the R2 period; their quota queries use the
   current UTC day independently. Every window must contain now and span no more than 31
   days. Review/update them monthly; expired config cuts off a previously armed
   scope instead of guessing a new period or reactivating production.
2. Reserve an available custom-rule slot in each zone. Ensure a zone entrypoint
   ruleset for `http_request_firewall_custom` exists. This guard refuses to
   replace/create an entire ruleset. Do not reuse the rule ref
   `ferrecar_budget_guard_v1` for anything else. Keep its block first; API
   reconciliation restores the first position. Check account-level skips,
   exceptions, caching and other precedence with a real request in staging.
3. Disable **custom-domain preview routing** manually after recording its old
   settings, or approve an extension that controls it. This guard disables
   workers.dev preview/version endpoints but does not mutate custom-domain
   preview routing. WAF exact-host rules do not cover arbitrary preview aliases.
4. Complete the background/product review above. Configure storage floors at
   least as high as retained peak account storage known from billing. `fixed`
   includes all known fixed charges, including the full $5 Workers subscription
   only on Paid. Zero is allowed on Free when no other fixed charges apply.
   `reserve` is at least $1 for monitor/DO overhead, uncertainty and tax; increase
   after measurement. It is an assumption, not an enforced upper bound.
5. **Paid only:** the default `cpuCeilingMs=1800000` is twice the documented 15-minute background
   CPU maximum. It is intentionally harsh: at roughly 267 app invocations,
   the $5 base + $1 reserve + CPU envelope already crosses $15. For practical
   traffic, independently establish a lower Ferrecar CPU limit and absence of
   every background entrypoint, set `httpOnly=true`, and use a ceiling at least
   twice the observed `limits.cpu_ms`. The guard checks this setting and an empty
   cron list. It cannot verify the entire historic configuration. Do not lower
   the ceiling below the highest applicable limit used since period start.
   Other historical Workers in analytics prevent use of this lower mode.
   Any Ferrecar CPU-limit or pipeline changes require separate approval.
   Free ignores this estimate-only CPU setting; its Workers CPU time has a hard
   provider limit and no overage price. Free permits at most two configured zones
   to stay below its external subrequest limit even with full transient retries.
6. With customer installer credentials, store runtime values through interactive
   Wrangler secret prompts; do not paste credentials into shell command lines:

   ```sh
   npx --no-install wrangler secret put ANALYTICS_TOKEN --config wrangler.toml
   npx --no-install wrangler secret put CONTROL_TOKEN --config wrangler.toml
   npx --no-install wrangler secret put ADMIN_SECRET --config wrangler.toml
   ```

   Generate a random admin secret of 32–512 characters in the customer's password manager. Short secrets are refused; authentication uses Workers' timing-safe buffer comparison.
   First-time secret creation can require a draft Worker; use the customer
   dashboard or Wrangler's documented first-deployment flow. Never reuse
   Ferrecar's deployment token as the monitor token.

7. When deployment is approved, deploy **this guard alone** using
   `npx --no-install wrangler deploy --config wrangler.toml`. This creates the
   small SQLite Durable Object used for serialized control and persistent latch.
   Check that cron is `* * * * *` (UTC, configurable). Confirm the script name
   is `ferrecar-budget-guard` as required by `CONFIG.self`, keep its DO binding/class/migration/instance name stable,
   and do not delete its storage during upgrades.
8. Run in observe mode until a recent monitor canary is visible in analytics
   (initial checks may report missing metrics), storage samples are available,
   product review is complete, and every account-specific query succeeds. Perform
   a cutoff/recovery drill in a disposable staging account before approving
   `enabled=true` for production. For a staging drill the deliberate Ferrecar
   name restriction means the test account must contain that exact script name.
9. Arrange an independent authenticated check of `/status`, outside this account,
   and customer-owned provider budget notifications. Do not depend on logs alone.
   An HTTP 200 can still include a warning/coverage limits: inspect `warning`,
   `gaps`, `reason`, `cost`, `lastGood` and `heartbeatStale`. Never treat
   `enabled=false` as protection. No watcher was installed as part of this work.
   On Free, inspect `cost.freeQuota`: requests and D1 rows cover the UTC day,
   storage is a conservative retained peak. At 80% a quota advisory sets `warning`
   without triggering a budget cutoff. DO/log quota usage is not measured.

## Status, shutdown and recovery

Inventory/metrics failures include a validated Cloudflare HTTP status when one is
available. HTTP 401/403 means the runtime token's value, validity or permissions
need review. Arbitrary exception messages, provider response bodies and credential
values are never copied into these diagnostics. Resolve access errors in observe
mode before considering enforcement. `API token format invalid` indicates a
stored value with whitespace or non-ASCII characters; use only the bare API-token
value, without a `Bearer` prefix, command text or a trailing newline.

The API client uses `redirect: "manual"` and rejects all non-success statuses,
including redirects. The native Workers runtime does not implement the browser's
`redirect: "error"` mode. Credentials are never forwarded to a redirect target.

Authenticate admin requests with `Authorization: Bearer <ADMIN_SECRET>`. Avoid
putting this secret in shell history, screenshots or support messages.

| Request                                                 | Behavior                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /status`                                           | Saved state, estimate, original recovery snapshot, errors and heartbeat age. HTTP 503 for observe mode, cutoff, errors or stale heartbeat. Inspect `enforcementEnabled`. Healthy state checkpoints every 15 minutes; stale after 20. |
| `POST /cutoff`                                          | Manual cutoff skips analytics/inventory, obeys `enabled`, and persists intent before mutation. Disabled healthy enforcement returns 409; partial failure returns 503.                                                                |
| `POST /rearm` with `X-Confirm-Cutoff: <exact cutoffAt>` | Checks manual restoration, fresh metrics and cost below warning, archives prior snapshot, clears only guard latch. It makes no production API mutations.                                                                             |

After cutoff, every cron verifies the WAF rule, workers.dev/previews and empty
cron list and repairs drift. Partial failures remain visible and retry. It never
deletes D1 data, R2 objects, the original script or routes. Active requests,
WebSockets, running jobs and already-triggered work are not forcibly terminated.
API verification establishes the returned control-plane settings; it is not an
end-to-end billing or edge-propagation test.

For recovery, download `/status` and keep it privately. Investigate the reason,
stop runaway producers, resolve every coverage gap, rotate compromised tokens
and update the verified billing interval if needed. **First** call
`POST /recovery-check` with `X-Confirm-Cutoff: <exact cutoffAt>` while the
application remains stopped. This read-only endpoint changes neither the latch
nor production settings. It requires enabled enforcement, unchanged original
control scope, valid complete snapshots, coverage and fresh cost below warning.
Known estimated charges cannot decrease within the same product billing period,
so missing/lower metrics cannot make a spend cutoff eligible for recovery.
Do not change billing timestamps just to bypass the check.

Once readiness passes, pause the **guard's** cron temporarily in the customer
dashboard, preserving its latch/DO, and allow any in-flight check to finish.
Repeat readiness immediately before restoring production. In the customer
dashboard remove only this guard's WAF rule (match its stable ref/host expression),
restore the original `snapshot.subdomain` booleans and exact `snapshot.schedules`.
Leave settings originally disabled disabled. This restoration itself reopens
production, so it is an explicit customer action. POST `/rearm` with the recorded
timestamp while cron remains paused; then restore the guard cron. If rearm fails,
**resume the guard cron immediately** so the retained latch re-applies cutoff;
do not leave production reopened with monitoring paused. Rearm refuses disabled
enforcement, changed account/Worker/guard/zone/host scope, incomplete coverage,
invalid or expired configuration, failed analytics, and cost at or above warning.
Hostname ordering is harmless. Rearm verifies the original settings and never
writes production settings. Repeated rearm after success is rejected safely.

If the admin endpoint or DO is unavailable, use the recorded snapshot and customer
dashboard; repair monitoring before clearing state. Never delete the namespace or
change instance name as a shortcut. Keep offline recovery evidence at hand.

## Ferrecar deployment interlock: separate approval required

This branch changes **no** Ferrecar repository, PR, branch or pipeline. Keep
`FERRECAR_DEPLOY_ENABLED=false`. A separate future change should make every
production deploy query the guard state immediately before upload and refuse
on cutoff, unknown state, missing token, stale heartbeat or network error. Store
no reusable bypass in a build variable. Restrict manual deployment and dashboard
roles; otherwise a redeploy/operator can reopen subdomains, previews or cron
between guard ticks. The independent WAF rule usually survives app redeploy, but
that must be verified in the customer's setup. Periodic repair does not provide
an atomic deployment lock; leave this unresolved item visible at handoff.
