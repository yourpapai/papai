# Design — execution-half-on-graph

## Context

The graph kernel (`afk-runner/src/graph/`, `kernel/`, `drive/`) drives think-half runs to a final-gate park; approving the final gate completes via `gate.answered + allStagesDone` (`machine.ts` — "no stage *active*"; pending stages never block). Work modules declare `work + outcomeOf + successors` (`pipeline-work.ts`); the drive loop is stage-agnostic. The write guard hardcodes the change-folder prefix (`agent-layer.ts:193`) with an explicit instruction that any wider seam re-widens in its own terms and re-pins its tests. The repo's Write/Edit TDD hooks are an opencode plugin (`.opencode/plugins/tdd-enforcement.ts`), so spawned `opencode run` implementers get write-policy enforcement automatically. The `plan`/`children` event layer and memo projections exist with no runtime producer (U2's dormant composite-run data). Prior art in the deleted sdd-runner (readable at `41fa25b6a^`): composite child runs, tree budget, decompose-split re-entry, continuation starts — mined for shapes, not ported: U2 stays parked and U3 is sequential in-run execution.

## Goals / Non-Goals

Goals: fold-compatible execution states; zero new failure kinds, settle outcomes, or budget semantics; the C4/C5 gate stack reused for the release gate; progress/resume derived from the log alone.

Non-Goals (design-level): push/PR (R5 reversibility — no credentials exist in the runner; `report --pr` stays passive); child-run/composite execution; auto-decided release gates; parallel tasks; TUI surfaces.

## Decisions

### D1 — Arming is a birth event, not config or memo state

`start --execute` appends one L2 fact event `execution{action:'armed'}` before intake work. Alternatives rejected: a config key (config is rejected-unknown-keys and per-workdir, not per-run — some runs must stay planning-only against the same config); a memo field (the memo is derived, "never read for control flow"). The fold derives `executionArmed` as context residue; the final-gate presenter, the settle seam, and resume all read the fold, so a crashed run re-derives armedness with no side channel. `parseStartArgs` accepts the flag and the `sdd-auto.md` doc pin extends (the pinned surface, `afk-runner-cli`).

### D2 — Graph shape: three states, one back-edge, one reused completion edge

`implement`, `verify`, `release` join `pipelineStates` with: self-loops (re-entry per task, mid-stage crash resume), `implement → verify` (all tasks done), `verify → implement` (red suite — a normal outcome, see D5), `verify → release` (green), `release`'s last work act presents the release gate via `stage_enter(gate)` (the C5 choreography: the bracket-closing exit lands from `gate.awaiting`). The gate compound gains `stage.enter(implement|verify|release)` mover edges from `awaiting` (release-veto → implement; escalation retry movers already target active stages). Completion stays the existing `gate.answered + allStagesDone` edge — at the release gate the settle orders exit-before-answer exactly like today's final gate, so no new terminal event or loop change exists. `run.abort` reaches `aborted` from the new states via the existing per-state mixin. Alternative rejected: a `run_complete` terminal event mirroring `run_abort` — it would add vocabulary to delete a proven edge.

`StageId` widens to `implement | verify | release` (parse-level; old logs never carry the values); `STAGE_ORDER` grows so `initialStages()` seeds them pending — which is exactly why unarmed runs still complete on final approval (pending never blocked `allStagesDone`). Gate mode widens with `release` in the event/memo/kernel enums — additive, the `pending`-in-`auto_decision` playbook.

### D3 — Armed final-approve ordering: exit → mover → answer

Unarmed final approve stays `stage_exit(gate)` then `gate.answered` (completed fires on the answer). Armed final approve appends `stage_exit(gate)`, then the mover `stage_enter(implement)` (closeThenActivate closes gate, activates implement), then `gate.answered{outcome:approve}` — answered lands with implement *active*, so `allStagesDone` cannot fire; the machine sits in implement. The reversed crash window (mover landed, answer missing — the existing owed-mover recovery heals the opposite direction) heals on resume: a presented-unanswered gate record with the machine already in an execution state appends the owed answer. `run-recovery.ts` gains this row alongside the C5/C6 ones.

