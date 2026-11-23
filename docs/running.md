# Running conformance checks

## Start a test service

Run the relevant command from that SDK's checkout, with its native build
prerequisites installed. Use the listening URL printed by the process.

| SDK                                                       | Command                                                |
| --------------------------------------------------------- | ------------------------------------------------------ |
| [Electron](https://github.com/barrelsystems/sdk-electron) | `pnpm test-service`                                    |
| [Tauri](https://github.com/barrelsystems/sdk-tauri)       | `cargo run --features test-service --bin test-service` |
| [Swift](https://github.com/barrelsystems/sdk-swift)       | `swift run TestService`                                |

The harness rejects services without check-in support. Equivalence requires
at least two distinct SDK implementations; aliases for one implementation do
not provide a cross-SDK comparison.

## Reports and history

```sh
node dist/cli.js conformance <service-url> --junit conformance.xml --history .conformance-history.json
node dist/cli.js equivalence <name1>=<url1> <name2>=<url2> --junit equivalence.xml
```

`--junit` writes results as JUnit XML. Console output includes individual
scenario outcomes. `--history` defaults to `.conformance-history.json` in the
working directory; `--history-runs` defaults to five.

History is a local file. Persist it explicitly if you want history across CI
runs, and give concurrent jobs separate paths: updates are not synchronized.
A fresh or missing history file starts with no recorded outcomes. Writing a
history file does not commit or publish it.

## CI gate policy

Tier 1 failures block the run. Tier 2 requires an 80% pass rate. A tier 1
scenario is eligible for relegation only after the configured number of outcomes
has accumulated and all of them failed. It is then relegated to tier 2 for that
run, with a `RELEGATED` diagnostic. Consequently,
a successful exit can include scenario failures. Review the individual results
and history policy when deciding whether a release is acceptable.

## Development

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm unused
```
