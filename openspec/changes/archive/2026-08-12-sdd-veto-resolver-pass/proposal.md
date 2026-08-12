## Why

The sdd-automation spec (`openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`) says: "Each veto SHALL trigger exactly one resolver pass updating affected artifacts and tasks followed by one re-presentation." The implementation doesn't do this. `runGateResume` (`orchestrator.ts:284-295`) receives `{ kind: 'veto', vetoes }` from `resumeGate`, throws away `outcome.vetoes`, and re-presents the same gate content with a bumped version number. The human's redirect text evaporates. Repeated vetoes loop infinitely with no artifact change. This blocks the `auto-sdd-pipeline` dogfood (task 8.4: "gate-2.md reflects the veto pass") and makes the veto protocol a no-op for any real run.

## What Changes

- **Veto updater agent**: on veto, `runGateResume` spawns an updater agent (drafter-style: write + `openspec validate`) that reads the veto redirects, applies them to the affected artifacts, and writes updated files. The updater follows the drafter's proven write+validate+retry pattern — not a new architectural pattern.
- **Assumption sidecar update**: the updater updates the assumptions sidecar to reflect vetoed assumption text changes, so the re-presented gate shows the narrowed/updated assumption.
- **Re-materialization**: after the updater writes, the runner re-materializes `assumptions.md` from the updated sidecar and re-presents `gate-<n+1>.md` with updated content (new assumption text, new artifact hashes, new cost/duration).
- **`vetoRedirects()` wired**: the existing export (`gate.ts:106`, currently zero call sites) becomes the input to the updater prompt.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (currently delta-ADDED by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, **not yet archived to `openspec/specs/`**): this change's `.openspec.yaml` sets `skip_specs: true` because the capability is not yet in `openspec/specs/`. The spec already describes the veto-resolver-pass requirement ("Each veto SHALL trigger exactly one resolver pass updating affected artifacts and tasks followed by one re-presentation") and two veto scenarios — this change implements what the spec already requires.

## Non-goals

- No change to the review-loop resolver's "declare but don't fix" model (`resolution: 'edited'` is a classification label, not an edit action; the review loop converges through ledger-based suppression, not artifact improvement). Whether to add an updater pass to the review loop itself is a separate question.
- No update-change skill invocation or coherence-audit framework. The updater is a drafter-style spawn (prompt → write → validate → retry on failure), not a multi-step coherence workflow.
- No interactive `--wait` mode or TUI gate editor.
- No papai runtime impact: no platform/task instances, no DB, no scope-model, no `tool_prefs`/capability gating.
- No new third-party deps.

## Impact

- **Code**: `sdd-runner/src/orchestrator.ts` (`runGateResume` veto branch reads vetoes + spawns updater), `sdd-runner/src/gate-digest.ts` (updater prompt builder + assumption-sidecar update helper), `sdd-runner/src/gate.ts` (`vetoRedirects()` finally consumed).
- **Tests**: new cases in `tests/sdd-runner/orchestrator.test.ts` (veto produces changed artifacts + re-presented gate), `tests/sdd-runner/gate-digest.test.ts` (updater prompt + sidecar update).
- **Docs**: `docs/architecture/sdd-pipeline.md` (Gate protocol — note the veto resolver pass).
- **Spec**: no spec change needed — the requirement already exists in the `sdd-automation` delta ("Each veto SHALL trigger exactly one resolver pass…").
- **Affected platform/task instances**: none. **Config-context scope impact**: none.
