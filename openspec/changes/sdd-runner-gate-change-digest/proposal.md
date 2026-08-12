## Why

The early gate's `### Summary` slot is literally the change slug (`shared-tui-renderer`), and the final gate inherits the same. A human opening `gate-1.md` after 43 minutes of agent work sees the slug and a trajectory of counts — nothing about *what the change is*, *what it touches*, or *why it's safe to approve*. The information exists in `proposal.md`, `design.md`, and `assumptions.md`; it just isn't extracted into the approval surface. This change adds a `### Change digest` section to the gate MD, populated by extracting a 5-tuple (`WHAT`, `WHY`, `TOUCHES`, `RISKS`, `BLAST`) from existing artifacts — no agent work, no new spawn, no schema migration.

## What Changes

- **New `### Change digest` section** in `gate-<n>.md`, inserted between `### Summary` (the slug, unchanged) and `### Cost / duration`. Renders a 5-tuple extracted from existing artifacts:
  - **WHAT** — first 1–2 sentences of `proposal.md ## Why` (the problem statement).
  - **WHY** — full `proposal.md ## Why` (the motivation, can be longer).
  - **TOUCHES** — bullets parsed from `proposal.md ## Impact` "Code:" line(s); at the final gate, augmented with a `tasks: X/Y` line.
  - **RISKS** — already-open findings (MATERIAL at early gate, surviving nitpicks at final gate) — already rendered elsewhere in the gate; this section *references* them rather than duplicating.
  - **BLAST** — `assumptions.md` content already collected by `gatherAssumptions` — referenced, not duplicated.
- **New extractor module** (`sdd-runner/src/gate-digest-extract.ts`): pure functions that take `proposal.md` / `design.md` paths and return the structured 5-tuple. Tolerant of missing sections (returns `null` for missing fields; the renderer skips null fields with a one-line placeholder).
- **Render option β**: the `### Summary` slot stays as the slug (preserves backward-compat for parsers/CI that grep for it); the new section is purely additive.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdd-automation` (currently delta-ADDED by `openspec/changes/auto-sdd-pipeline/specs/sdd-automation/spec.md`, **not yet archived to `openspec/specs/`**): `skip_specs: true` per the precedent set by `sdd-veto-resolver-pass`. The "Single human gate" requirement's gate-file content enumeration ("open assumptions ranked by blast radius, unresolved cap-hit BLOCKERs, change summary, cost and duration") gains a new "change digest" subsection. No protocol change — the human's checkbox decisions, the parser, and the resume contract are unaffected.

## Non-goals

- No agent-summarizer spawn. Extract-only. (A higher-fidelity agent summarizer is deferred to a separate change once this one proves the gate surface can absorb a real summary.)
- No replacement of the existing `### Summary` (slug) line — it stays as a stable machine-readable anchor.
- No trajectory verdict ("converging vs stuck"), no per-finding diff, no call-graph diagram, no file-touch heatmap beyond the simple `## Impact` parsing. Each of those is its own exploration thread.
- No change to the gate protocol, parser, checkbox semantics, or resume contract. Pure additive content.
- No effect on platform/task instances, scope model, `tool_prefs`, or capability gating. Runner-internal dev tool.

## Impact

- **Code**: `sdd-runner/src/gate-digest-extract.ts` (new — proposal/design section extractors), `sdd-runner/src/gate-digest.ts` (`writeGateDigest` calls the extractor and renders the new section; `GateDigestInput` gains a `changeDigest` field), `sdd-runner/src/orchestrator.ts` (`presentGateAt` reads `proposal.md` from `changeDir` and threads the digest into `presentGate`'s input). File-by-file breakdown in design D3.
- **Tests**: `tests/sdd-runner/gate-digest-extract.test.ts` (new — section extraction with present/missing/malformed inputs), `tests/sdd-runner/gate-digest.test.ts` (rendered MD contains the new section with the 5-tuple; missing fields render placeholders), `tests/sdd-runner/orchestrator.test.ts` (smoke that `presentGateAt` populates the digest from a real `proposal.md` fixture).
- **Docs**: `docs/architecture/sdd-pipeline.md` Gate protocol section — note the new `### Change digest` subsection and its 5-tuple source map.
- **Affected platform/task instances**: none. **Config-context scope impact**: none — runner-internal dev tool.
