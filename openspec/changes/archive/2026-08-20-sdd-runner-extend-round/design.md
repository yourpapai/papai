## Context

See `proposal.md` — Why. The cap-hit early gate today accepts four payload types (approve / veto / answer / abort) per the `sdd-automation` "Single human gate" requirement. The cap itself is fixed in `review-model.ts:13` (`ROUND_CAPS = { S: 1, M: 3, L: 4 }`) and consumed in `review-loop.ts:153` (`runRound(deps, options, 1, ROUND_CAPS[options.depth], 0)`). `runGateResume` (`orchestrator.ts:255-298`) branches on three outcome kinds (`approved` / `aborted` / `veto`) returned by `resumeGate` (`gate.ts:77`). The `GateResponse` parser (`gate-model.ts:239-251`) already recognizes a `→ <token>` line form, used today for veto redirects, blocker answers, and the `OVERRIDE` marker.

Two structural facts enable a small change:

1. **The `→ <token>` parser branch already exists.** Adding `RUN 1 MORE` as a recognized top-level directive (alongside `ABORT` and `OVERRIDE`) is a small extension, not a new parser.
2. **`runRound` already takes `(startRound, cap, prevOpenBlockers)` as parameters.** The recursion at `review-loop.ts:149` calls `runRound(deps, options, round + 1, cap, openBlockers.length)`. Only the public entry point `runReviewLoop` re-reads `ROUND_CAPS[options.depth]` and hard-codes `1` as the start. Re-entering the loop at `state.round + 1` with a bumped cap is one new call site.

## Goals / Non-Goals

**Goals:**

- G1. At an early cap-hit gate, accept `→ RUN 1 MORE` on its own line as a directive that bumps the effective round cap by exactly 1, runs exactly one more review round, and re-presents the gate at version `n+1`.
- G2. Preserve `state.depth` — the depth profile is a classification, not a budget. Extending does not mutate `M` into `L`.
- G3. Carry the prior round's resolution ledger and blocker state forward to the extended round, so the existing lens-escalation rule (`M gains skeptic when blockers remain after round 2`) keeps working without special cases.
- G4. If an extended round converges, flow into decompose → atomicity → final gate exactly as a fresh `runPostReviewToGate` would — no new convergence path.

**Non-Goals:**

- N1. No `→ RUN N MORE` parameterization. Each extend is exactly `+1`. Repeated extends require re-stating the directive at each successive gate.
- N2. No extend-and-auto-resume (Shape A). Each extend re-gates; the human renews the decision every time.
- N3. No extend at the final gate — post-convergence there is nothing to extend. The parser rejects the directive with a clear error.
- N4. No mid-run budget enforcement (`budgetUsd` is unenforced today; threading it is independent).
- N5. No change to `ROUND_CAPS` itself — the table is the *initial* cap; mutation happens in run state, not in the constant.

## Decisions

### D1. Shape B (extend-and-re-cap), not Shape A (extend-and-auto-resume)

**Decision.** Each `→ RUN 1 MORE` runs exactly one round and re-gates. The human renews the spend decision at every ceiling.

**Rationale.** The whole point of the explicit cap-hit gate is "human owns the budget decision." Shape A — where one `→ RUN 3 MORE` binds three rounds of spend — subtly violates that. Each review round on the profile we just observed (`shared-tui-renderer`) was ~10 minutes and ~250k tokens; auto-resume through several rounds could spend silently. Shape B also re-uses all existing cap-hit plumbing: the gate-`<n+1>` presentation, the trajectory block, the material/blocker surface.

**Alternatives considered.**

- *Shape A (auto-resume to new ceiling).* Smaller interruption surface; one decision per several rounds. Rejected for the budget-control reason above. Also requires a new "auto-resume through N rounds" path that doesn't exist, vs. Shape B which re-uses the existing cap-hit path mechanically.
- *Pre-cap override only (`--rounds N` at start time).* Cheapest, but the human has the *least* information at start time. The whole leverage of mid-run extend is that the cap-hit moment is exactly when the trajectory tells you whether the loop is converging or stuck.

### D2. `→ RUN 1 MORE` is a top-level directive, not a per-box annotation

**Decision.** Like `ABORT`, the directive appears on its own line at the top level of the gate MD. It is not beneath a box (which is the form used for veto redirects and blocker answers). The parser recognizes the literal token `RUN 1 MORE` (case-sensitive) on a line matching `^\s*→\s*RUN 1 MORE\s*$`. Any other `→ RUN ...` form is rejected with an error naming the line, to leave room for future `RUN N MORE` if we ever want it without silently accepting typos.