### D4 — Task walk: fact events + checkbox mechanization, `children` stays U2's

Per-task progress rides new L2 `task` events (`action: started|done|failed`, `id` = the item's 1-based index anchor, `detail?`), folded into a `tasks: Record<string, status>` context residue (the `children` shape's mechanical twin — not its vocabulary: `plan`/`children`/`child_spawned`/`child_done` stay reserved for U2's child *runs*, so that landing isn't semantic-smudged; `lastPlanOf` keeps "no producer"). The memo gains optional `tasks` beside `plan`/`children`. Implement's work: parse `tasks.md` (the `gate-digest-extract.ts` counts, extracted shared), pick the first unchecked item, spawn one implementer (role `implementer`, label `implement-t<n>`, round = index — so the session-ledger continuation keys per task), then run the per-task affected check (`bun run test:affected` — the script takes no paths: it derives the changed set from the working tree itself, and between slice commits that tree is exactly the current item's work; the implementer's `files_written` report stays the spawn's validated output, not command input), then the runner (never the agent) commits the slice: `git add -A && git commit` with the task's line as the message lead, the checked box landing in the same commit — `apply` guidance mechanized. `outcomeOf` reads the residue: tasks outstanding → self-successor; all done → `verify`. Attempts per item = count of its `started` events (fold-derived); over `TASK_FIX_ATTEMPTS = 2` → `StageHaltError('exhausted')` → C6 budget/escalation unchanged. Fix mode: re-entered with fix context (red verify, release veto) and no unchecked item left, the walk re-targets a done item rather than livelocking on the back-edge — the culprit is the item whose runner-made slice commit last touched a path named in the failing output (`git log --name-only` over the run's own commits; runner-made, so deterministic and spawn-free), falling back to the last-walked id when no path matches. The re-target re-emits `task started` (last-state-wins flips the record to running, attempts grow — the per-item bound is this loop's thrash governor), the spawn embeds the failing tail, and the fix context is re-read from the run's own artifacts (newest `verify-<n>.log`, the veto sidecar) by implement's work — the successor map carries no input channel, so nothing new rides the loop.

Agents never run git: the TDD-hook plugin already blocks `git stash`/`checkout --` in bash; commits by the runner keep the write guard meaningful (an agent-side commit would erase its own dirty set from under the guard).

### D5 — Verify: red is routing, not failure

`verify` runs compiled constants — `VERIFY_CHECKS = ['bun run typecheck', 'bun run lint', 'bun run test -- --serial']` — spawn-free, output to `runs/<id>/verify-<n>.log`. Red → outcome `fail` → successor `enter(implement)` with the log path as fix-context input (the fix prompt embeds the failing tail). Declaring red as `stage_failed exhausted` was rejected: the C6 under-budget retry would re-run the deterministic red suite and the escalation gate's movers can only re-enter the *failed* stage (verify) — a dead end with no route to a fix. The fix bound lives in D4's per-item attempts; only over-bound exhaustion becomes declared failure, which the escalation gate presents with the failure ledger (approve retries implement, extend grants fresh budget, abort → `failed` memo — the C6 stack verbatim). Verify's stage-map exit on routing back is normal (`done` = bracket closed; the red truth lives in the task/verify events and the log artifact).

### D6 — Write guard: repo-wide minus sibling change folders, implementer seam only

`RunStageAgentOptions` gains an explicit guard mode; the implementer seam declares `allowedExcept: ['openspec/changes/']` + `allowedPrefix: 'openspec/changes/<changeName>/'` — every newly dirtied path passes except another change's folder (the sibling property preserved; the agent-layer comment's "re-widen explicitly in that seam's terms" followed literally). Guard tests re-pin: source-tree writes pass, sibling folders fail naming paths, and every think-half seam keeps the narrow guard. The run dir/workDir are gitignored so they never register. Spawned implementers load the repo's opencode plugins (TDD write policy) by construction — no runner-side reimplementation of write protection.

