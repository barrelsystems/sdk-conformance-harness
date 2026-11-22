# sdk-conformance-harness

A shared conformance test harness for Barrel's per-platform SDKs (Electron,
Tauri, Swift, and future ports): a shared harness drives a small
per-language "test service" each SDK implements once, over plain HTTP.

## Why

Each SDK independently implements the same check-in/Policy wire protocol, in
its own language. Nothing today automatically catches one SDK drifting from
that protocol the way the others implement it — this harness is that check,
run in each SDK repo's own CI.

## How it works

1. This harness starts its own HTTP server that simulates Barrel's real
   check-in/pre-action-check backend, fully under a scenario's control (what
   `Policy` to return, signed with a fresh per-run keypair).
2. Each SDK repo implements a small "test service": a standalone HTTP server,
   in that SDK's own language, that calls its production runtime and exposes
   it over the contract in `src/protocol/testServiceApi.ts`.
3. This harness drives that test service through a set of scenarios, each
   asserting the adapter's resulting state/behavior matches the protocol
   spec: signed Policy decoding and caching, informational priority hints,
   signature rejection, and fail-open pre-action checks at both stages.

`getPolicy` calls the public SDK getter (`null` before a verified check-in).
Scenarios drive production cadence, download, and apply paths; counters at the
native updater boundary verify which actions actually start. Pre-action checks
must finish before either action starts and must preserve the cached Policy.
Cadence scenarios verify configured intervals, opt-in diagnostics, lifecycle
triggers, bounded requests, skipped overlapping attempts, installation-ID save
recovery, and UTF-8 attribute bounds on production check-ins. Lifecycle commands
use native notifications on Electron/Swift and the production focus-event handler
on Tauri, whose mock runtime cannot emit OS focus events.
Buffer scenarios exercise production stores, raw check-in payloads, and orderly
process exit: adjacent merging, 32-entry priority eviction, title exclusion,
concurrent writes, and clearing only the acknowledged snapshot. Blocked native
writes must leave observations responsive; failed writes must preserve memory
and retry on the next change. Both settled and pending writes must recover the
latest complete snapshot in a fresh process after the production exit hook.

No shared runtime code crosses the language boundary — only the protocol
definitions in `src/protocol/` are the normative contract, independently
re-implemented by each test service.

## Usage

```sh
pnpm build
node dist/cli.js conformance <your-test-service-base-url> [--junit <path>] [--history <path>] [--history-runs <n>]
node dist/cli.js equivalence <name1>=<url1> <name2>=<url2> ... [--junit <path>]
```

`--junit` additionally writes results as JUnit XML, which GitHub Actions'
own test-reporting tooling consumes directly for a PR-visible check summary.

`--history` (default `.conformance-history.json`, resolved relative to the
current directory) is the run-history file tier-1 relegation reads and
updates every run. Commit it in whichever repo invokes this CLI -- each
SDK repo's own CI needs to persist it across runs by committing the
updated file back after a conformance run, which this harness can't do
on its own. The read-modify-write against that file is unsynchronized,
so concurrent runs sharing one history path (a CI matrix, retries) can
race and lose updates, and a forked-PR run with no push-back access will
never accumulate real history.

## Scenario tiers

Scenarios are tiered rather than binary pass/fail: tier 1 must pass at
100%; tier 2 may regress to an 80% pass rate before the run fails. See
each scenario's own `tier` field.

A tier-1 scenario that fails every one of its last `--history-runs` runs
(default 5) auto-relegates to tier 2 for that run's gate -- logged loudly
as `RELEGATED: ...` -- rather than continuing to build-fail CI on a
regression nobody's fixed yet.
