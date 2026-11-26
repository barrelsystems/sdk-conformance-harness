# Contributing

Thanks for your interest in improving the conformance harness.

## Reporting bugs and requesting features

Use [GitHub Issues](https://github.com/barrelsystems/sdk-conformance-harness/issues)
for both. For a bug, include the harness version, the SDK test service and
version you ran it against, the command you ran, and the console/JUnit
output. For a feature or new scenario, describe the protocol behavior it
should check and which SDK(s) it applies to.

## Local development setup

Requires Node 22.19+ on the 22.x line or Node 24.11+ on the 24.x line, and
the pnpm version declared in `package.json`'s `packageManager` field.

```sh
pnpm install --frozen-lockfile
pnpm build
```

To exercise the CLI against a running SDK test service, see the
[README](README.md#run) and [docs/running.md](docs/running.md).

Use `pnpm dev` to rebuild on change while iterating.

## Before opening a pull request

Run the same checks CI runs, in this order:

```sh
pnpm format:check   # oxfmt
pnpm lint            # oxlint
pnpm unused           # knip
pnpm typecheck        # tsc --noEmit
pnpm test -- --run    # vitest
pnpm build            # tsdown
```

`pnpm format` applies formatting fixes automatically; `pnpm format:check` is
what CI enforces. Fix any lint, unused-code, type, or test failures before
pushing — CI runs the identical commands and will block the PR otherwise.

If you're adding or changing a conformance scenario, update the scenario
catalog and [docs/running.md](docs/running.md) in the same PR so the two
stay in sync.

## Pull request process

- Target the `master` branch.
- Keep PRs focused on one change; split unrelated fixes into separate PRs.
- Write commit messages and the PR title as `type: description`
  ([Conventional Commits](https://www.conventionalcommits.org/)).
- Describe what changed and why, and link the issue it resolves, if any.
- A maintainer will review and may ask for changes before merging.

## Code of conduct

This project follows the guidelines in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Please read it before
participating.