### D7 — Release gate: mode `release`, disclosures, ladder logs and nothing more

Presented by release's work module (files first, `stage_enter(gate)`, presented at max-version+1, always-logging ladder with every rung suppressed from deciding — `evaluateLadder` gains a release-mode arm recording `rule none`; no `auto_decision` settle kinds widen). Content: execution digest (tasks done/total from the residue, verify outcomes from the events, `git log` commits since run start, spend from the existing usage seam), `### Decisions` block per the disclosure requirement. Settle outcomes: approve → exit-then-answer → `allStagesDone` fires → `completed`; veto → answer, exit, mover `stage_enter(implement)` carrying redirects (the veto-updater pattern re-used as fix-context, not artifact rewrites); extend → rejected by the response grammar (final-gate precedent); abort → `aborted`. Steer: `abort` valid, `veto` maps to the gate-level veto, `extend` rejected. Deadline waiter inherits the standard path.

### D8 — Parity and the legacy fold

The legacy fold (`legacy-fold.ts`, the frozen oracle) parse-widens its stage enum and tolerates the new event types as strict no-ops (the `resume` precedent, pinned by a synthetic scenario) so grown logs still replay. The parity harness's stage-map comparison normalizes to the legacy stage vocabulary — the three kernel-only pending entries are compared never, like the tally/failure residues. Historical fixtures (26) and live lanes fold byte-identically; new execution fixtures are synthetic-marked, join `fixtures/scenarios/`, and assert kernel fold + memo parity + prefix/resume-equivalence (not legacy equality — the legacy fold has no execution states).

### D9 — Operator surface

`status`/`runs` rows render `exec:<stage> [d/total]` from the fold; `report` adds the execution facts block; the memo's `tasks` projection; `analyze` needs no change (kernel-fold-based; new events fold, metrics degrade `unknown-with-reason` per its contract — pinned by a fixture). Resume classification: execution stages report `stage-rebuild, <stage>` through the existing `resumeEventOf` default arm.

## Risks / Trade-offs

- [Implementer quality — a spawned agent implementing against TDD hooks may stall or thrash] → per-item attempt bound (D4) + C6 escalation + killed-session continuation (F-A4 seam) bound the damage; escalation abort memos `failed` honestly.
- [Per-task commits dirty the tree the write guard snapshots] → the runner commits between brackets; each spawn's before-snapshot follows the previous commit, so the guard always sees the agent's own dirt.
- [Committed-but-red slices when a later task breaks an earlier one] → the verify boundary runs the full serial suite; a red boundary routes back into implement with the failing output; nothing is pushed (Non-goal), so a red commit is repairable in place.
- [Sequential walk is slower than parallel] → accepted (U3 is sequential-first; U2 parked holds the parallel shape).
- [Fixture corpus growth] → execution scenarios are synthetic-marked and few (seven shapes); the golden-replay harness stays bounded.

## Migration Plan

Purely additive: no DB, no config-key changes, no event renames. Rollback is `git revert` of the change's commits — unarmed runs never touch the new code paths, and logs written by armed runs fold to unarmed-equivalent states under the reverted kernel except the new event types, which the pre-change reader rejects loudly (accepted: armed runs are this change's own product, none exist before it).

## Hook/TDD interactions

All new `afk-runner/src/**` files gate through the Write/Edit TDD hook pipeline (red test first, write protections active); `tests/afk-runner/**` likewise. Order of work: event schemas + kernel fold (red: fixture folds) → graph states/edges (red: transition probes) → work modules + guard widening (red: seam tests) → settle ordering + recovery (red: crash-window suites) → CLI/memo/report/status (red: surface suites) → fixtures + conformance drills.

## Open Questions

None blocking; the exact `VERIFY_CHECKS` membership and `TASK_FIX_ATTEMPTS` value are compiled constants, tunable on drill evidence without spec motion.
