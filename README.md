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
   in that SDK's own language, that calls its real adapter code and exposes
   it over the contract in `src/protocol/testServiceApi.ts`.
3. This harness drives that test service through a set of scenarios, each
   asserting the adapter's resulting state/behavior matches the protocol
   spec.

No shared runtime code crosses the language boundary — only the protocol
definitions in `src/protocol/` are the normative contract, independently
re-implemented by each test service.

## Usage

```sh
pnpm build
node dist/cli.js conformance <your-test-service-base-url> [--junit <path>]
node dist/cli.js equivalence <name1>=<url1> <name2>=<url2> ... [--junit <path>]
```

`--junit` additionally writes results as JUnit XML, which GitHub Actions'
own test-reporting tooling consumes directly for a PR-visible check summary.

## Scenario tiers

Scenarios are tiered rather than binary pass/fail: Tier 1 scenarios must
pass at 100%; Tier 2 scenarios may regress to an 80% pass rate before
relegation. See each scenario's own `tier` field.
