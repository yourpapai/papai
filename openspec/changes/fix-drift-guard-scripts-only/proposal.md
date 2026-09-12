## Why

PR #362 (issue #360) is deadlocked: the change's own deliverable edits one
`scripts` line in `package.json`, and the dependency-drift guard
(`opencode-agent/src/git-drift.ts`) refuses any branch whose manifest **paths**
differ from base — content-blind. The implement phase and the review loop
legitimately produce such edits, then every later job's `ensureBranch` parks the
run in `FAILED` (`DEPENDENCY_DRIFT`) where `/retry` reproduces the refusal,
`/sync` has nothing to merge (the branch is ahead, not behind), and `/review`
is refused from `FAILED`. A guard whose own doc comment says "a false positive
here is not free" has a false positive with no command-level exit. The refusal
condition must match what actually desyncs `node_modules`: changes to the
fields `bun install` consumes, not any edit to a file named `package.json`.

## What Changes

- `assertManifestsInSync` becomes content-aware: a changed `package.json` /
  `**/package.json` refuses the branch only when the diff touches
  install-relevant top-level fields (`dependencies`, `devDependencies`,
  `optionalDependencies`, `peerDependencies`, `resolutions`, `overrides`,
  `workspaces`, `trustedDependencies`, `patchedDependencies`), compared by
  deep equality between `origin/<base>` and `HEAD` versions of the file.
- `bun.lock` keeps its unconditional path-based refusal (any byte change can
  desync `node_modules`).
- A manifest that cannot be parsed as JSON on either side is treated as
  drifted (conservative default, refusal names the file).
- `dependencyDriftError` reports the drifted fields per file (not just file
  paths), keeping the same remedies (`/sync`, hand merge) and the same
  `isDependencyDrift` / `isRetryFutile` bookkeeping.

## Capabilities

### New Capabilities

- `agent-manifest-drift-guard`: when the opencode-agent pipeline must refuse
  an agent branch whose dependency state cannot be served by a base-branch
  install, and what it must let through — the refusal condition, the
  conservative defaults, and the diagnostics the refusal reports.

### Modified Capabilities

None. `openspec/specs/` carries no spec for the guard (the original change
2c0365034 predated the corpus); the new capability is its first.

## Impact

- Code: `opencode-agent/src/git-drift.ts` (guard), `opencode-agent/src/errors.ts`
  (message fields), tests under `tests/opencode-agent/` (drift fixtures for
  scripts-only, field-level, added/deleted-manifest, malformed-JSON cases).
- Docs: `opencode-agent/CLAUDE.md` (the `ensureBranch` drift rule paragraph),
  `opencode-agent/README.md` operator notes.
- No papai runtime impact: no platform or task instance, no config-context
  scope (per-user / group-shared / thread-isolated) is touched — this is
  agent-pipeline tooling only, and `/sync`, `/retry`, `/review` semantics are
  unchanged.
- Security posture unchanged: the job still never installs from the agent
  branch; `bun.lock`, lifecycle-script execution gates (`trustedDependencies`)
  and patch/override fields remain refused.

## Non-goals

- **No operator escape hatch for intentional dependency changes** (e.g.
  `/review --allow-drift`): installing from a model-written branch in the
  secrets job stays out of reach by design; a maintainer reconciles by hand.
- **No `/sync` widening**: it stays the backward-drift remedy; a branch ahead
  of base still has nothing to merge.
- **No early warning in the implement phase** when a deliverable edits
  dependency fields — with the content-aware guard only genuine install-state
  changes park, which is already maintainer territory; declined until a live
  incident shows token burn worth the extra prompt surface.
- **No change to `bun.lock` handling**: content-awareness for the lockfile is
  not attempted; any diff refuses.
