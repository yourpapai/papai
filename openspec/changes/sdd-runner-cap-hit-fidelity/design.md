## Context

See `proposal.md` — Why. The dogfood run (`2026-08-10T17-15-37-540Z-1828d7a9`, M-profile on `shared-tui-renderer`) hit the round cap trending 6m→1m→2m with the resolver editing every finding. The implementation halted at an early gate whose entire content was:

```
## Early gate (cap hit) — change shared-tui-renderer
### Summary
shared-tui-renderer
### Cost / duration · $0.00 · 2113s
### Assumptions (blast-ranked)
                          ← empty
### Resume
gate resume 2026-08-10T17-15-37-540Z-1828d7a9
```

Three independent problems compound:

1. **`blockersOf` (`gate-digest.ts:126`) only collects `class === 'BLOCKER'`** — MATERIAL findings never reach the gate.
2. **`evaluateConvergence` (`review-model.ts:20`) counts by class regardless of `resolution`** — a MATERIAL finding the resolver `edited` still counts toward MATERIAL in the convergence, so cap-hit fires whenever the reviewer is still raising MATERIAL at the last round. This is consistent with `sdd-automation` spec:103 ("post-resolution classifications" = the final class), but it means cap-hit is the *common* path for any change with a healthy reviewer.
3. **`finalizeResponse` (`gate-model.ts:180`) returns `approved = true` vacuously** when there are no assumptions and no blockers — `checkedAll = every(...)` over an empty set, `unanswered = []`, `vetoes.length === 0`. `gate resume <runId>` with no edits/flags approves; `--confirm-all` has nothing to check.

The `sdd-automation` spec defines the early gate only for the unresolved-BLOCKERs case (spec:103/113/164/183). The MATERIAL-only cap-hit path is unspecified; the implementation's choice (halt + empty surface + vacuous approve) is what the dogfood walked into.

## Goals / Non-Goals

**Goals:**

- G1. Surface the final round's open MATERIAL findings (gap + resolver outcome) at the early gate whenever cap-hit fires, so the human can see what the reviewer was still raising.
- G2. Surface a per-round burndown trajectory (counts of b/m/n per round) so the human can distinguish a converging loop from a stuck one.
- G3. Reject vacuous approval — an early gate presented because cap-hit fired SHALL require an explicit positive signal even when no BLOCKERs and no assumptions exist.
- G4. Preserve the existing BLOCKER-cap-hit protocol (answer/OVERRIDE) unchanged.
- G5. Capture the spec amendment language concretely so it can land in `auto-sdd-pipeline`'s `sdd-automation` delta.

**Non-Goals:**

- N1. Do not change `evaluateConvergence`'s predicate or the convergence threshold (spec:103 is correct as written; the bug is in the gate, not the predicate).
- N2. Do not change the resolver's taxonomy or prompting (deferred — see D4, Thread B).
- N3. Do not add cost estimation for providers that skip `costUsd` (deferred — see D4, Thread C1).
- N4. Do not add a "+1 round" gate option (the human can already veto with redirect; a round-budget extension is a separate enhancement).

## Decisions

### D1. What counts as "cap-hit" worth halting?

**Decision: keep the current trigger** — any non-convergence at the round cap halts at the early gate. Do *not* narrow to "only halt when BLOCKERs are open".

**Rationale.** The dogfood trajectory (6m→1m→2m, resolver editing every finding) is exactly the case where a human look adds value: either the resolver's edits aren't收敛ing the reviewer (pathological — reintroducing the same gap in new words), or the reviewer is doing genuine new work on an evolving artifact set (healthy). The human is the only agent that can tell which. Silently proceeding to decompose when no BLOCKERs survive (the "be quiet" alternative considered in explore mode) loses the pathological-loop detector.

**Alternatives considered.**

