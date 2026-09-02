# afk-runner-live-proof Specification

## Purpose

The live conformance protocol that closes the afk-runner prototype window: proof definition for real end-to-end runs with real agent spawns, induced-incident recovery drills, the live-corpus lane, the reflection/re-score form, and the honest split of the C1 relaxation promise.

## Requirements

### Requirement: Live conformance run

Each live-proof cycle SHALL complete productive think-half runs against real target repositories using real agent spawns, from `start` to terminal memos, without stubbed agents or fixture substitution. A cycle's depth profiles SHALL be decided by the live classifier; a depth override SHALL NOT be used. The first cycle validates plumbing with a docs-shaped calibration run before its proof run; each later cycle's first productive run doubles as the plumbing calibration for whatever changed since the previous cycle. A cycle SHALL span every budget regime its engine supports (a metered numeric ceiling and an unmetered `budget: null` run) unless a regime was already live-proven unchanged.

#### Scenario: Calibration run completes

- **WHEN** the runner starts on an honestly-S-classified docs-shaped task file against a real target repository
- **THEN** the run reaches a terminal memo without stubbed agents, and the produced change passes `openspec validate --strict`

#### Scenario: Misclassification is recorded, not corrected

- **WHEN** the live classifier assigns a different profile than the operator expected
- **THEN** the assigned profile stands for the run and the divergence is recorded as a reflection input, not overridden via the depth flag

#### Scenario: Budget regimes are both exercised

- **WHEN** the cycle's productive runs are configured
- **THEN** at least one run carries a numeric metered budget and at least one carries `budget: null` (unmetered), and both reach terminal memos through the full pipeline

### Requirement: Induced incident recovery, live

A live-proof cycle SHALL include induced incidents selected by what the engine changed since the previous cycle, and recovery SHALL use documented operator verbs only. Every cycle's drill set SHALL classify each drill as **induced** (operator-aimable fault) or **opportunistic** (agent-behavior-dependent, pre-registered with an observation protocol). The second cycle's induced set SHALL cover: a holder process-kill during an in-flight review round (asserting one classified `resume{path, stage, session?}` event per invocation and no duplicate `round_open` on same-round re-entry), a gate-level veto settled through the directive grammar at a gate carrying assumptions, a deliberately unattended gate past an armed deadline, an agent-child kill driving declared failure through the escalation-approve retry path, and a corrupted round sidecar driving the counts-integrity substitution.

#### Scenario: Kill during an in-flight review round

- **WHEN** the runner process is killed while a review round is open, its verdict unrecorded, and a reviewer spawn in flight
- **THEN** `resume` re-runs the same round continuing the in-flight session from the session ledger, the log carries exactly one classified `resume` event for the invocation and no second `round_open` for the re-entered round, and the run thereafter reaches a terminal memo

#### Scenario: Veto at a final gate

- **WHEN** a final gate on a converged round is settled with outcome veto
- **THEN** the run re-enters draft as revision work, the review loop opens a new round over the existing cap, and the run re-presents the final gate at the next version

#### Scenario: Veto through the directive grammar

- **WHEN** a gate carrying assumptions is answered, first with a zero-signal response, then with `VETO: <redirect>`
- **THEN** the zero-signal response is rejected with directive guidance and settles nothing, the veto directive settles the gate with its redirect, and the run re-enters revision work carrying the gate-level redirect

#### Scenario: Unattended gate past an armed deadline

- **WHEN** a gate with an armed deadline is deliberately left unanswered past expiry
- **THEN** the waiter-claimed outcome appends the standard `auto_decision` audit event (a settle names the deciding rule; re-arm/stay-pending records `none`/`pending`), and the run state after the outcome is honest against the folded log

#### Scenario: Agent-child kill reports the killed-session continuation

- **WHEN** the spawned agent child (not the holder) is killed mid-spawn enough times to drive the stage through declared failure and an escalation gate is approved
- **THEN** the same-process retry's session-ledger behavior is observed against the `killed` entry, and the F-A4 evidence — continuation preserves context (accept branch) or wedges/mis-attaches (fix branch) — is reported in the reflection as the operator's accept-or-fix decision input

#### Scenario: Corrupted sidecar substitutes the integrity blocker

- **WHEN** a closed round's sidecar (hash snapshot or resolver output) is corrupted before the gate that reads it presents
- **THEN** the counts integrity cross-check substitutes the open `POLICY-INTEGRITY` BLOCKER, no rule auto-decides, and the gate waits for an explicit human settle

### Requirement: Declared-failure live drill

A scratch run with an unreachable agent configuration (a model name that fails agent-side) SHALL reach the escalation gate through declared failure bookkeeping, and settling it with abort SHALL produce a memo with terminal status `failed`. The drill SHALL pre-register the expected failure kind (`exhausted` — agent-level failure) rather than transport-level infra.

#### Scenario: Bogus model escalates and fails honestly

- **WHEN** a scratch run is started with a model name that no provider resolves and the escalation gate is answered with abort
- **THEN** a `stage_failed` event with kind `exhausted` is recorded, an escalation-mode gate is presented and settled, and the terminal memo records status `failed`

### Requirement: Operator discipline pass criteria

A cycle SHALL pass only if: no events are appended by anything other than the runner; no run-state files are edited outside the gate/steer answer surfaces and the cycle's pre-registered induced faults (process kills, agent-child kills, sidecar corruptions, deliberately unattended gates, malformed answers probing the response grammar); the produced changes validate strictly and their tests pass in their target repositories; every park's memo and report are consistent with the folded log; and the reflection names at least three concrete frictions or an explicit measured improvement over the previous cycle. An opportunistic drill that never arises SHALL NOT fail the cycle; it is recorded as not-arisen with its fixture evidence standing.

#### Scenario: No operator surgery

