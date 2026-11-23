# Barrel SDK conformance harness

Shared protocol and behavior checks for the Electron, Tauri, and Swift SDKs.
The harness drives each SDK's test service over HTTP and observes its production
runtime. It is a development tool, not an application dependency.

## Run

Use Node 22.19+ on the 22.x line or Node 24.11+ on the 24.x line, and the pnpm
version declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js conformance http://127.0.0.1:3000 --junit conformance.xml
```

Replace the URL with the address printed by a running SDK test service.
[Service commands and CI options](docs/running.md) explain setup and reporting.

For cross-SDK comparison, run at least two different SDK test services:

```sh
node dist/cli.js equivalence electron=http://127.0.0.1:3000 tauri=http://127.0.0.1:3001
```

## Scope

Scenarios cover reporting, verified eligibility handling, fail-open recovery,
persistence, scheduling, and guarded updater actions. Native SDK tests own
platform event/error mappings. Passing this harness does not establish packaged
installation/relaunch behavior or coverage on operating systems that were not run.

The exit code follows the tier and history rules; it does not require every
scenario to pass. Read the [CI gate policy](docs/running.md#ci-gate-policy)
before using the result as a release check.

## Contribute

- [Test-service contract](src/protocol/testServiceApi.ts)
- [Wire contract](src/protocol/wireContract.ts)
- [Scenario catalog](src/runner/scenarios.ts)
- [Developing the harness](docs/running.md#development)
- [Report a problem](https://github.com/barrelsystems/sdk-conformance-harness/issues)
