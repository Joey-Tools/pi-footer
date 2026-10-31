# pi install smoke: pnpm git install

## Symptom

The `pnpm / git` job of `.github/workflows/pi-install-smoke.yml` failed with
pnpm 11.28.9 and pi 1.4.0, independently of the code under test (it also failed
on `main` for a formatting-only change). Every other job passed, including
`pnpm / relative-path`, `npm / git` and `bun / git`.

In run 40946608503 (job 123703523951) pi ran:

```text
pnpm --config.auto-install-peers=false --config.strict-peer-dependencies=false --config.strict-dep-builds=false install --prod --config.auto-install-peers=false --config.strict-peer-dependencies=false --config.strict-dep-builds=false
```

That install added `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
(declared only as `peerDependencies`) and then failed with
`ERR_PNPM_IGNORED_BUILDS` for `@google/genai` and `protobufjs`, which those
peers pull in.

## Observed CI configuration mismatch

Each `--config.*` flag reached pnpm twice:

- The workflow configured pi with
  `npmCommand: ["pnpm", "--config.auto-install-peers=false", "--config.strict-peer-dependencies=false", "--config.strict-dep-builds=false"]`.
- pi 1.4.0 (`packages/coding-agent/src/core/package-manager.ts`) prepends the
  `npmCommand` arguments and, for pnpm, already appends
  `install --prod --config.auto-install-peers=false --config.strict-peer-dependencies=false --config.strict-dep-builds=false`
  to git dependency installs (and the same three flags to npm-source installs).

Same run, same pnpm version, same `package.json`: the `pnpm / relative-path`
job's own `pnpm install --prod --no-frozen-lockfile` with each flag given once
installed only `chalk`. Given twice, pnpm behaved as if the settings were at
their pnpm 11 defaults (peers auto-installed, strict dependency builds on).

The failing invocation also puts the first set of flags before `install`, while
the passing standalone invocation puts them after it and uses
`--no-frozen-lockfile` in the checkout rather than Pi's clone. Removing the
redundant workflow arguments repairs the managed install, but does not isolate
whether duplication, option position, or their interaction caused pnpm's parser
behavior. The exact parser mechanism is not claimed to be proven.

## Fix

- Configure pi with a bare `npmCommand: ["pnpm"]` so pi's own peer-isolation
  flags are passed exactly once. The local-path step keeps passing them once
  itself. pnpm stays on major 11 and no dependency builds are approved.
- `.github/scripts/verify-git-runtime-deps.mjs` runs after every git-method
  `pi install`. It inspects pi's real clone at
  `$PI_CODING_AGENT_DIR/git/github.com/$GITHUB_REPOSITORY` read-only. It fails
  if a runtime dependency is missing or is a broken symlink, or if a host peer
  (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) is present in
  `node_modules`, even as a broken symlink, or in pnpm's `node_modules/.pnpm`
  store.
- `test/ci-runtime-deps.node-test.mjs` covers the guard with fixtures in a
  temporary directory. It runs in `ci.yml` via `node --test` and is outside
  Vitest's default discovery.

## Status

Verified locally: all 507 existing Vitest tests, 16 guard fixture tests,
typecheck, formatting, and lint pass.

Verified on GitHub Actions at repair commit `ee0b0bb39bf5e21598f3756ba4a7cdae3e9fadab`:
[install-smoke run 40952773955](https://github.com/Joey-Tools/pi-footer/actions/runs/40952773955)
passes **all six** PR install paths (Git and relative path with npm, pnpm 11,
and Bun), including the new peer-isolation guard for all three Git installs.
[Main CI run 40952773881](https://github.com/Joey-Tools/pi-footer/actions/runs/40952773881)
also passes, including the 16 Node fixture tests. No runtime footer changes or
pnpm major-version downgrade were needed.
