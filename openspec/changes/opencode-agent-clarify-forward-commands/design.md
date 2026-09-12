## Context

The workspace's forward paths are its transition table: `canTransition` (`opencode-agent/src/transitions.ts`) is the one acceptance oracle, and every maintainer-facing list of what works in a phase — the refusal comment and the park's waiting comment, both in `run-report.ts` — is derived from it through `acceptedCommands()` (`commands.ts`). There is no second place a forward path can live; widening the machine's acceptance set *is* the documentation fix.

Today `INIT_OR_CLARIFY` accepts `NEEDS_CLARIFICATION` and `CAPTURED` from the table, `ANSWERED`/`CANCELLED` as phase-neutral signals, and nothing else: `canTransition` gates `CONTINUE` to `INCOMPLETE` and `RETRY` to `FAILED`. A run parked there after triage said `clarify` or `answer` — the untrusted-author consent park included — has `/ask`, `/cancel` and a plain reply (`applyClarifyIntent`, `comment-intent.ts`, which re-runs triage) as exits, while the agent's own prose invites `/continue` and the machine refuses it (issue #435). Motivation and intended behaviour: see proposal.md — Why / Intended behaviour change. This is fix-class work with `skip_specs: true` (`.openspec.yaml`); no capability deltas are claimed or invented here.

Two facts shape the approach. The park is a handler phase — `handleTriage` sits in `cascade.ts`'s `HANDLERS`, so once a signal lands in the phase the cascade re-runs triage with the trigger comment visible in the thread; no new handler or dispatch is needed to make a re-entry productive. And `attempts` counts *consecutive failures*, cleared by every forward move and by `ANSWERED` — a re-entry is a handler success in the same doctrine, not a budget event.

## Goals / Non-Goals

**Goals:**

- Every parked `INIT_OR_CLARIFY` state has a command-level forward path that re-enters triage: `/continue` (the word live conversations already use) and `/approve` (the one-word confirmation the consent park was missing).
- The derived hint and waiting comment list `/approve`, `/ask`, `/cancel`, `/continue` in that phase with zero renderer changes — truth by derivation, not by edits to prose.
- The machine's invariants hold: no persisted-shape change, no new signal, no budget change, `/retry` still refused (nothing broke).

