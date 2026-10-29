# Upstream PR evaluation — first fork integration

Evaluated on 2026-10-29 against upstream `wobondar/pi-footer` main at
`a17da674a69e119ff7f109dec55cacdb1340ee64`. This covers all **11 open PRs** at
that point; later upstream updates are not implicitly included.

## Scope

The fork's intended direction is an easy-to-use **footer layout composer** for
information published by other extensions. This first integration takes useful,
reviewed upstream improvements without stripping existing features yet.

- Preserve the layout editor, explicit save/discard, rows, styling, and flex alignment.
- Preserve both `ctx.ui.setStatus()` and `pi.events` integration, including incoming
  status ANSI styling unless the user deliberately overrides it.
- Keep host packages as `"*"` peers and support source-based local, Git, and npm
  installs without a build step.
- Keep unrelated domain-metric features and major toolchain changes out of this PR.
- Do not install or activate this fork in the user's Pi profile as part of evaluation.

## Decisions

Upstream heads and individual commits below are pinned evaluation inputs, not an
assertion that an entire upstream PR was merged unchanged.

| Upstream PR | Evaluated head | Decision | Rationale |
| --- | --- | --- | --- |
| [#71: compiled entry](https://github.com/wobondar/pi-footer/pull/71) | `731432b` | Exclude | Points the manifest at ignored `dist/` produced only at publish time. A fresh local/Git checkout can have no extension entry. Adds a build requirement without solving every install mode. |
| [#75: separator options](https://github.com/wobondar/pi-footer/pull/75) | `d718ba3` | Adapt | Take only the small chevron/circle separator additions. Omit unrelated stale lockfile changes; add normalization/formatting tests and document the Nerd Font requirement. |
| [#76: provider-specific cost hiding](https://github.com/wobondar/pi-footer/pull/76) | `4c34d7b` | Defer | A domain-metric option, not layout composition. Its isolated feature commit is `1a2f6ff`; the head also inherits a generated-bundle change that must not be imported accidentally. |
| [#77: bundled entry](https://github.com/wobondar/pi-footer/pull/77) | `53c020e` | Exclude as submitted | Generated bundle contains `hideForProviders` cost code absent from that PR's source. It also embeds package metadata, making dependency/version changes require artifact regeneration. Prefer the smaller no-build startup fix in #95. |
| [#78: speed units](https://github.com/wobondar/pi-footer/pull/78) | `2dcbe1b` | Defer | Adds throughput-display options outside the composer's core purpose. Revisit only if the corresponding built-in metrics survive the next scope review. |
| [#94: flex right-side preservation](https://github.com/wobondar/pi-footer/pull/94) | `0ac710f` | Take minimal fix, harden | Take `b4e9c25`, preserving the right group before truncating the left. Exclude the later forced four-column gap and widget-specific cwd/branch abbreviation/hiding. Add narrow-budget and styled external-status regression coverage. |
| [#95: direct TypeScript imports](https://github.com/wobondar/pi-footer/pull/95) | `f1d5dd2` | Take source commit | Cherry-pick `38d0008`, not its later main-merge commit. Direct `.ts` specifiers avoid unnecessary resolver fallback while retaining source installation. Resolve overlapping imports mechanically and guard against regressions. |
| [#120: Git refresh interval](https://github.com/wobondar/pi-footer/pull/120) | `c951662` | Take, validate integration | Default 30-second freshness instead of two seconds, configurable in JSON; refresh after agent runs/branch notifications; preserve invalidation during an in-flight fetch. Relevant performance improvement while Git widgets remain. |
| [#123: Vitest 5](https://github.com/wobondar/pi-footer/pull/123) | `dd34af1` | Defer together with #124 | Major tooling change without a required product benefit. The two PRs individually have incompatible exact peer versions; Vitest 5 also excludes the local Node 25 runtime. Keep the existing working runner for this integration. |
| [#124: coverage-v8 5](https://github.com/wobondar/pi-footer/pull/124) | `b58ed7c` | Defer together with #123 | Must be assessed as a coordinated runner/coverage migration, not an independent dependency bump. |
| [#126: oxfmt 0.74](https://github.com/wobondar/pi-footer/pull/126) | `94a5b09` | Take | Small development-only formatter update. Upstream's check job passes; validate locally with the integrated code. |

## Why only part of #94?

A generic composer should not infer meaning from widget content. Later commits
in #94 special-case working-directory and branch widgets, use fixed width budgets,
and can hide a branch whose suffix matches the directory name. They also reserve
four spaces even where one space would let the configured content fit.

The retained behavior instead has a simple contract:

1. If the right group fits, keep it intact and at the right edge.
2. Reserve one space between groups; truncate or drop the left group as necessary.
3. If the right group alone is too wide, truncate it within the available columns.
4. Use the host's terminal-width helpers for ANSI and Unicode handling.
5. Never reinterpret or silently remove a user's configured widget.

## Validation and measurements

The unmodified base passed **507 tests** across 99 files, typecheck, formatting,
and lint before integration. The selected upstream commits, before local
regression additions, passed **514 tests** and the same gates.

The completed integration passes **539 tests** across 104 files, typecheck,
formatting, and lint. Source and production-tarball loader/render checks pass
against both the locked development peer (Pi 0.87.1) and the installed Pi 1.4.0
host, on Node 25.8.2. The tarball has 119 files and its production install contains
only the runtime dependency `chalk`; no host peers or dev tools are installed.
Node 22/24 are not locally validated. CI targets Node 24 and now checks both the
locked development host and a separately installed Pi 1.4.0 host.

Additional validation targets observable behavior:

- Public renderer output at ordinary, narrow, zero, and negative widths.
- Intact right-edge external statuses and semantic ANSI colors, including warning
  versus normal/dim styling; wide and combining characters on the truncated left.
- Extension registration and footer lifecycle: interval caching, agent-end and
  branch invalidation, invalidation while fetching, no Git commands in status-only
  layouts, and disposal of branch listeners/repaint callbacks.
- Every source-relative module specifier resolves directly to a packaged file.
- The real Pi SDK loader and footer rendering with isolated settings, using both
  the source checkout and an extracted production tarball with runtime deps only.

### Local A/B extension-load benchmark

Both revisions were archived into sibling temporary directories and installed
with runtime dependencies only (`chalk`). The baseline is `a17da67`; the selected
upstream changes are `6553114`. The later hardening/tests do not change the module
specifier graph. Each sample runs in a fresh Node process with isolated settings.
The host is **Pi 1.4.0**, runtime **Node 25.8.2**, on the same local macOS machine.
The measured operation is `discoverAndLoadExtensions()` **after importing the host
SDK**: resolution, transformation, evaluation, and the extension factory—not total
CLI startup, interactive rendering latency, or model latency.

| Transform cache | Samples per revision | Baseline median (min–max), ms | Integrated median (min–max), ms |
| --- | --- | --- | --- |
| Warm, after one discarded priming run | 15 | 1,067.1 (1,025.9–1,147.9) | 52.1 (51.1–60.4) |
| Empty per sample | 5 | 1,693.3 (1,677.3–1,722.1) | 558.3 (551.8–597.2) |

The host SDK import is excluded and had medians around 366–375 ms. These are local
measurements, not a promise of the same speedup on every installation. An earlier
trial overlapped with the test suite; it is not used in this table. Artifact
parents can be reused safely because each script invocation creates a new run
subdirectory; cold runs cannot silently inherit a previous invocation's cache.

Reproduce with a runtime-only baseline archive and the same host for both package
roots:

```bash
PI_FOOTER_HOST_DIR=/path/to/pi-coding-agent npm run benchmark:import -- /path/to/baseline --runs 15
PI_FOOTER_HOST_DIR=/path/to/pi-coding-agent npm run benchmark:import -- /path/to/integrated --runs 15
# Repeat each command with --runs 5 --cold for empty transform caches.
```

The fork PR records final validation status. Upstream benchmark numbers remain
contributor reports rather than substitutes for these local measurements.

## Existing issues this integration does not claim to fix

- [#122: index-lock contention](https://github.com/wobondar/pi-footer/issues/122):
  #120 reduces refresh frequency but does not disable Git's optional index writes
  or redesign the 500 ms subprocess timeout.
- Git refresh still collects a broad snapshot rather than only the enabled
  widgets' data. There is no new background polling timer; the interval controls
  freshness when a footer render asks for data.
- Session and turn metrics are still collected on renders, even for layouts that
  do not need all of them.
- Multiple flex separators still use the existing first-split behavior.
- Pre-existing lifecycle/concurrency behavior outside the adopted changes is not
  comprehensively redesigned here.

## Next phase — scope decision, not implementation

After this integration PR is reviewed, evaluate which *data producers* should move
out of the layout plugin: Git collection, project-runtime subprocess detection,
provider/request inspection, token/cost/speed computation, and detailed session
analytics. Existing configurations and the native-like footer preset need an
explicit compatibility/migration decision before deleting their widget types.

The core to protect is external status discovery/selection, the event adapter,
rows and alignment, ANSI-aware width handling, straightforward styling, and an
accessible configuration UI with live preview and reliable save/discard. The UI
is part of the desired product, not something to delete merely because it is a
large part of the codebase. Lazy loading and simplifying it can be evaluated
separately from removing user-facing configuration.

No feature removal or provider migration is part of this first PR.