**Rationale.** The existing `→` parser (`gate-model.ts:198-217`) dispatches by context: `→ <payload>` after an unchecked box is a redirect; `→ <payload>` after a blocker is an answer; `→ OVERRIDE` is a top-level marker. Adding `→ RUN 1 MORE` as another top-level marker fits the existing dispatch table.

**Alternatives considered.**

- *`--extend` CLI flag on `gate resume`.* Skips the gate MD entirely. Rejected because the human is already editing the gate MD for every other decision — mixing two interaction models adds cognitive load.
- *A new checkbox (`[ ] E1 extend by one round`).* Rejected because extend is not a yes/no on the current gate content; it's a directive that *replaces* an approve/veto/abort on this gate. A checkbox would force the human to also handle the assumption boxes, which is meaningless when they're choosing to extend.

### D3. `state.roundCap` — new optional field, defaulting to `ROUND_CAPS[depth]`

**Decision.** Add `roundCap?: number` to `RunState` (`run-state.ts`). When undefined, `ROUND_CAPS[state.depth]` is used. Each extend does `state.roundCap = (state.roundCap ?? ROUND_CAPS[state.depth]) + 1`. The depth profile (`state.depth`) is never mutated by extend.

**Rationale.** Two fields with different meaning:

```
   state.depth     classification (S/M/L) — set once at intake, never mutates
   state.roundCap  current ceiling       — starts at ROUND_CAPS[depth], grows on extend
```

Overloading `state.depth` (e.g., "M-extended-3") conflates a classification with a counter, breaks the lens-escalation rule (which keys off `state.depth === 'M'`), and complicates the depth field's appearance in `report.ts`.

**Alternatives considered.**

- *Mutate `state.depth` to `L` on first extend.* Rejected: L triggers the concurrent skeptic lens, which is a *depth* escalation, not a budget extension. The two are independent — an extended M run shouldn't silently gain a concurrent lens.
- *Thread the cap through `runReviewLoop` options without persisting.* Rejected: resume after interruption needs to know the current cap, and that requires persistence.

### D4. Re-enter the review loop at `state.round + 1` with the bumped cap

**Decision.** `runReviewLoop`'s signature changes to accept an optional `(startRound = 1, cap = ROUND_CAPS[depth])`. The existing entry point (fresh run, `runPlanningStages`) calls it with defaults. The new extend path calls it with `(state.round + 1, state.roundCap)`.

**Rationale.** `runRound`'s recursion (`review-loop.ts:149`) already threads `(round, cap, prevOpenBlockers)` — the only thing hard-coded was the entry point's `(1, ROUND_CAPS[depth], 0)`. Lifting those into parameters is the minimal change that enables re-entry.