**Non-Goals** (design-level, beyond the proposal's scope non-goals):

- No prompt-only fix: the model's prose is a courtesy; the acceptance set is the mechanism.
- No widening to other parks: `DESIGN_SPEC`/`PLAN_REVIEW` already speak `/approve` and `/changes`, `FAILED` keeps `/retry`, `INCOMPLETE` keeps `/continue`. One park is repaired.
- No second spelling of triage re-entry: the command path and the plain-reply path feed the same cascade; nothing new is built for either.

## Decisions

### D1 — Two signals, two mechanisms: a table row for `/approve`, a branch for `/continue`

`/approve` enters through the table: `TRANSITIONS['INIT_OR_CLARIFY']['APPROVED'] = 'INIT_OR_CLARIFY'`, a self-loop. `forwardTransition` then produces exactly the re-entry patch (phase restated to the same value, `attempts: 0`, `lastError: null`, everything else untouched), the row has a precedent in the very line it joins (`NEEDS_CLARIFICATION: 'INIT_OR_CLARIFY'` is already a self-loop), and `canTransition`'s table fall-through makes the acceptance — and therefore the derived hint — true with no further code.

`/continue` cannot be a row: its existing meaning — resume the phase `resumeFrom` names (`resumeTransition`) — reads a field, which the table's signal→phase shape cannot express, and `canTransition` answers `CONTINUE` in an explicit branch *before* the table. So the change is: `canTransition` accepts `CONTINUE` in `INIT_OR_CLARIFY` beside `INCOMPLETE`, and `transition`'s `RETRY`/`CONTINUE` arm splits — `CONTINUE` out of `INCOMPLETE` keeps `resumeTransition` byte-for-byte; `CONTINUE` out of `INIT_OR_CLARIFY` applies the re-entry patch (D2).

Alternatives considered:

- *A `CONTINUE: 'INIT_OR_CLARIFY'` self-loop row*: dead code today (`canTransition` returns before the table for `CONTINUE`) or a dispatch reorder that moves a documented branch; and one signal with two stay-put spellings in one table is the exact drift shape that once let the table and `/ask`'s reach disagree (the `ANSWERED` history recorded in `transitions.ts`). Rejected.
- *Handling `/approve` as a second branch like `CONTINUE`*: duplicates what `forwardTransition` already produces and leaves the table less true than the machine — the hint derives from the table, so a branch-only acceptance is a hint that cannot see it. Rejected.

Why both words and not one: `/continue` is what the agent's own replies invite; `/approve` is what every other human gate in the pipeline speaks. One row plus one branch arm beats a new alias signal or prose mapping nobody derives.

### D2 — The re-entry patch is the `ANSWERED` patch, and it must not read `resumeFrom`

For `/continue` in `INIT_OR_CLARIFY`: phase stays, `resumeFrom` untouched, `attempts: 0`, `lastError: null` — the same patch the `ANSWERED` branch applies. Deliberately **not** `resumeTransition`, even though for a well-formed state its `resumeFrom ?? 'INIT_OR_CLARIFY'` fallback lands in the same place: a hand-edited block sitting in `INIT_OR_CLARIFY` while carrying a stale `resumeFrom` would have `/continue` fling the park into an arbitrary handler phase. Re-entering a phase is a statement about the phase, not about whatever the block happens to carry. The `APPROVED` self-loop gets the same property for free — `forwardTransition` never touches `resumeFrom`.

### D3 — The forward path is the existing cascade; `/retry` stays refused

After the signal applies, nothing new runs: `driveMachine` sees a handler phase and re-runs `handleTriage`, whose prompt already renders the whole thread — so the `/continue` or `/approve` line and any argument reach the model as ordinary conversation text, and triage's three outcomes still decide (including `clarify` again). Alternatives:

- *Auto-proceed when triage's prose says nothing needs clarifying*: the proposal's rejected alternative — parsing free text removes the human gate. Rejected here too.
- *A dedicated re-entry signal*: new `TransitionSignal` vocabulary, a new dispatch arm, and a hint word mapping to no command. Rejected — `CONTINUE` already means you-were-not-finished; this park is where that claim becomes true.
- *Fixing only the prose (stop the model suggesting `/continue`)*: leaves the real gap. A plain reply already re-runs triage for the same intent; refusing the explicit command form while accepting the implicit prose form is the incoherence being repaired.

`/retry` stays refused (`canTransition` keeps `RETRY` → `FAILED`). `/ask` and `/cancel` semantics are untouched. Budgets are untouched: the re-entry clears `attempts` and spends none; the token ceiling still fires before the handler exactly as it does for any comment-driven turn; `/continue` carries no budget gate (only `RETRY`, `REVIEW_REQUESTED` and `CI_FAILED` are gated before the move).

### D4 — `/continue <note>` rides as thread text, not as the note envelope

The `MAINTAINER_NOTE_FRAMING` envelope for `/retry`/`/continue` arguments is an implement-phase mechanism (`implement-prompts.ts`). Triage reads the raw thread render, so the argument is already visible to the triage turn; do not wire the envelope into `triage.ts` — one framing per reader, and this reader sees the whole conversation anyway.

### D5 — One line in `TRIAGE_INSTRUCTIONS`

Invite plain thread replies; never suggest a slash command a phase may refuse. Same split as the protected-paths rule: the prompt is the courtesy, the table is the mechanism. The line cannot make a refusal impossible, but it stops the agent manufacturing the contradiction that hid this bug — prose inviting `/continue` over a derived hint that refused it.

### D6 — Docs are the one manual sync point

`README.md`: the phase table's `INIT_OR_CLARIFY` row, the command table's `/approve` and `/continue` rows, one sentence on the forward path. The derived hint cannot drift from the machine; docs can, and this is the change's only hand-written truth. `commands.ts` gets a doc-comment-only edit (the `/continue` offer derives automatically); `transitions.ts` doc comments are updated where they state the old acceptance set.

### Consequence worth naming — the consent park

The untrusted-author park gains its one-word confirmation: a maintainer's `/approve` re-runs triage under the maintainer's own author association, the D9 gate passes on that re-run, and capture completes. No code beyond the row; `renderConsent` text is deliberately untouched (outside the proposal's file list).

## Risks / Trade-offs

- [A one-word `/approve` now buys a full triage turn where it used to buy a refusal] → the same spend the plain-reply path already costs; bounded by the token ceiling, which still fires before the handler; the D9 consent gate still arbitrates who may capture.
- [`/continue` clears `attempts`, so a `/continue`↔failure loop never reaches the retry cap the way a plain-reply↔failure loop does] → deliberate: a re-entry is a handler success, the doctrine every forward move and `ANSWERED` already follow; the loop is bounded by the token ceiling, which spans jobs and persists — the budget that actually bounds model spend.
- [The self-loop row softens the table's every-entry-names-a-phase-the-machine-moves-to reading] → the row's doc comment names the self-loop and its `NEEDS_CLARIFICATION` precedent; `state-manager.test.ts` pins both `APPROVED` shapes (forward from `DESIGN_SPEC`, self-loop from `INIT_OR_CLARIFY`).
- [Model prose can still recommend a command a phase refuses] → the `TRIAGE_INSTRUCTIONS` line plus the derived refusal comment naming what does work; a wrong suggestion now costs one readable refusal, not a dead end.
- [Untrusted authors can type `/approve`/`/continue` too] → re-runs triage and re-arms the consent park, exactly as their plain replies do today; no new privilege, no loop a maintainer must break.
- [Mutation dilution on `transitions.ts` (baseline 0.974, 149/153 killed) from the new branch and row] → the new tests assert both the acceptance set and the patch shapes, killing the new mutants; `test:mutate:changed` for the touched gateable files before finishing.
- [A maintainer expects `/continue` in `DESIGN_SPEC`/`PLAN_REVIEW` too, where it stays refused] → the refusal names what works there (`/approve` first) and the README command table states the two phases; not widened deliberately — those parks already have a forward word.

## Migration Plan

No migration: no persisted-shape change, no `STATE_VERSION` bump, no drizzle migration and nothing to backfill — state lives in hidden `AGENT_STATE` blocks on the issue/PR threads, and every field a restored block carries is untouched by the new moves. In-flight parked issues gain the forward path on their next event with no rewrite. Rollback is `git revert`: the acceptance set narrows back, the derived hint re-narrows automatically, and `/continue` returns to the old loud refusal.

Scope, tool-gating and dependency statements, per the planning rules: no papai capability or `tool_prefs` surface is touched — this is `opencode-agent/` dev tooling, and the workspace's own capability grants (`openai-config.ts`) and guardrails are unchanged. No persisted state is keyed by anything new: state blocks remain keyed by the GitHub issue/PR thread (the workspace's own scope model); no storage context id, config context id, platform instance or user id participates, and the papai runtime is untouched. No database, hence no drizzle migration or backfill. No new dependency — the change widens an existing pure-TS table and adds one prompt line, which the existing stack (no framework involved) covers entirely. No new module: the acceptance set lives in the existing `transitions.ts`, the derived offer in the existing `commands.ts`, the prose guard in the existing `prompts.ts` — none of them covers this need today only because their acceptance sets say so.

**Work order (TDD; the Write/Edit hook gates the gateable impl files `transitions.ts`, `prompts.ts`, `commands.ts` via `isGateableImplFile`, so their failing tests land first; the flat mapping pairs each with its suite under `tests/opencode-agent/`):**

1. Repro first, red: `tests/opencode-agent/orchestrator.test.ts`, `phase 1 — triage` — seeded parked `INIT_OR_CLARIFY` (attempts 0, no capture) → `/continue` → triage re-runs, run ends `waiting` at `DESIGN_SPEC`, persisted state advanced, no refusal comment. Fails before the fix (refused, refusal comment posted).
2. `transitions.ts`: the `CONTINUE` set in `canTransition`, the split `CONTINUE` arm in `transition`, the `APPROVED` self-loop row, doc comments (its lines 154–158 and the `commands.ts` 12–16 counterpart).
3. `tests/opencode-agent/state-manager.test.ts`: re-entry tests for both signals; fix the two invalidated assertions — `transition(initialState(1),'APPROVED')` (~line 475; the rejects-test replaces it with a signal `INIT_OR_CLARIFY` still refuses, e.g. `CHANGES_REQUESTED`) and the `CONTINUE is refused in %s` filter (~line 703, excluding `INIT_OR_CLARIFY`).
4. `tests/opencode-agent/commands.test.ts`: `acceptedCommands` for `INIT_OR_CLARIFY` — exactly `/approve`, `/ask`, `/cancel`, `/continue`; `/changes`, `/review`, `/retry`, `/sync`, `/fix` absent.
5. `tests/opencode-agent/orchestrator.test.ts`, `commands and budgets`: seed `PLANNING` for the `/approve`-refused case; the refusal-hint test now includes `/approve` and `/continue` and still excludes `/review`.
6. `prompts.ts` (one line), `commands.ts` (doc comment only), `README.md`.
7. Verify: opencode-agent suites → full `bun run test` → `bun check:full` → `test:mutate:changed` for `transitions.ts`, `prompts.ts`, `commands.ts` (all three baselined in `scripts/mutation/baseline.json`).

## Open Questions

None — the park's gate semantics, the `/retry` refusal, budgets and the file set are fixed by the proposal; everything above follows from the machine's own invariants.
