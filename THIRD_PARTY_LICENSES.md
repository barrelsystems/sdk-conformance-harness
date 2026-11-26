# Third-party licenses

This file lists the licenses of this package's production (runtime)
dependencies — the packages installed when something depends on
`@barrel-kit/sdk-conformance-harness` or runs its CLI — generated from
`pnpm licenses list --prod --json`. Development-only tooling (test runner,
linter, formatter, bundler, type checker) isn't distributed and isn't
listed here.

| Package | Version | License |
| --- | --- | --- |
| @effect/platform-node | 4.1.4 | MIT |
| @effect/platform-node-shared | 4.1.4 | MIT |
| @redis/bloom | 6.3.1 | MIT |
| @redis/client | 6.3.1 | MIT |
| @redis/json | 6.3.1 | MIT |
| @redis/search | 6.3.1 | MIT |
| @redis/time-series | 6.3.1 | MIT |
| @types/node | 24.19.2 | MIT |
| @types/ws | 8.18.2 | MIT |
| commander | 15.1.0 | MIT |
| effect | 4.1.4 | MIT |
| redis | 6.3.1 | MIT |
| undici | 8.12.4 | MIT |
| undici-types | 7.24.6 | MIT |
| ws | 8.23.0 | MIT |

All 15 production dependency packages are MIT-licensed. None are
copyleft (no GPL/LGPL/AGPL/MPL in this set).

Note: the `redis`, `@redis/*`, `undici`, `ws`, `@types/ws`, and `@types/node`
entries are transitive dependencies pulled in to satisfy `@effect/platform-node`'s
peer dependencies, not packages this harness's own source imports directly.
They are still installed as part of the production dependency tree and are
listed here for completeness.