- **WHEN** the cycle and its incidents are complete
- **THEN** the events log contains only runner-authored events, operator writes are gate answers, steer inputs, and the enumerated induced faults, and each induced fault's condition was real (the engine handled it, no state was faked)

#### Scenario: Not-arisen opportunistic drill

- **WHEN** a pre-registered opportunistic shape (needs-review cap-hit, concern thrash, cross-artifact finding) does not occur in any run
- **THEN** the proof is not failed; the reflection records the shape as live-unproven-not-arisen with the fixture evidence cited

### Requirement: Live corpus lane

Every productive run's event log SHALL be harvested into the fixture corpus as a live-marked lane, distinct from legacy and synthetic marks. The lane's oracle SHALL assert fold-consistency: folding the harvested log reproduces the memo fields the run persisted, and event-schema validation passes over every line including agent noise. Harvested logs from before an event-grammar wave SHALL remain in the lane unchanged; the analyzer's era flag — not lane surgery — separates development-era from era-current evidence.

#### Scenario: Harvested log folds to its own memo

- **WHEN** the live-marked log is folded and compared with the memo the run wrote
- **THEN** the derived memo fields match, and every line validates against the event schemas

#### Scenario: The analyzer reads the grown lane era-correctly

- **WHEN** the corpus report runs over the harvested lanes and the cycle's workdirs
- **THEN** pre-wave logs are flagged development-era and excluded from aggregates, and the cycle's own logs report era-current

### Requirement: Reflection and ledger re-score

The reflection artifact SHALL score every follow-ups-ledger item with a verdict from a closed set (`next`, `rise`, `hold`, `fall`, `park`, `retire`), an evidence field citing run artifacts or the corpus report for every non-park verdict, and a falsifiable trigger for later re-opening. Exactly one item SHALL carry verdict `next`, or an explicit tie note SHALL be recorded. The re-scored table SHALL carry an n-count provisionality preamble naming the cycle count, the corpus report SHALL be cited as evidence where a metric — not a single run — is the ground, and the living ledger SHALL move to the afk-runner architecture doc. Named measurement targets for the second cycle: reflection authoring cost (U4) and surface-discovery cost (U8); the F-A4 adjudication SHALL be recorded, closing or reopening the recorded-not-fixed entry.

#### Scenario: Every ledger item is re-scored with evidence

- **WHEN** the reflection is written after the cycle's runs
- **THEN** each U-item has a verdict, park verdicts cite absence of evidence, non-park verdicts cite at least one run artifact or corpus metric, and exactly one `next` is promoted or a tie is explained

### Requirement: Autonomy audit trail, live

The cycle SHALL exercise the budget regimes against their policy branches live with a priced model (cost known): on a metered run, a projected spend reaching the numeric ceiling SHALL refuse autonomy extensions (verify round, ladder extend) with no `auto_decision` for a refused round; on an unmetered run the same shapes SHALL be allowed. Every waiter-claimed deadline outcome SHALL append its `auto_decision` audit event, and externally-settled gates SHALL emit none — replay alone distinguishes them.

#### Scenario: Verify round refused on the metered run

- **WHEN** a needs-review cap-hit occurs on the metered run and the projected spend reaches the run's numeric ceiling
- **THEN** the verification round is refused, the refusal appends no `auto_decision`, and the run proceeds to its final gate with the unreviewed edits visible

#### Scenario: Verify round bought on the unmetered run

- **WHEN** a needs-review cap-hit occurs on the unmetered run
- **THEN** exactly one verification round opens as `round_open(n+1, cap+1)` and the run settles by that round's result

#### Scenario: Waiter settlements are replay-distinguishable

- **WHEN** the deadline waiter claims an expired gate
- **THEN** the log's `auto_decision` events name the deciding rule or record the pending re-arm, and no human-settled gate in the cycle carries a waiter audit event

### Requirement: Concern memory and integrity, live

The cycle SHALL carry pre-registered opportunistic drills for the concern-memory shapes: a concern raised to third-strike thrash (loop ends with cluster ids on the convergence event, the verification round denied fold-derived, and the following gate rendering the `### Concern history` section), and a `C<n>` cross-artifact consistency finding riding the normal resolver path. Task selection SHALL aim at these shapes (assumption-bearing work, contentious named decisions) but SHALL NOT fabricate findings; non-arousal degrades to a recorded not-arisen note, never a planted finding.

#### Scenario: Third-strike thrash ends honestly

- **WHEN** a concern fingerprint reaches its third raise after prior resolved or dismissed entries
- **THEN** the loop ends instead of recursing, the convergence event carries the cluster ids, no verification round is bought, and the gate that follows renders the round-by-round concern history

#### Scenario: Cross-artifact disagreement surfaces as a finding

- **WHEN** two artifacts render a seeded decision term differently
- **THEN** a `C<n>` MATERIAL finding naming both files and renderings rides the lens-to-resolver path and carries a fingerprint like any finding

### Requirement: Relaxation window close-out

The oxlint prototype relaxations for the afk workspace (line limits, unsafe-type-assertion, classes-per-file) SHALL be removed with lint green at repo defaults. The duplicate-detection ignores and the tests-side type-aware relaxations SHALL be re-timed to the sdd-runner retirement follow-up with their justification recorded at the relaxation site, because they guard the parity oracle that only retirement can remove.

#### Scenario: Lint re-tightens green

- **WHEN** the afk-scoped oxlint overrides are deleted from the lint config
- **THEN** `bun run lint` passes at repo defaults with no afk-scoped rule suppressions remaining

#### Scenario: Oracle ignores are re-annotated, not silently kept

- **WHEN** the close-out completes
- **THEN** the duplicate-detection ignore list and the remaining tests-side relaxation carry recorded justification naming the retirement follow-up they are timed to
