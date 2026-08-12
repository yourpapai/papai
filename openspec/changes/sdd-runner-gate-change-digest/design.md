## Context

See `proposal.md` — Why. The gate MD is rendered by `writeGateDigest` (`gate-model.ts:67-116`) from a `GateDigestInput`. The `### Summary` section at line 80-81 is fed from `gate-digest.ts:97` which sets `summary: state.changeName` — literally the slug. The 5-tuple this change extracts lives verbatim in:

- `proposal.md` `## Why` (project rule enforces this section in every proposal; "Keep proposals under 500 words" keeps it tight).
- `proposal.md` `## Impact` (project rule enforces "Affected code, APIs, dependencies, systems").
- `design.md` `## Risks / Trade-offs` (sdd-runner template section).
- `assumptions.md` (collected today via `gatherAssumptions` from per-round sidecars; already rendered in the gate at `gate-model.ts:110-113`).

`writeGateDigest` is pure (input → string), so adding a new section is additive. `presentGateAt` (`gate-digest.ts:71-108`) builds the `GateDigestInput`; it has access to `ctx.changeDir` and can read the artifacts. The extractor itself is pure-file-read → structured-tuple.

Two existing precedents in `gate-digest.ts`:

1. **`gatherAssumptions`** (line 112-131) — reads sidecars into a structured list. The new extractor follows the same shape: `readArtifactSections(changeDir): ChangeDigest`.
2. **`findingsOf`** (line 137-158) — already used to populate `blockers` / `material` / `nitpicks` on the digest input. The `RISKS` field references these instead of duplicating them.

## Goals / Non-Goals

**Goals:**

- G1. A human opening `gate-<n>.md` for the first time can answer "what is this change and what does it touch" in under 15 seconds, without opening `proposal.md` or `design.md`.
- G2. The digest degrades gracefully — missing sections in the source artifacts render as one-line placeholders rather than failing the gate or producing malformed MD.
- G3. The digest is mode-aware: early gate (cap-hit, no `tasks.md`) renders the 5-tuple without a task summary; final gate (post-convergence, `tasks.md` exists) augments with `tasks: X/Y`.
- G4. No duplication of content already rendered elsewhere in the gate (assumptions list, open findings). The `BLAST` and `RISKS` fields reference those sections by name, not re-render them.

**Non-Goals:**

- N1. No agent-summarizer spawn. Extract-only. The agent-summarizer (Bundle Z in exploration) is a separate change once this one proves the gate surface can absorb a real summary.
- N2. No replacement of the existing `### Summary` (slug) line. It stays as a stable machine-readable anchor.
- N3. No trajectory verdict ("converging vs stuck"), no per-finding diff, no call-graph diagram, no file-touch heatmap beyond simple `## Impact` parsing.
- N4. No change to the gate protocol — parser, checkbox semantics, and resume contract are unaffected. Pure additive content.
- N5. No proposal or design reformatting. The extractor tolerates minor formatting variation in source artifacts.

## Decisions

### D1. Extract-only from existing artifacts, no agent spawn

**Decision.** The 5-tuple is parsed directly from `proposal.md`, `design.md`, and the existing `gatherAssumptions` output. No LLM in the loop.

**Rationale.** The information is already authored in structured sections (project rules enforce `## Why`, `## Impact`, etc.). Extraction is deterministic and trustworthy; an agent summarizer adds polish but also hallucination risk. The agent-summarizer is worth pursuing only after this change proves the gate surface can absorb a real summary — defer to Bundle Z.

**Alternatives considered.**

- *Agent-summarizer spawn between review-cap and `presentGate`.* Higher fidelity, narrative. Rejected for now: ~50k tokens + ~30s per gate, hallucination risk, prompt iteration cost. The extract-only version uses zero tokens and zero additional latency.
- *Require authors to write a `## Gate summary` section in proposal.md.* Rejected: shifts work onto every proposal author; the format would drift; and the gate is the consumer, not the proposal.

### D2. Render option β — new `### Change digest` section, slug stays

