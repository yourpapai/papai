## Context

See `proposal.md` — Why. The veto branch in `runGateResume` (`orchestrator.ts:284-295`) receives `{ kind: 'veto', vetoes }` and throws `outcome.vetoes` away. `vetoRedirects()` (`gate.ts:106`) has zero call sites outside its own unit test. The re-presented gate-`<n+1>`.md is content-identical to gate-`<n>.md` with a version bump.

Two existing edit models in sdd-runner:

1. **Drafter** (`draft.ts`): `openspec instructions` → agent writes artifact directly → `openspec validate` → retry on failure (up to 2 attempts). Proven, validated.
2. **Resolver** (`review-model.ts`): agent writes sidecar only → runner materializes `review.md`/`assumptions.md`. Never touches `proposal.md`/`specs`/`design.md`.

The review-loop resolver's `resolution: 'edited'` is a classification label, not an edit action — artifacts stay unchanged through the review loop. This is intentional: the loop is a triage/classification loop, not a fix loop. The veto updater is a different concern: applying a specific human redirect, not blanket-fixing findings.

## Goals / Non-Goals

**Goals:**

- G1. On veto, spawn an updater agent that applies the human's redirect(s) to affected artifacts, following the drafter's write+validate+retry pattern.
- G2. Update the assumptions sidecar so the re-presented gate shows the vetoed assumption's new text.
- G3. Re-materialize + re-present gate-`<n+1>`.md with updated content (new assumption text, new hashes, new cost/duration).
- G4. Consume `vetoRedirects()` — wire the existing export into the updater prompt.

**Non-Goals:**

- N1. No coherence-audit framework or update-change skill invocation. The updater is a single drafter-style spawn. If it misses a coherence issue, the human catches it at gate-`<n+1>`.
- N2. No change to the review-loop resolver model (`resolution: 'edited'` stays a label).
- N3. No per-edit human confirmation during the veto pass — the human already gave direction (the redirect). The result surfaces at the next gate.
- N4. No change to the drift-check resolver (that's for hand-edits to `tasks.md`, a separate concern).

## Decisions

### D1. Updater = drafter-style spawn, not a new architectural pattern

**Decision.** The veto updater is a `runStageAgent` spawn with role `'resolver'` (the closest existing role) and a prompt that includes: the veto redirects, the current artifact content, and the instruction to apply + check for obvious stale references. After the agent writes, the runner calls `openspec validate --strict`. On failure, retry with the validation error (up to 2 attempts, same as the drafter).

**Rationale.** The drafter pattern is proven and validated. It uses `openspec instructions` for format and `openspec validate` for correctness. A new pattern (update-change skill invocation, coherence-audit framework, sidecar-driven structured edits) adds complexity without proven value for the automated pipeline. The simplest thing that could work.

**Alternatives considered.**

- *Update-change skill pattern.* Read → edit → coherence-check all artifacts → confirm per edit → write. Rejected for the automated pipeline: the human already confirmed by giving the redirect; full coherence audit is unnecessary when the human checks the result at gate-`<n+1>`; per-edit confirmation requires a human in the loop who isn't there.
- *Sidecar-driven structured edits.* Updater writes a JSON sidecar describing changes; runner applies. Rejected: full file content in JSON is verbose; the updater would need to reproduce entire files with small changes; and it introduces a new "apply structured edits" mechanism that doesn't exist and adds a failure surface. The drafter already proves that direct-write + validate works.

### D2. The updater prompt shape

The updater receives:

```
You are revising the "<change>" change. The human reviewed the gate 
and redirected:

  Vetoed assumptions:
  - A1 "guests stay read-only" → suppress autonomous replies only
  
  Vetoed findings:
  - F1 "design lacks rollback" → restructure around a format-helper import

Current artifacts:
<proposal.md content>
<design.md content>
<specs content>

Apply each redirect to the affected artifact(s). After applying, scan 
the other artifacts for stale references to what you changed.

Write updated files to their existing paths.
Write a report to <sidecar>: { "files_updated": [...] }
```

The prompt includes current artifact content (read from disk by the runner, same as the review-loop resolver prompt). The agent writes updated files directly (drafter model). The runner validates.

For assumption vetoes specifically: the updater also writes an updated `resolutions-<round>.json` sidecar with the new assumption text. This feeds `gatherAssumptions` on the next gate presentation, so the re-presented gate shows the narrowed assumption.

### D3. Assumption sidecar update

Vetoed assumptions need their text updated in the sidecar so the re-presented gate reflects the redirect. Two approaches:

- **Updater writes the sidecar directly**: the prompt tells the agent to update both the artifacts AND the assumptions sidecar. The agent has full context (current sidecar content is in the prompt).
- **Runner updates the sidecar from the veto**: the runner mechanically applies `assumption.text = redirect` for each vetoed assumption.

**Decision: runner updates the sidecar.** The veto redirect IS the new assumption text (or a directive for it). For assumption vetoes with a redirect, the runner can mechanically set `assumption.text = redirect` in the sidecar. For finding vetoes with a redirect, the runner updates the resolution's outcome. This is deterministic and doesn't need agent intelligence. The updater agent focuses on the artifact edits (which require understanding content).

If the redirect is guidance rather than verbatim text (e.g., "suppress autonomous replies only" vs "I want the assumption to say X"), the updater prompt includes the redirect as context for how to revise the artifacts, but the sidecar update is mechanical.

### D4. Gate mode preservation on re-presentation

Already implemented in the cap-hit-fidelity change: the veto re-presentation preserves `state.gate.mode`. Early-gate vetoes re-present at `'early'`; final-gate vetoes re-present at `'final'`. The updater runs the same regardless of mode — it applies redirects to artifacts either way. After decompose (final gate), `tasks.md` also exists and might need reconciliation; the updater prompt includes it in the artifact list.

## Risks / Trade-offs

- **[Updater edits wrong thing]** The updater agent might misapply a redirect. → *Mitigation*: `openspec validate` catches format violations; the human reviews the result at gate-`<n+1>` and can veto again or abort. Same safety net as the drafter.
- **[Updater changes unrelated sections]** Like any LLM edit, the updater might rewrite more than necessary. → *Mitigation*: the prompt says "apply each redirect" and "scan for stale references" — not "rewrite the artifacts." The diff is auditable via `gate-hashes-<n>.json` comparison.
- **[Cost]** Each veto now spawns an agent (one updater pass). → *Mitigation*: the spec already requires this ("one resolver pass"). The cost is one agent spawn per veto cycle, bounded by the human's patience.
- **[Assumption text mismatch]** The mechanical sidecar update (`text = redirect`) might produce assumption text that doesn't match what the updater wrote in the artifacts. → *Mitigation*: the redirect is the human's direction — if they wrote "suppress autonomous replies only", that IS the assumption text. The artifacts should reflect it.

## Migration Plan

No data migration. sdd-runner run state is gitignored and per-run. Old runs' veto cycles were broken (gate-`<n+1>` = gate-`<n>`); new runs will get the updater pass. Rollback: `git revert`. No deployed artifacts, no production state.

## Hook/TDD Interactions

New code files the Write/Edit TDD hook pipeline will gate:
- `sdd-runner/src/gate-digest.ts` (updater prompt builder, sidecar update helper) — test-first: failing test for `buildVetoUpdaterPrompt`, then `updateAssumptionsSidecar`
- `sdd-runner/src/orchestrator.ts` (`runGateResume` veto branch) — test-first: failing E2E test that veto produces changed artifacts

Test order: gate-digest unit tests → orchestrator integration test.
