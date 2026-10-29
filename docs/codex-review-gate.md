# Codex review gate — staged installation

This change prepares the repository-side assets from
[`Joey-Tools/codex-gated-repo-template`](https://github.com/Joey-Tools/codex-gated-repo-template)
at **`4686f8a02c205ff2f82c995e6ebf180e3eb552ff`**. The two workflows and
`.github/CODEOWNERS` are copied unchanged. The Disabled ruleset import retains
identical JSON policy; only whitespace follows this repository's formatter.
The generic CI generator is intentionally not copied or run: this project already
has formatter, linter, test, release, and installation-smoke workflows.

## Installed files and trust boundaries

- `.github/workflows/codex-review-gate.yml`: read-only `pull_request` verifier.
  Every subscribed event runs the fixed `codex/github-review-gate` job; there is
  no job-level condition that could turn a skipped verifier into an apparent pass.
- `.github/workflows/codex-review-gate-controller.yml`: protected-default-branch
  controller for official Codex bot comments, canonical verifier completions, and
  exact-head manual recovery. It holds narrowly scoped Actions and PR write
  permissions; neither workflow checks out or executes this repository's PR code.
- `.github/CODEOWNERS`: the canonical managed block names **`@JoeyTeng`** as the
  human owner of workflows and CODEOWNERS. `JoeyTeng-Codex` authors this change;
  it cannot substitute for independent owner approval of its own installation.
- `rulesets/codex-review-gate.json`: **Disabled import template**, not an applied
  protection. It targets the default branch and requires the native gate check
  from GitHub Actions (`integration_id: 15368`), up-to-date branches, Code Owner
  review with stale approvals dismissed, conversation resolution, and no bypass
  actors. It also blocks non-fast-forward changes.

Both workflows intentionally use **`JoeyTeng/codex-review-gate-action@v2`**, matching
this template's compatible floating-major policy rather than inventing a different
workflow or prerelease selector. At inspection time `v2` resolved to action commit
`e965263162351e61ceb8cecc725f6327eab3a8c3`; the reference is deliberately not frozen
to that commit. Future compatible action releases can change executable code
without a consumer workflow change, so the action publisher remains a trust
boundary. Tests pin the copied workflow **bytes** to the template snapshot, not
the future code behind `@v2`.

## This PR does not complete activation

No ruleset, branch protection, Actions variable, secret, token, GitHub App, or
repository permission has been created or changed remotely. The owner must use
the [canonical installation guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.md)
for the remaining rollout; do not treat a green check on this feature branch as a
completed default-branch installation or as its own canary.

The read-only default-workflow-permissions preflight returned **HTTP 403** for
`JoeyTeng-Codex`. Its value is therefore **unknown**, not assumed to be `read`.
No alternate identity or setting write was attempted. Before merge/activation,
an authorized owner must complete the guide's preflight and approval snapshot:

1. Verify the default workflow token permission is `read`, the effective owner
   is eligible, and any existing protection/legacy gate inventory is completely
   read and preserved. Stop on missing authority or an inconclusive inventory.
2. Obtain `@JoeyTeng`'s independent approval of the installation PR's exact final
   head. Keep existing CI and other requirements intact. This is manual trust
   bootstrap; do not make the new check required while its workflow exists only
   on a feature branch.
3. After the approved PR is merged and canonical files are on `main`, stage the
   ruleset **Disabled**. Copying/importing a JSON file is not proof of enforcement.
4. Open a separate harmless canary PR and follow the guide's exact-head review,
   verifier, and protected controller reconciliation procedure. Existing open PRs
   may need a fresh verifier event after installation; a controller cannot invent
   an arbitrary pre-installation verifier run.
5. Only after the canary succeeds, activate and read back the exact ruleset and
   producer binding. Preserve unrelated protections and any legacy requirement
   until the guide's separately authorized cleanup procedure completes. Close the
   canary without merging it.

A successful gate checks Codex evidence. It does not itself prove all discussion
threads are resolved, CI passed, or the PR is merge-ready; the ruleset enforces
conversation resolution independently.

## Optional configuration

The workflows honor the template's organization/repository variables without
changing them here:

- `CODEX_REVIEW_GATE_RUNNER_LABELS`: trusted runner selector as JSON.
- `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true`: fallback when the default
  `ubuntu-slim` runner is unsuitable.
- `CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`: bounded larger evidence scans,
  only when justified by the gate's recovery guidance.
- `CODEX_REVIEW_GATE_AUTO_REQUEST`: the canonical opt-in request path. It is off
  when unset; this PR does not enable it or override organization configuration.
  Follow the installation guide's canary/rollout restrictions before changing it.

The controller accepts optional `CODEX_REVIEW_GATE_REQUEST_TOKEN`; do not commit a
value or add an unnecessary secret. Without it, the default token identity is
retained. A human can request review directly with the exact `@codex review`
comment; use the protected controller for the guide's exact-head recovery flow.

## Validation

`test/codex-gate.test.ts` checks the canonical workflow snapshot, managed owner
block, and Disabled ruleset policy through the existing Vitest suite. These are
local configuration contracts, not a substitute for the live canary or an audit
of the action runtime. Normal project typecheck, formatting, lint, and tests still
run unchanged. No model calls or user Pi-profile changes are needed for them.