- *Proceed silently when 0 BLOCKERs at cap.* Faster, fewer halts. Rejected: the trajectory is genuinely informative and cheap to surface; silent proceed loses signal that the spec framework was built to surface.
- *Halt only when trajectory is non-monotonic.* (E.g., 6→1→2 trips it, 6→4→1 doesn't.) Rejected: monotonicity is one heuristic among several, the human is better at pattern recognition than a predicate, and embedding the heuristic in code ossifies it before we have enough dogfood runs to calibrate.

### D2. Gate surface: what to show, and the spec amendment language

**Decision.** When cap-hit fires, the early-gate digest gains two sections regardless of BLOCKER count:

```
### Cap-hit trajectory
round 1: 0b 6m 3n · 8 resolved · 1 dismissed · open
round 2: 0b 1m 1n · 2 resolved · 0 dismissed · open
round 3: 0b 2m 1n · 3 resolved · 0 dismissed · open    ← cap reached

### Open MATERIAL findings at cap (reviewed)
- [ ] F1 <gap quote>
  resolver: edited — <outcome>
  → <redirect if you want the resolver to take a different path>
- [ ] F2 <gap quote>
  resolver: edited — <outcome>

### Trajectory reviewed
- [ ] T1 I reviewed the trajectory and the open findings above
```

- The trajectory block is rendered by calling `formatTrajectoryBlock(records)` from `renderer.ts` (shipped by `sdd-renderer-canonical-digest`), where `records = replayEvents(logPath).perRound`. The reducer already derives each round's `{ counts, resolved, dismissed, verdict }` from the convergence + finding events in `events.ndjson`, so this change consumes those `DigestRecord`s directly — no inline rendering and no re-reading raw convergence events.
- Each open MATERIAL finding gets a checkbox. **Checking it = "this is acceptable, proceed"** (the same semantics as an assumption box). **Leaving it unchecked = veto** (with optional `→ <redirect>`). This reuses the existing assumption-checkbox parser in `gate-model.ts:137` — just over a different id namespace (F<n> instead of A<n>) — so the protocol stays uniform.
- The `T1` ack box is the **vacuous-approval guard (G3)**. It is present *only* when cap-hit fired with 0 BLOCKERs. When BLOCKERs are open, the existing answer/OVERRIDE protocol is the positive signal and `T1` is omitted (avoid double-gating).
- NITPICK findings are not expanded — only their count appears in the trajectory line. They remain cheap to dismiss and don't deserve gate real estate.

**Spec amendment language** (lands in `auto-sdd-pipeline/specs/sdd-automation/spec.md` — appended scenarios, not new requirements):

Under **Requirement: Objective convergence predicate** (spec:103), add scenario:

> #### Scenario: Cap-hit with material-only
>
> - **WHEN** the round cap is reached with 0 BLOCKERs open but ≥1 MATERIAL finding in the round's post-resolution classifications
> - **THEN** the runner halts at the early gate listing each open MATERIAL finding (gap quote + resolver outcome) and a per-round burndown trajectory, and requires an explicit trajectory-reviewed acknowledgement before decomposition proceeds

Under **Requirement: Single human gate** (spec:164), add scenario:

> #### Scenario: Vacuous approval rejected
>
> - **WHEN** an early gate was presented because cap-hit fired with 0 BLOCKERs and 0 assumptions, and the human resumes without checking the trajectory-reviewed box
> - **THEN** the runner rejects the response naming the unchecked box, and no run state changes
>
> #### Scenario: Open MATERIAL finding veto with redirect
>
> - **WHEN** the human leaves an open-MATERIAL-finding box unchecked and writes `→ restructure D6 around a format-helper import` beneath it
> - **THEN** the runner records a veto with redirect for that finding, runs one resolver pass applying it, re-materializes artifacts, and re-presents `gate-<n+1>.md`

### D3. Data plumbing: `ReviewLoopResult` carries the open findings

**Decision.** `ReviewLoopResult` (`review-loop.ts:46`) gains one field:

```ts
export interface ReviewLoopResult {
  readonly outcome: 'converged' | 'cap-hit'
  readonly rounds: number
  readonly openBlockers: readonly Resolution[]          // unchanged
  readonly openMaterial: readonly Resolution[]          // NEW
}
```

`runRound` (`review-loop.ts:115`) populates `openMaterial` from the final round's resolutions where `class === 'MATERIAL'` (mirroring the existing `openBlockers` filter at line 140). `blockersOf` (`gate-digest.ts:126`) becomes `findingsOf(result)` returning both sets, and `presentGateAt` passes both into `GateDigestInput`. `GateBlocker` is reused as `GateFinding` (same shape: `id`, `gap`, `evidence`); the rename is cosmetic.

**Why a new field instead of reusing `openBlockers`.** Conceptual clarity in the gate renderer, and the two sets feed different surface elements (BLOCKERs → answer/OVERRIDE; MATERIAL → checkbox+veto). Conflating them in one list would force the renderer to re-classify by `class`, which is already what `blockersOf` filters on — keeping them separate preserves the existing BLOCKER path verbatim.

**Alternatives considered.**

- *Re-read sidecars in `presentGateAt`.* Rejected: the data is already in `ReviewLoopResult`'s resolutions; re-reading sidecars duplicates the parse and risks drift if sidecars are edited on disk.
- *Stuff everything into `openBlockers` and widen the filter.* Rejected (see above — conflates surfaces).

### D4. Deferred threads (deeper-explore record)

These are documented as the output of the explore session that produced this change. They are intentionally out of scope here.

**Thread B — Resolver rarely emits `assumed`.** The resolver prompt (`review-model.ts:144`) lets it pick `edited | evidence-answered | assumed | dismissed`. `assumed` is the *last resort* — picked only when neither editing nor evidence-answering is possible. In a healthy review loop on a fixable artifact set, almost every finding is editable, so the resolver edits. Across the dogfood run, **all 9 findings** were `edited`/`dismissed`; `assumptions: []` in every resolutions sidecar; the gate's assumption-checkbox surface was completely idle.

Two opposite reframes:

- **B1 (gate-side)**: the gate's approve mechanism is over-coupled to assumptions. If assumptions are inherently rare, designing the approve surface around them guarantees an empty gate in the common case. → This change's D2 ack-box approach is the B1 answer: provide an approve surface that doesn't depend on the resolver emitting assumptions.
- **B2 (resolver-side)**: the resolver is too edit-happy. Some "edits" are really judgment calls dressed up as fixes (e.g., R1 F3's `log` method on `TerminalBlock` added a method to a surface — a design decision the human might want to weigh). The resolver could be prompted to emit a *parallel* assumption whenever its edit encodes a non-trivial design choice, even when it also edits. → B2 is a separate change: it modifies resolver behavior and prompting, with prompting-cost tradeoffs.

**Open question for Thread B** (deferrable): is B2 worth the prompting cost, or does B1 (this change) plus the D2 open-MATERIAL-checkbox surface already give the human enough judgment surface? Resolve after one more dogfood cycle with D2 in place.

**Thread C1 — Cost `$0.00`.** `usage-aggregate.ts` sums `costUsd` from L1 `done` events; the glm-5.2 provider doesn't populate it, so the gate's cost line reads `$0.00 · 2113s`. Two cheap fixes:

- **C1a (display)**: show `—` instead of `$0.00` when `costUsd === 0` across all L1 events (sentinel for "provider didn't report").
- **C1b (estimate)**: maintain a per-model rate table in `sdd-runner/src/config.ts` and estimate `costUsd = (input * rate.in + output * rate.out)` when the provider returns 0.

C1a is one line; C1b is a small follow-on change with a config surface. Neither blocks this change.

## Risks / Trade-offs

- **[Gate-noise increase]** Every M/L cap-hit now halts with more surface; if cap-hit is common (it is — see Context) the human sees more gates. → *Mitigation*: the surface is compact (trajectory + open MATERIAL only, nitpicks counted not expanded); the ack box is one check; the dogfood will calibrate whether to tighten the convergence threshold in a follow-on.
- **[Open-MATERIAL veto semantically overlaps with BLOCKER answer]** A human might be unsure whether to leave an open MATERIAL unchecked (veto) when they'd also have answered it if it were a BLOCKER. → *Mitigation*: the checkbox help line says "proceed / veto with redirect" (same as assumptions), not "answer or override". The two protocols stay distinct by id prefix (B vs F vs A) in the parser.
- **[Trajectory rendering from events]** Reading per-round counts from `events.ndjson` adds a replay dependency to gate rendering. → *Resolved by `sdd-renderer-canonical-digest`*: `replayEvents()` is the established replay path and `ReplayState.perRound: DigestRecord[]` already carries the per-round digest; this change consumes it via `formatTrajectoryBlock` with no new event types and no new replay code.
- **[Spec amendment landing strategy]** The amendment could land by (a) editing `auto-sdd-pipeline`'s delta pre-archive (preferred — keeps the spec coherent at archive time) or (b) a follow-on change post-archive. → *Mitigation*: tasks.md makes (a) the explicit first choice; (b) is the fallback if `auto-sdd-pipeline` archives before this change merges. Either way the language is fixed in D2.

## Migration Plan

No data migration. `sdd-runner` run state is gitignored and per-run; old runs' `events.ndjson` already contains the convergence events D2's trajectory block renders, so resume-from-old-state keeps working. Rollback: `git revert`. No deployed artifacts, no production state.

## Open Questions

- **OQ1.** Should the `T1` ack box (D2) also appear at the *final* gate when the run converged after a cap-hit override cycle, or only at the early gate? *Deferrable*: doesn't change this change's approach or task breakdown; answer after seeing the first post-D2 dogfood.
- **OQ2.** Should the open-MATERIAL checkbox surface also apply at the final gate (post-atomicity) when the loop converged but had nitpicks, or stay early-gate-only? *Deferrable*: same.
