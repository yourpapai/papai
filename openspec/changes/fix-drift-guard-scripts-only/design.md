## Context

The guard (`opencode-agent/src/git-drift.ts`, `assertManifestsInSync`, called
from `ensureBranch` in `git.ts:117`) runs one
`git diff --name-only origin/<base> HEAD -- bun.lock package.json
:(glob)**/package.json` and refuses on any listed path. The workflow installs
from the base checkout (`bun install --frozen-lockfile`) before the branch
switch and never reinstalls, so the guard protects every post-switch check
from a `node_modules` that cannot serve the branch. What it cannot distinguish
today is *which bytes* changed: issue #360's one-line `scripts` edit is
byte-different and therefore refused, though no install-relevant state moved.
The guard's injected seam is `GitFn` (`opencode-agent/src/git-commit.ts`), so
the fix needs no new boundary.

## Goals / Non-Goals

**Goals:**

- Refusal condition tracks install-relevant manifest fields, so forward
  scripts/metadata edits by the implement phase or review loop stop parking
  post-delivery runs.
- Keep every existing property: fail-closed posture, `bun.lock`
  any-diff refusal, `/sync`'s `allowDependencyDrift` pass-through, the
  `isDependencyDrift` / `isRetryFutile` bookkeeping (attempts carried, never
  spent), and the remedies in the message.

**Non-Goals:** (see proposal.md Non-goals for scope exclusions — no escape
hatch, no `/sync` widening, no implement-phase warning, no lockfile
content-awareness). Design-level addition: no change to where the guard runs
or to the `Git` interface shape beyond reads the seam already allows.

## Decisions

### D1. Compare parsed JSON fields, not diff text

For each changed non-lock manifest, read both blob versions via the injected
`GitFn` (`git show <ref>:<path>` — argv vector, `shell: false`, same as every
other git call here), `JSON.parse` both, extract the install-relevant keys,
and compare with `isDeepStrictEqual` from `node:util`.

- *Why not word-diff parsing*: `git diff` output is formatting- and
  key-order-sensitive; a re-serialized but semantically identical
  `dependencies` map would refuse, which is exactly the false-positive class
  this change exists to remove.
- *Why not a diff library*: stdlib parse + deep-equal is enough; a dependency
  for one comparison fails the minimality ladder.
- *Cost*: two extra git reads per changed manifest, only when a manifest path
  changed at all — rare, and the guard already sits before any paid work.

### D2. One named constant for the field list, beside the guard

`INSTALL_FIELDS` (or equivalent) sits next to `MANIFEST_PATHS` in
`git-drift.ts` with a comment naming why each member is install-relevant —
the four dependency maps (what resolves), `resolutions`/`overrides`
(how it resolves), `workspaces` (what exists), `trustedDependencies` and
`patchedDependencies` (what code install executes / what package content is
patched — kept for the security posture even though this job installs from
base). Deliberately excluded: `packageManager` (the workflow pins the runtime
itself), `scripts` (inert — this job never installs from the branch), and
`name`/`version` metadata. Exclusions are named in the comment so the next
bun knob has a place to be judged.

### D3. Fail closed on every unknown shape

A manifest that fails `JSON.parse` on either side counts as drifted for that
file; a one-sided manifest is compared against `{}`, so an added workspace
declaring any install field refuses, and one naming only `name` passes.
Deleting a manifest that carried install fields also refuses (removing a
workspace changes install state). No parse error is ever swallowed into a
pass.

### D4. Diagnostics upgrade, message contract unchanged

`dependencyDriftError` takes the drifted fields per file and renders them in
the opening line (e.g. `` package.json (devDependencies, resolutions) ``),
keeping the remedies text, the "nothing is lost" framing, and the no-bare-
`/retry` rule byte-for-byte. Codes, `isDependencyDrift`, `isRetryFutile` and
`phase-failure.ts`'s attempts-carried handling are untouched — the deadlock's
bookkeeping half was already correct; only the trigger was wrong.

### D5. Tests ride the existing `GitFn` seam

A new `tests/opencode-agent/git-drift.test.ts` stubs `GitFn` to return the
path list and canned `git show` payloads: scripts-only pass (the #360 shape),
field-level refuse per field family, re-format-only pass (same map, different
key order/whitespace), lockfile refuse, malformed JSON refuse, one-sided
both ways. No repository fixture needed — the seam already answers
everything the guard reads.

## Risks / Trade-offs

- [A future bun install-relevant field is missing from the list → guard
  passes a branch that then fails checks with import errors] → the failure
  mode is the pre-guard status quo (TS2307-class), not worse; the constant is
  the single place to extend, and D2's comment names the judging criteria.
- [JSONC manifests (comments) parse-fail → false-positive refusal] → fail
  closed is the documented default; this repository's manifests are plain
  JSON, and a refusal names the file so the cause is visible.
- [Field-level compare drifts from real `bun install` behavior over time] →
  accepted: the guard approximates "can base's node_modules serve this
  branch"; exactness would mean running install from the branch, which the
  design keeps off-limits.

## Migration Plan

None: pure pipeline-tooling change, no persisted-state or workflow-YAML
edits. Rollback is revert. In-flight drift parks (issue #360) become
runnable by `/retry` once a job with the new guard code picks the command
up.
