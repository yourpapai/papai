# tail-on-graph — design (C5)

## Context

C3 drives think-half runs, C4 settles gates; both stop at the tail: a converged run parks `awaiting-tail` because `workFor('decompose')` is null and the loop only enters successors that declare work (`drive/loop.ts:182`), finals park the same way with the memo stuck at `running`, and no report exists. The corpus pins the tail's shape (four completed runs share one exact choreography; the gate stage bracket closes ~2ms after presentation, answered arrives later), and C4's non-goals explicitly defer "the gate-stage final-presentation work module" here. Every load-bearing decision below was validated against the real graph and the 15 fixtures during exploration (boundary-legal append probes, guard-equivalence over all 25 historical answereds, crash-window repros); evidence references are summarized per decision.

## Goals / Non-Goals

**Goals:** tail work modules; final-gate presentation; outcome-ordered settlement incl. the final-approve branch; kernel completions (S edge, guard reshape, self-loops incl. the inherited intake gap); crash-window recovery; finals vocabulary + terminal memo; report; memo parity with an oracle over surviving originals; five synthetic fixtures.

**Non-Goals (design-level):** failure-event vocabulary and `failed` memo status (C6 — tail `StageHaltError` propagates exactly as draft's does today); PR/push integration (report prints PR-body text only; `gh` is C7's call); `plan`-mode gates and child execution (U2 — memo projects the dormant fields, no producer); TUI (U8); gate reopen; snapshot memo (U7); touching sdd-runner (its own intake self-loop gap stays; the fix lands in afk's graph only).

## Decisions

### D1 — Presentation hosting: the tail's last work module presents (review precedent)

Compared: (a) the last tail stage's work appends `stage_enter(gate)` + presentation as its final act; (b) a work module keyed `'gate'` the loop enters. **Chosen (a).** The loop keys `workFor` by the *flattened* position — after `stage_enter(gate)` lands, position is `gate.awaiting`, so a `'gate'`-keyed module is only an existence check pre-entry and its work would never run (loop edit or key indirection required — C3's design constraint is "modules, not loop edits"). Option (a) mirrors review's early-gate presentation exactly: work appends the events, the graph moves itself on `gate.presented`, the bracket's trailing exit lands from `gate.awaiting` as a root assign, the outcome reader parks gate-pending. Probe-validated end-to-end on the real machine: every append legal, map exactly corpus-shaped, `completed` reached. On depth S the presenter is decompose (the last tail stage); the shared presenter logic is one helper both modules call.

### D2 — File-first presentation ordering

The presentation sequence is: render gate file + hashes sidecar → append `stage_enter(gate)` → append `presented` → run ladder. This ordering makes every pre-presentation crash heal via the D4 self-loop (work re-runs, re-renders the file — overwrite, same version, harmless), shrinking the unhealable window to exactly the entry↔presented gap, which D5 owns.

### D3 — Outcome-dependent settle ordering at final gates

The exploration proved a uniform `exit(gate)`-before-`answered` ordering **completes the run on an extend answer** (exit completes the map → the answered event takes `gate→completed` while the human asked for another round); legacy is immune only because no final-gate extend exists in the corpus and legacy completes imperatively. The seam therefore branches on outcome at final mode: **approve** = `exit(gate)` → `answered` (the completed edge fires on the answer — corpus-identical); **extend/veto** = `answered` → `exit(gate)` → mover (answered-first keeps gate active, guard correctly blocks; exit is map hygiene); **abort** = `answered` alone (the aborted edge ignores the map). Both non-approve cycles were probe-proven to completion on the real graph, including tail re-runs and v+1 re-presentation — matching legacy `extend-round.ts:84`, which re-runs the post-convergence tail unconditionally. Crash between exit and answered heals trivially (awaiting persists; re-settle tolerance is corpus-attested); no owed-exit recovery exists or is needed. At early mode the seam appends no exit (interstitial gates never enter the gate stage in the map).

### D4 — Kernel completions: three edges-shape edits, all new-logs-only

