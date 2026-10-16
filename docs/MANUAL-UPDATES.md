# Manual guard updates

**This is the operator's runbook, not homework for the user.** Manual means the
user asks the assistant to update the guard, and the assistant performs the
review, security checks, tests, deployment and verification. Keep enforcement
disabled throughout. Do not stop at giving the user these commands. No automatic
GitHub deployment is connected. Ask for user action only if access or required
account information is actually unavailable.

The guard runs in the client's Cloudflare account as `ferrecar-budget-guard`.
Keep enforcement disabled (`CONFIG.enabled: false`) and leave `CONTROL_TOKEN`
absent. GitHub automatic deployment is not connected. The deployed Worker and
its one-minute schedule continue running without a GitHub connection.

The guard source is
[`paolagratterol/Cloudflare-killswitch`, branch `feat/ferrecar-budget-guard`](https://github.com/paolagratterol/Cloudflare-killswitch/tree/feat/ferrecar-budget-guard).
The client's application is
[`miguelcardoza47-max/Ferrecar-Platform`](https://github.com/miguelcardoza47-max/Ferrecar-Platform),
deployed separately as `ferrecar-platform`. Do not connect the application's
repository to the guard Worker or run the application's deploy commands here.

## Before each update

Use a trusted Git working copy of the guard branch. Keep the reviewed,
client-specific `wrangler.toml` locally; it is ignored by Git and excluded from
the generic source ZIP. Keep a private backup of it and record the current guard
version/commit. Never copy secret values into Git, command arguments or chat.

Use Node.js 22 or newer (the prepared installation uses 24.19.0). Run the
commands below one at a time in PowerShell from the guard working copy. Stop if
any command fails. `npm run dry-run` uses the placeholder example; the explicit
Wrangler dry run below is required for the real client configuration.

1. Check for local changes and inspect the proposed update before accepting it:

   ```powershell
   git -c core.hooksPath=../empty-hooks -c core.fsmonitor=false status --short
   git -c core.hooksPath=../empty-hooks -c core.fsmonitor=false fetch origin feat/ferrecar-budget-guard
   git -c core.hooksPath=../empty-hooks -c core.fsmonitor=false log --oneline HEAD..FETCH_HEAD
   git -c core.hooksPath=../empty-hooks -c core.fsmonitor=false diff HEAD..FETCH_HEAD
   ```

   Review dependency/lockfile changes, install/test scripts, configuration,
   network calls, cutoff, retries and recovery. Confirm `origin` is the guard
   repository above. Preserve local edits; do not reset or force-push. Use the
   empty hooks directory prepared alongside this checkout. For a new checkout,
   create an empty directory and set `core.hooksPath` to its absolute path before
   Git operations that could run hooks.

2. After review, accept the fast-forward update and install only locked tooling:

   ```powershell
   git -c core.hooksPath=../empty-hooks -c core.fsmonitor=false merge --ff-only FETCH_HEAD
   npm ci --ignore-scripts --no-audit --no-fund
   npm run check
   ```

   `check` verifies every locked dependency is at least **72 hours old**, verifies
   registry source/integrity and installed signatures, checks vulnerabilities,
   checks TypeScript, runs the tests and bundles the Worker. An audit or registry
   error blocks the update; do not bypass it. Avoid automatic dependency upgrades.

3. Review the actual local `wrangler.toml`. Keep the account ID equal to the
   intended client account, the Worker name and `CONFIG.self` equal to
   `ferrecar-budget-guard`, the monitored Worker equal to `ferrecar-platform`,
   `plan: "free"` while that is the client's actual plan, and `enabled: false`.
   Confirm actual billing windows and the review expiry; do not guess dates or
   extend them without reviewing coverage. This installation's TOML stores
   `CONFIG` as a triple-single-quoted JSON string. This check refuses missing,
   malformed, expired or enabled configuration without printing client values:

   ```powershell
   $guardText = Get-Content -LiteralPath .\wrangler.toml -Raw
   $guardMatch = [regex]::Match($guardText, "(?ms)^CONFIG\s*=\s*'''(.*?)'''")
   if (-not $guardMatch.Success) { throw 'CONFIG format changed; review it before continuing.' }
   $guardConfig = $guardMatch.Groups[1].Value | ConvertFrom-Json
   if ($guardConfig.enabled -ne $false -or $guardConfig.self -ne 'ferrecar-budget-guard' -or $guardConfig.worker -ne 'ferrecar-platform') { throw 'Stop: scope changed or enforcement is not disabled.' }
   $env:GUARD_REVIEW_CONFIG = $guardMatch.Groups[1].Value
   try {
     node --import tsx --input-type=module -e 'import { configuration } from "./src/configuration.ts"; configuration({ CONFIG: process.env.GUARD_REVIEW_CONFIG }); console.log("Current runtime configuration validates.");'
     if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration validation failed.' }
   } finally {
     Remove-Item Env:\GUARD_REVIEW_CONFIG -ErrorAction SilentlyContinue
   }
   ```

   Preserve binding `GUARD`, class `Guard`, the `v1` SQLite migration and the
   stable instance name `ferrecar-v1`. Keep `* * * * *` as the guard schedule.
   Do not delete/recreate its namespace or clear its state. Do not add app data
   bindings, a runtime `CONTROL_TOKEN`, routes or an enabled-enforcement setting.

4. Confirm the Cloudflare identity/account, then preview the guard upload:

   ```powershell
   node .\node_modules\wrangler\bin\wrangler.js whoami
   node .\node_modules\wrangler\bin\wrangler.js deploy --dry-run --config wrangler.toml --outdir dist/manual-preview
   ```

   Use the client's authorized deployment access. If login is needed, complete
   it interactively. Never substitute the runtime analytics token for installer
   access. Verify the preview names only the guard and its existing `GUARD`
   storage binding. Existing encrypted Worker secrets must be retained.

5. When the reviewed preview is correct, deploy the guard only:

   ```powershell
   node .\node_modules\wrangler\bin\wrangler.js deploy --config wrangler.toml
   ```

   Record the resulting version ID and source commit. This is the actual update
   step. Pushing a commit to GitHub alone does not update the installed guard.

## Verify after deploying

In the client's Cloudflare dashboard, open `ferrecar-budget-guard`:

- Confirm runtime `CONFIG.enabled` is still false and `plan` matches the account.
- Confirm encrypted `ADMIN_SECRET` and `ANALYTICS_TOKEN` are still present and
  `CONTROL_TOKEN` is absent. Do not reveal their values.
- Confirm the existing Durable Object namespace and one-minute cron are retained.
- Read authenticated `GET /status` using the privately saved admin secret. Check
  `enforcementEnabled: false`, `config.enabled: false`, `latched: false` for this observe-only installation, a recent
  `lastGood`, `heartbeatStale: false` and `errors: []`. Read any warning/gaps;
  successful analytics does not mean every product or entrypoint is covered.

HTTP **503 is intentional in observe mode**, including successful checks.
Unauthenticated `/status` returns 404. Judge the authenticated JSON body, not the
HTTP code alone. Healthy state is checkpointed about every 15 minutes; a newly
created cron can take up to 15 minutes to propagate. If metrics remain stale or
there are errors, investigate instead of enabling enforcement.

Use a private client that accepts the admin secret interactively. Do not put the
secret in a URL, a command argument or a shared terminal history. This setup's
temporary private verification form was closed after verification; its old local
URL is not a permanent admin dashboard.

## If an update fails

If validation or the dry run fails, stop; nothing has been deployed by those
steps. If deployment fails, check Cloudflare's active guard version and bindings
before assuming whether the old or new version is active. If the new guard
version has a runtime problem, preserve its local config and storage, review the
last known good source, rerun the dependency/tests/config checks, then redeploy
that source to the **same guard Worker**. Do not reset its namespace or run
`/rearm` to fix a software update. Storage/configuration migrations require a
separate compatibility review before reverting code. Keep enforcement disabled.

## Ongoing maintenance

Even with rare code updates, review actual billing windows, plan, products,
entrypoints and token validity before their configured expiry. A configuration
expiry produces errors; a GitHub connection would not renew it. Read-only tokens
are replaced privately under the same approved permissions and installed only
as encrypted `ANALYTICS_TOKEN`. Do not recreate `ADMIN_SECRET` for ordinary code
updates. No independent watcher or automatic renewal is installed.

## Separate application CI/CD

The client should authorize the Cloudflare Workers & Pages GitHub App for their
`miguelcardoza47-max/Ferrecar-Platform` repository in their own accounts. Choose
**Only select repositories**, granting this repository only. Use the existing
**ferrecar-platform** Worker, then **Settings → Builds → Connect → GitHub**.
Review its current deployment workflow first so there is one intended production
deployment path. Select the application's reviewed production branch and its
actual root/build/deploy commands; do not use the guard's feature branch or its
configuration. Connecting and saving may trigger an application deployment.

The repository's Worker name must match `ferrecar-platform`. Keep application
runtime credentials and data bindings in the client's Cloudflare account. Do
not copy the guard's admin/read tokens into the application build. Confirm a
successful application build and deployment separately. This task does not
authorize, change or verify the application's build commands or CI/CD setup.

Official references: [connect an existing Worker](https://developers.cloudflare.com/workers/ci-cd/builds/),
[GitHub access scope](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/),
[Wrangler deployment](https://developers.cloudflare.com/workers/wrangler/commands/).
