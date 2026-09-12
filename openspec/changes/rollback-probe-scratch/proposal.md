## Why

The afk-runner pipeline's rollback doctrine (`git revert` of the offending commit, per `docs/architecture/afk-runner.md`) has never been exercised end-to-end on a deliberately disposable change. A minimal scratch artifact is needed as a probe: something trivially reviewable, behavior-free, and safe to revert, so the detect→review→revert path can be proven live without risking real behavior.

## What Changes

- Add `openspec/changes/rollback-probe-scratch/marker.md` containing the single line `rollback probe`.
- Sets `skip_specs: true` in the change's `.openspec.yaml`: the artifact is an inert marker file with no spec-level behavior, so no delta specs are produced.

## Capabilities

### New Capabilities

None. Without a new capability nothing breaks — the marker file carries no behavior; a "rollback-testing" capability would be invented solely to satisfy validation.

### Modified Capabilities

None. No requirements under `openspec/specs/` change; the write touches only a new file inside `openspec/changes/`.

## Impact

- Files: `openspec/changes/rollback-probe-scratch/marker.md` (new, one line).
- No platform or task instances affected; no config-context scope impact (nothing per-user, group-shared, or thread-isolated changes).
- No code, API, dependency, or system changes; docs affected: none modified — the probe exercises the rollback doctrine already documented in `docs/architecture/afk-runner.md`.

## Non-goals

- Any product behavior, capability, or requirement change — declined: rollback itself is a git-level mechanism already covered by the afk-runner module's documented doctrine; extending it is out of scope for this probe.
- Changes to afk-runner code, hooks, pipeline stages, or the SDD gate protocol.
- Any artifact outside the change folder (`marker.md` and change metadata only).