1. **`decompose → gate` edge** (guarded `isStage('gate')`, second entry in decompose's transition array): depth-S runs skip atomicity, and today's boundary refuses `stage_enter(gate)` from decompose (probe-caught).
2. **`allStagesDone` → `gate done && no stage active`**: the map is pre-initialized all-pending in *both* folds, so depth-S runs (atomicity forever pending) can never satisfy the old guard — S completion is graph-impossible today. Guard-equivalence over all 15 fixtures: **zero disagreements** across all 25 historical answereds (parity-safe), with the single intended flip at the S final approve (`real=false variant=true`). The reshape keeps early-approve blocked (gate pending at interstitial) and matches every completed-run shape.
3. **Self-loops on decompose, atomicity, and intake**: resume-by-re-entry appends `stage_enter(position)` and survives the boundary probe only if the state self-edges; review (corpus) and draft (C4 veto) have them, intake does not — a mid-intake crash today makes resume report `drivable` and then throw `append refused: stage_enter intake has no legal edge from 'intake'` (empirically reproduced). The drive tests never caught it because their stub graphs hand intake a self-loop. Historical logs never re-enter these states, so parity is untouched (the draft-self-loop precedent).

### D5 — Crash-window recovery: owed presentation, map-gated movers

The W3 window (crash after `stage_enter(gate)`, before `presented`) leaves the machine in `gate.awaiting` with the gate record null (W3a) or stale-answered (W3b). Both pathologies reproduced: W3a makes the C4 waiter exit `external` instantly → `waitSettledGates` re-drives → parks → recurses in an infinite 1s loop; W3b makes `owedMoverOf` append a **phantom `round_open`** for an extend mover that already landed (the machine believes a fresh round is owed). Fixes, both resume-level (the state is only ever observed by a resuming process — the presenter died): (1) **owed-presentation recovery** — `gate.awaiting` + map-gate-active + (record null or answered) → append the owed `presented` at the version of the latest gate file on disk (file-first ordering guarantees the file exists), then re-run the ladder; (2) **map-signal gating on owed movers** — extend/approve movers are owed only while map gate is *not* active (the interstitial early position). The remaining presented-without-ladder window (W4, milliseconds) is accepted with a note: the gate settles normally; only the ladder's `auto_decision` record is lost, and re-running it risks double-counting R2 extends against the auto-extend allowance.

### D6 — Finals: a terminal park reason, not a second field

`ParkedReason` gains `'final'` (loop checks `snapshot.status === 'done'`; position names completed/aborted) rather than a `finished` field on `DriveResult` — one vocabulary, every consumer (`parkLine`, `parkedReasonOf`, `waitSettledGates`, CLI) branches once. Consumers: memo maps terminal parks to status completed/aborted (session-id release follows automatically through `TERMINAL_STATUSES`); resume-of-terminal prints the report pointer and appends nothing; the waiter's re-drive after a final-approve settle exits the loop naturally. With the tail declaring work, `awaiting-tail` becomes unreachable and is **retired from the reason union** (its two producers and the C5 placeholder line in `parkLine` die); an unknown position still parks defensively via the existing `module === null` path returning `'final'`-vs-error — the loop's refusal vocabulary remains the alarm.

### D7 — Memo parity: projection rules + oracle over the originals

The memo (never read for control flow, C3-D6 contract unchanged) gains `plan`/`children`/`autoExtendsUsed`/deadline fields as pure projections, plus three terminal rules reconciled against real persisted `state.json`s from the surviving hoard (`2f6e644a`, `tests-consolidation`, `opencode-agent-fix-command` verified present with full run dirs): (1) `gate` projects null at terminal status (legacy nulls at finalize; the kernel record persists by design); (2) `stage` holds the last *entered* stage (legacy completed runs say `"gate"`, not the final position); (3) `updatedAt` compares with tolerance (legacy stamps its save clock a few ms past the last event). The oracle test copies the surviving `state.json`s into fixtures, derives the memo purely from each `events.ndjson`, and matches the fold-derivable fields — "parity complete" is proven against real persisted states, not schema shape. `plan`/`children` derive from the last `plan` event payload (`childCount`+`digest`) and `context.children`; no producer is added.

### D8 — Report: passive command, port the math

`afk-runner report <runId>` builds the summary from the event log (depth/rounds/verdict/gate versions/skeptic lens), the change directory (task counts), and git log on the branch (execGit seam already in config) — a direct port of sdd-runner's `report.ts`, whose gains math (median human-gate dwell, per-rule avoidance) is a pure event fold. PR-body mode (`--pr`) prints text only. No new module family: the copy lands beside the other work copies under `afk-runner/src/work/`.

### D9 — Fixtures: five synthetic scenarios, one red seed

Per the scenario convention (`-synthetic` = corpus-unattested shape, README row, inventory parity assertion): `extend-at-final-cycle-synthetic` (29 events), `veto-at-final-cycle-synthetic` (33), `abort-at-final-synthetic` (17), `s-final-tail-synthetic` (16), `tail-crash-resume-synthetic` (crash-only 13 + healed 18). All pre-validated through the boundary and against the parity harness's own per-event comparison: legacy-fold **identical** for every shape except the S fixture, which diverges at exactly the `stage_enter(gate)` — red until D4's edge lands, making it the kernel-face TDD seed (the children-plan precedent for synthetic marking).

## Risks / Trade-offs

- [New-log choreography differs from legacy micro-order (exit-after-presented brackets, answered-before-exit settles)] → fold-tolerant by construction (root assigns fire from any state; parity is per-log); all shapes proven identical under legacy-fold before landing.
- [Map gate stays `active` during an extended round after final-extend] → cosmetic; nothing reads it until the next tail pass closes it; probe-verified harmless.
- [W4 ladder record lost on a millisecond-window crash] → accepted with note (D5); re-running risks double-counted R2 records against the auto-extend allowance.
- [Memo oracle depends on surviving originals] → verified present for three runs incl. two completed shapes; the test enumerates what exists and never invents states.
- [Retiring `awaiting-tail` narrows the loop's defensive surface] → the boundary refusal remains the alarm for genuinely illegal movement; unknown-position behavior is tested explicitly.

## Migration Plan

TDD order (Write/Edit hooks gate every new `afk-runner/src/**` file; tests in `tests/afk-runner/`):

1. **Kernel face**: `s-final-tail-synthetic` red seed → `decompose→gate` edge + guard reshape + self-loops (graph tests + full parity green; intake resume drill).
2. **Fixtures face**: remaining four fixtures + README/inventory rows (parity harness extends over them).
3. **Work face**: decompose/atomicity copies, presenter helper, depth-aware decompose outcome; drive-to-completion integration test with fake agents (M and S).
4. **Seam face**: outcome-ordered final settles (approve/extend/veto/abort golden logs); `runPostConvergenceTail`-shaped tail re-run test.
5. **Recovery face**: owed-presentation + map-gated movers; W3a/W3b resume drills (the repros become the tests).
6. **Finals face**: terminal park reason, memo statuses, session-id release, resume-of-terminal pointer; `awaiting-tail` retirement.
7. **Memo face**: projection rules + surviving-`state.json` oracle.
8. **Report face**: port + CLI command (+ `--pr` text mode).
9. Full `bun test`, typecheck, lint, knip; docs update (`docs/architecture/afk-runner.md` C5 row).

Rollback: additive beside C4 behavior; reverting restores park-at-tail runs (the graph edits are the only shared-state changes and are guarded by parity over unchanged historical logs).

## Config-rule compliance

No chat-platform, task-instance, or config-context surface; all state is repo-local run dirs keyed by run id (inherited). No DB, no new dependencies (xstate already pinned exact). No new tool surface — capability/tool-prefs gating untouched. Every new `afk-runner/src/**` file enters the Write/Edit TDD hook pipeline; the faces above are the test-first order. The prototype relaxation window (jscpd/oxlint scoped relaxations) covers the tail work copies as it covered C3/C4's; re-tightening stays pinned to C7.

## Open Questions

None — the exploration resolved the unknowns (presentation hosting, settle ordering, S guard, crash windows, finals vocabulary, memo rules, fixture set) as D1–D9 above; report PR-mode remains a text-only surface by decision, revisit at C7.