The extended round reads `resolutions-<state.round>.json` as its prior ledger via `readResolutionsLedger` — already how sidecars work. `prevOpenBlockers` flows from the cap-hit state (the count of open blockers in the final round's resolutions). The lens-escalation rule (`lensesForRound(depth, round, prevOpenBlockers)`) keeps working without modification: an M-profile run that extended with 0 blockers stays on the non-skeptic track; an M-profile run that extended *with* blockers gains the skeptic lens on the next round per the existing rule.

**Alternatives considered.**

- *A new `runExtendedRound` function separate from `runReviewLoop`.* Rejected: duplicates the lens/ledger/round-event-emission logic. The shared abstraction is exactly `runRound`.
- *Re-running `runReviewLoop` from round 1 with the new cap.* Rejected: would re-do all prior rounds, wasting tokens and re-emitting their events into `events.ndjson` (which would corrupt the trajectory).

### D5. Converged-after-extend falls through to `runPostReviewToGate`

**Decision.** In `runGateResume`'s new extend branch:

```
   bump state.roundCap
   re-enter runReviewLoop(state.round + 1, state.roundCap)
   state.round = reviewResult.rounds
   if (reviewResult.outcome === 'cap-hit')
     presentGateAt(deps, state, ctx, reviewResult, version + 1, 'early')   // re-cap
   else
     runDecomposeStages(env, state.depth)                                  // natural fall-through
     presentGateAt(deps, state, ctx, reviewResult, version + 1, 'final')
   return { runId, outcome: 'extend', version: version + 1, gateMdPath }
```

The `'extend'` outcome kind in the result is what distinguishes "we ran another round" from "human approved" or "human vetoed" for the CLI and event log. The next gate's mode ('early' or 'final') is determined by the extended round's outcome, not by the directive — this preserves the cap-hit-vs-converged gate-mode semantics.

**Rationale.** `runPostReviewToGate` (`orchestrator.ts:134-148`) already branches on `reviewResult.outcome === 'cap-hit'` to choose early vs. final gate. Reusing it means the post-extend path gets decompose + atomicity for free when the extended round converges.

**Alternatives considered.**

- *Always re-cap after extend, even on convergence, then let the human approve at the final gate.* Rejected: adds a spurious extra gate decision. If the extended round converged, the human's intent ("keep going") has been satisfied; flow naturally to the final gate.

### D6. Parser rejects `→ RUN 1 MORE` at the final gate

**Decision.** The parser is constructed with a `gateMode: 'early' | 'final'` input (passed through from `state.gate.mode`). When `gateMode === 'final'`, encountering `→ RUN 1 MORE` throws `gate response line <n>: → RUN 1 MORE is not valid at a final gate (cap-hit only)`.

**Rationale.** The final gate fires post-convergence; there is no cap to extend. Silent acceptance would be a no-op and hide a probable user typo (e.g., they meant to write `RUN MORE` as a comment, or misremembered the directive). Loud rejection is safer.

**Alternatives considered.**

- *Silently ignore.* Rejected — invites confusion when a human writes the directive at the wrong gate mode and the runner proceeds as if they approved.

## Risks / Trade-offs

- **[Cost runaway]** Repeated `→ RUN 1 MORE` could chain indefinitely. → *Mitigation*: Shape B re-gates every round; the human re-encounters the trajectory and the cost line each time. The existing `budgetUsd` field in `RunnerConfig` is the natural future cap (out of scope here, see Non-goal N4).
- **[Carry-forward correctness]** The extended round must read the prior round's resolutions as its ledger, or it will re-raise already-resolved findings. → *Mitigation*: `readResolutionsLedger(sidecarDir, round)` already reads `resolutions-<round - 1>.json`; the extended round naturally finds `resolutions-<state.round>.json` as its prior ledger. Verified by the existing ledger mechanics; covered by a new orchestrator test.
- **[Lens-escalation interaction]** An M run that extended after round 3 with 0 open blockers stays on the non-skeptic track; the same run extended *with* open blockers should escalate. → *Mitigation*: `prevOpenBlockers` flows from `state.round`'s open-blocker count, exactly as in normal loop iteration. No special case; covered by test.
- **[State migration]** Old `state.json` files (pre-change) have no `roundCap` field. → *Mitigation*: the field is optional; loaders default to `ROUND_CAPS[state.depth]` when undefined. No migration script, no backfill.
- **[Trajectory readability]** After three extends the trajectory block is 6 rows; the "is this converging or stuck" verdict gets harder to eyeball. → *Mitigation*: out of scope here (the trajectory-verdict feature was deferred in exploration). The raw trajectory still computes correctly.

## Migration Plan

No data migration. sdd-runner run state is gitignored and per-run. Old cap-hit runs that the human already approved/aborted are unaffected — they have `state.gate = null` (closed) and won't re-enter `runGateResume`. New runs that cap-hit gain the `→ RUN 1 MORE` directive in the rendered gate. Rollback: `git revert`. No deployed artifacts, no production state.

## Hook/TDD Interactions

New code files the Write/Edit TDD hook pipeline will gate:

- `sdd-runner/src/run-state.ts` (`roundCap` field + defaulting) — test-first: failing test that `loadRunState` populates `roundCap` from `ROUND_CAPS[depth]` when missing and preserves it when present.
- `sdd-runner/src/gate-model.ts` (parser branch + final-gate rejection) — test-first: failing tests for accept-at-early, reject-at-final, reject-malformed.
- `sdd-runner/src/review-loop.ts` (parameterized entry point) — test-first: failing test that `runReviewLoop` with `(startRound=4, cap=4)` runs exactly one round and emits `round_open` with the bumped cap.
- `sdd-runner/src/gate-digest.ts` (`writeGateDigest` emits the directive) — test-first: failing test that the rendered early-gate MD contains `→ RUN 1 MORE`.
- `sdd-runner/src/orchestrator.ts` (`runGateResume` extend branch) — test-first: failing E2E test that extend produces `gate-<n+1>` with bumped cap and appended trajectory; converged-after-extend flows to final gate.

Test order (literal order of work): run-state → gate-model → review-loop → gate-digest → orchestrator. Each task in `tasks.md` follows the failing-test → implement → verify cadence.