**Decision.** The existing `### Summary` section keeps rendering the slug (`shared-tui-renderer`) as a stable machine-readable anchor. A new `### Change digest` section is inserted immediately after it, before `### Cost / duration`. The 5-tuple renders as a labeled bullet block:

```
   ### Change digest

   - **WHAT**: <first 1-2 sentences of proposal.md ## Why>
   - **WHY**: <full proposal.md ## Why>
   - **TOUCHES**:
     - sdd-runner/src/gate-digest-extract.ts (new)
     - sdd-runner/src/gate-digest.ts (edit — writeGateDigest)
     - ...
     - tasks: 8/12        ← final gate only
   - **RISKS**: see "Open MATERIAL findings at cap" / "Nitpicks" below
   - **BLAST**: see "Assumptions (blast-ranked)" below
```

**Rationale.** Three render options were considered in exploration:

- **α** (replace `### Summary`) — smallest move but loses the stable slug anchor that some test fixtures grep for.
- **β** (new section, keep slug) — preserves backward compat, pure additive.
- **γ** (separate `digest-<n>.md` file) — cleanest separation but two files to open.

β wins because it's pure-additive: no parser change, no test-fixture rewrite, no protocol change.

**Alternatives considered.** See α and γ above.

### D3. Five-tuple shape — WHAT / WHY / TOUCHES / RISKS / BLAST

**Decision.** Five fields, with these exact extraction sources and tolerance rules:

| Field    | Source                                              | Tolerance on missing                               |
|----------|-----------------------------------------------------|----------------------------------------------------|
| WHAT     | First 1-2 sentences of `proposal.md ## Why`         | Render `_(no "Why" section in proposal.md)_`       |
| WHY      | Full `proposal.md ## Why`                           | Render `_(no "Why" section in proposal.md)_`       |
| TOUCHES  | Bullets under `proposal.md ## Impact` "Code:" line  | Render `_(no "Impact" section in proposal.md)_`    |
| RISKS    | Reference to existing findings sections             | Always present (findings always rendered)          |
| BLAST    | Reference to assumptions section                    | Render `_(no assumptions logged)_` if list empty   |

WHAT vs. WHY distinction: WHAT is the one-line "extracts four TUI primitives from review-loop into a workspace package" — the human can read it in 2 seconds and decide whether to keep reading. WHY is the longer motivation. Splitting them lets a skimming human stop after WHAT if it's irrelevant.

**Rationale.** The 5-tuple is the minimum that answers the approval-moment questions:

- "What is this change?" → WHAT
- "Why are we doing it?" → WHY
- "What's the blast radius?" → TOUCHES + BLAST
- "What could go wrong?" → RISKS

Fewer fields lose information; more fields add reading load without proportional value.

**Alternatives considered.**

- *Three-tuple (WHAT/WHY/TOUCHES) — drop RISKS and BLAST.* Rejected: those are the highest-leverage fields for trust at the gate; referencing them is cheap (zero extraction cost).
- *Seven-tuple with DEPTH and ROUNDS.* Rejected: those are run-mechanical facts, already in the existing `report <runId>` digest and partly in the trajectory. Belong there, not here.

### D4. Section extractor — pure functions over file content

**Decision.** New module `sdd-runner/src/gate-digest-extract.ts` exposes:

```ts
   extractChangeDigest(input: {
     proposalMd: string         // file content, not path — keeps it pure
     designMd: string
     hasTasksMd: boolean        // mode signal: early gate = false, final gate = true
     tasksDone?: number         // final gate only
     tasksTotal?: number        // final gate only
   }): ChangeDigest
```

Section parsing uses regex anchored to markdown headings (`/^## (\w+)/m`, `/^### (\w+)/m`). Bullets under a section are everything from the heading to the next heading of equal or higher rank. Tolerant: a missing section yields `null` for that field; the renderer renders a placeholder.

**Rationale.** Pure functions over file content keep the extractor trivially testable — no filesystem mocking, no DI. The orchestrator reads the files and passes the strings in. The extractor returns a structured tuple; the renderer (`writeGateDigest`) formats it.

**Alternatives considered.**

- *Use a markdown AST parser (e.g. `remark`).* Rejected: adds a dep for a job that 30 lines of regex do fine. Project rules require justifying new deps; this doesn't clear the bar.
- *Pass file paths into the extractor.* Rejected: couples extraction to disk I/O, complicates tests.

### D5. `presentGateAt` reads artifacts and threads the digest

**Decision.** `presentGateAt` (`gate-digest.ts:71-108`) reads `proposal.md` and `design.md` from `ctx.changeDir`, checks `tasks.md` existence via `existsSync`, and threads the resulting `ChangeDigest` into the `GateDigestInput` it builds for `presentGate`. Missing files (e.g. early gate before `tasks.md` exists) yield `hasTasksMd: false`; missing `proposal.md` or `design.md` (shouldn't happen, but defensive) yields `null` fields rendered as placeholders.

`GateDigestInput` gains `changeDigest: ChangeDigest`. `writeGateDigest` calls a new `renderChangeDigest(digest)` helper to produce the section lines, inserts them between `### Summary` and `### Cost / duration`.

**Rationale.** All gate presentations already pass through `presentGateAt` (both early and final gates, both fresh and veto-induced re-presentations). Wiring there covers every gate MD the human ever sees.

**Alternatives considered.**

- *Wire into `writeGateDigest` directly, take a `changeDir` parameter.* Rejected: `writeGateDigest` is currently pure (input → string), used in tests with synthetic inputs. Adding file reads there breaks testability.

## Risks / Trade-offs

- **[Extractor misparse]** A proposal.md with an unusual heading style (e.g. setext-style `Why\n===` instead of ATX `## Why`) yields `null` for the field. → *Mitigation*: project rules mandate ATX headings; misparse degrades to a placeholder, never fails the gate.
- **[Long `## Why` inflates the gate]** A 400-word Why section (allowed by the 500-word proposal limit) makes the digest section long. → *Mitigation*: WHAT is the human's 2-second summary; WHY can be skipped. The digest's structure (labeled bullets, not prose) makes scrolling past WHY trivial.
- **[Content duplication with `### Open MATERIAL findings`]** The RISKS field references "Open MATERIAL findings at cap" — but that section is only present at the early gate. At the final gate, it's "Nitpicks (informational)". → *Mitigation*: the renderer chooses the reference target based on `input.mode`. Tested explicitly.
- **[Future agent-summarizer duplication]* If Bundle Z (agent-summarizer) lands later, both an extracted digest and an agent digest could coexist. → *Mitigation*: this change renders `### Change digest` (extracted); a future agent-summarizer change can render `### Narrative summary` (agent) — different headers, complementary content. Or supersede this section entirely; both options are non-breaking.
- **[Cost of reading files at every gate presentation]** Reading two files on each `presentGateAt` call. → *Mitigation*: trivial — files are small (<10KB typically), `presentGateAt` runs at most a handful of times per run.

## Migration Plan

No data migration. Gate MD is regenerated wholesale on each presentation; old `gate-<n>.md` files in old run dirs simply lack the new section. No backfill needed — the new section appears in the next run's gate MDs. Rollback: `git revert`. No deployed artifacts, no production state.

## Hook/TDD Interactions

New code files the Write/Edit TDD hook pipeline will gate:

- `sdd-runner/src/gate-digest-extract.ts` (new — section extractors) — test-first: failing tests for each field with present/missing/malformed `proposal.md` and `design.md` fixtures; mode-aware TOUCHES (with/without `tasks.md`).
- `sdd-runner/src/gate-digest.ts` (`GateDigestInput.changeDigest`, `renderChangeDigest` helper, wire into `writeGateDigest`) — test-first: failing test that the rendered MD contains the new section between `### Summary` and `### Cost / duration`, with all 5 fields populated from a fixture.
- `sdd-runner/src/orchestrator.ts` (`presentGateAt` reads artifacts and threads digest) — test-first: failing smoke test that `presentGateAt` populates the digest from a real `proposal.md` fixture in `ctx.changeDir`.

Test order (literal order of work): gate-digest-extract → gate-digest (renderer) → orchestrator smoke. Each task in `tasks.md` follows the failing-test → implement → verify cadence.
