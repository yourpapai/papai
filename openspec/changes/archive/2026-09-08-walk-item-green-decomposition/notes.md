<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Notes — walk-item-green-decomposition (task 6.1: the owed F-P2 live drill)

Pre-registration precedes evidence (the C7–C9 contract). This file is written BEFORE the
drill run starts and presented to the operator for sign-off; working notes accumulate
append-only below, and the adjudication + n=4-style ledger re-score close it out before
the change archives. Status: **locked at operator sign-off, 2026-09-08** (roster,
task pick A, base deviation, F-P3 induction — all approved; details in the sign-off
record below).

## Locked drill plan (proposed)

- **Scope:** one armed productive run (`start --execute`) on a red-first-prone task.
  The assertion under test is the F-P2 fix (commit 72a8ed4c8, design D1/D5): with the
  walk-granularity contract in both tail prompts, the decomposer emits only
  green-per-item tasks and the walk needs **zero operator re-targets**.
- **The assertion (pre-registered pass criteria):** the decomposer emits no test-only
  items and no test/impl pairs split across items; the walk completes every item
  through its own per-item checks (slice commits, no `task failed` escalation born of
  red-first shape); verify routes (green, or red→fix→green as routing); release
  settles; and **zero operator re-targets** — no hand merges in tasks.md mid-walk, no
  baseline-resetting hand commits, no surgical completions. Operator writes are gate
  answers, `resume`/`stop` verbs, and pre-registered induced faults only.
- **Honest failure shape (a red finding, not a hidden one):** the decomposer still
  splits red-first despite the prompt contract → record with event cites; design D2's
  wake trigger fires (a structural decompose-exit lint becomes evidence-owed) and the
  change does not archive on a green claim. A drill where nothing red arises and
  something else breaks is recorded as what it is. Never fabricate a pass.

### Run matrix (proposed — single run)

| Run | Regime            | Model                     | Budget | Deadline | Base commit                          | Carries                                                                                                        |
| --- | ----------------- | ------------------------- | ------ | -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| W   | `budget: null`    | `zai-coding-plan/glm-5.3` | null   | none     | `72a8ed4c8` (this branch's HEAD)     | the assertion; opportunistic F-P3 / F-U3 / F-P4 live drills; thrash / `C<n>` aiming                             |

- **Regime rationale:** unmetered, no deadline — both budget regimes were proven at C9;
  this drill is about granularity, not budgets, and R4/R5 budget noise stays out of the
  gates. Model: glm-5.3 (C9: flash burned attempts on the walk, 5.3 landed it; either
  model tests the fix since both C9 decomposers split red-first).
- **Base-commit deviation (recorded, for sign-off):** the run prompt's default target is
  a fresh worktree off `origin/master`, but the F-P2 fix (the prompt contract) and the
  walk-robustness guards live only on this branch — `origin/master` (333d1ce5b) does not
  contain 72a8ed4c8. A master-based target would run the *unfixed* decomposer prompts
  and could only fail. Target base = **72a8ed4c8**; the two master ratchet commits
  (493b92e68, 333d1ce5b — `scripts/mutation/baseline.json` only) are irrelevant to the
  drill and excluded.
- **Target mechanics:** fresh worktree at `~/Projects/yourpapai/walk-drill-target`,
  branch `walk-drill-target`; `bun install --frozen-lockfile` (the per-item
  `test:affected` checks and the verify gate need node_modules). Config through the
  five-key front door — `<target>/.afk-runner/config.json`
  (`repoRoot`, `workDir: '.afk-runner'` [gitignored at this base, unlike at C9 — the
  launch-config product landed], `model: 'zai-coding-plan/glm-5.3'`, `budget: null`;
  no `deadline` key). Launch `bun run afk-runner:start -- start <taskFile> --execute`
  from the target under `nohup` (start parks-and-exits at every gate; the waiter rides
  `resume` only). After each operator settle: `bun run afk-runner:start -- resume <runId>`.
- **Telescope:** `tail -f <workDir>/runs/<id>/events.ndjson` — watch
  `stage_enter(decompose)`, then `task started/done/failed` per item, `spawned` per
  implementer. Instruments: `status <runId>`, `runs`, `report <runId>`.

### Task pick (operator confirms at sign-off; all texts prescreen-vetted M)

- **A (recommended):** issue **#417 bugs 1–3** — the reply delivery path (fallback
  discards the generated answer; verifier returns empty text; no chunking for
  long messages). Maximally red-first-prone: the issue's own grammar is "write a
  reproducing test → fix → test passes", which is exactly the temptation the C9
  decomposers fell for. Edits confined to existing modules
  (`src/completion/verified-completion.ts`, the orchestrator send path, delivery);
  bug surface verified still open at this base (4096 exists only as a capability
  constant in `src/chat/telegram/metadata.ts`; no delivery-path chunking). Bug 4
  (embedding sweep) is excluded — the issue itself marks it skippable, and its
  wording carries the L-trigger word "provider". Expected 3–4 walked items
  (post-fix items are test+impl bundles — bigger than C9's). Prescreen: **M**.
- **B (minimal fallback):** issue #417 bugs 1–2 only — the tightest observable walk
  (2–3 items) if the operator wants the shortest drill surface. Prescreen: **M**.
- **C (alternative lane):** the serial-runner cwd restoration guard — C9's recorded
  F-U2 follow-up (a test's afterEach moved the cwd and poisoned 34 later serial
  files). Real backlog, red-first-shaped, `scripts/test/` scope. Prescreen: **M**.

### Pre-registered opportunistic drills (not-arisen never fails the cycle)

- **F-P3 live** (operator approval required to induce): with the walk parked between
  items (clean post-slice-commit boundary), make tasks.md unreadable; assert
  `stage_failed{implement, precondition}` + the escalation gate with the restoration
  resume hint — not a holder crash (the just-landed guard's first live proof).
  Recovery is the hint's own verb (restore the file, then approve/`resume`).
- **F-U3 live:** if any check exceeds 30 min: assert the kill + the
  `check exceeded wall cap (1800000 ms)` marker in the red context (fixture-proven
  only until now).
- **F-P4 live:** if an implementer attempts a blocked git verb: assert the refusal
  names the verb (the widened `.hooks/git/checks/` blocklist).
- **Thrash / `C<n>`** (still not-arisen after 3 cycles): aim via assumption-bearing
  task text (A carries the "decide from proof-check observations" flavor) and named
  decisions (chunk-boundary policy, stub-wording contract); the corpus sweep stays a
  one-command re-run.

### Protocol points

- **Never self-settle a productive run's gate** — pause at every gate for the operator.
  Gate grammar is in the gate file itself: `APPROVE` / boxes+acks / `VETO: <redirect>` /
  `ABORT` / `→ RUN 1 MORE`; release gates are verb-only (extend absent by design).
  Expected honest shape: an unmetered clean-converged final gate may R1-auto-approve
  in milliseconds before attendance (C8 pass-1 / C9 precedent) — the walk then ignites
  from a policy settle; recorded, not a miss.
- **Operator-write whitelist** (the zero-re-target ledger): gate answers (gate files,
  all settles), `resume`/`stop` verbs, the pre-registered induced faults, and nothing
  else. Any tasks.md hand merge, baseline-resetting hand commit, or surgical
  completion is a **failed assertion** and must be recorded with its cause — the F-P2
  fix is on trial, not the operator's patience.
- **Escape clause** (C7–C9 precedent): a crash-shaped run-blocker or log-honesty bug
  may be fixed in-change, red-first, with the deviation recorded here. Everything else
  rides existing verbs.
- **Zero-re-target operationalization (for the oracle):** no mid-walk tasks.md id churn
  beyond the fold's own records (`task started/done/failed` + slice commits); no
  escalation gates with red-first-flavored ledgers unless honestly arisen.

### Harvest and close-out plan (the C8/C9 pattern)

1. Copy `events.ndjson` + `state.json` into `tests/afk-runner/fixtures/live/` as lane
   **`walk-item-green-live`** (proposed name) + README row; extend the oracle in
   `tests/afk-runner/fixtures/live/inventory.test.ts` — the `liveLanes()` strict list,
   per-lane fold≡memo rows, and this drill's shape assertions (armed birth, final-approve
   mover-first, release exit-then-answer, zero hand re-targets = no mid-walk tasks.md id
   churn beyond the fold's own records; no red-first-flavored escalation ledgers unless
   honestly arisen). `bun run typecheck` after the oracle edit.
2. Append the adjudication + measurements below; write the n=4-style re-score note
   (U1/U2/U4/U8 hold-or-move, each with its falsifiable trigger); update
   `docs/architecture/afk-runner.md` §"Living follow-ups ledger" **only where a trigger
   actually fired** (evidence, not nostalgia; zero `next` stays unless one fires).
3. Check off 6.1 in tasks.md (same commit as its evidence); `openspec validate
   walk-item-green-decomposition --strict`; full serial `bun run test --serial` green in
   this repo; house-style long commit message. The change may then archive per the
   repo's archive guidance.

## Sign-off record

- [x] Operator sign-off (2026-09-08): roster as drafted — single run W, unmetered
      (`budget: null`), no deadline, `zai-coding-plan/glm-5.3`; **task pick A**
      (issue #417 bugs 1–3); **base-commit deviation approved** (target base
      72a8ed4c8, not origin/master — master lacks the fix under test); **F-P3
      induced drill approved** (induce once at a clean between-items boundary;
      F-U3/F-P4 stay opportunistic). Plan locked.

## Working notes (append-only during the drill)

### Pre-flight record (2026-09-08)

- [x] Target worktree `~/Projects/yourpapai/walk-drill-target`, branch
      `walk-drill-target`, base **72a8ed4c8** (the signed-off deviation); `bun install
      --frozen-lockfile` (661 packages).
- [x] Config through the five-key front door: `<target>/.afk-runner/config.json`
      (`repoRoot`, `workDir: '.afk-runner'`, `model: 'zai-coding-plan/glm-5.3'`,
      `budget: null`, no `deadline`). `git check-ignore` confirms line 73 covers it —
      the C9 `.afk-runner`-not-ignored incident is closed at this base; tree clean.
- [x] Task file (pick A, #417 bugs 1–3) written to `<target>/.afk-runner/task.md`;
      text prescreened **M** via `prescreenProfile` (L- and S-words avoided by
      construction; bug 4 excluded partly for its "provider" L-trigger).
- [x] Front door verified: `runs` against the target printed the empty roster, exit 0.

### Run W — launched 2026-09-08 05:04Z (`start --execute` under nohup from the start)

Run id `fix-the-response-delivery-path-verification-fallback-chunking` (slugified from
the task heading). Armed birth event seq 1 (`execution{action:'armed'}` — the D1 shape),
intake entered seq 2, estimator spawned on glm-5.3 seq 3. Launch log
`.afk-runner/start.log`; events at `.afk-runner/runs/<id>/events.ndjson`.

**Think half (2026-09-08 05:04–06:19Z).** Intake honest but **L** — prescreen M,
estimator L (one level, no disagreement warn; the signed-off honest-M aim was
band-shaping, and the estimator's rationale is real: cross-module completion →
orchestrator send → chat adapters → debug trace → i18n, explicitly "no new top-level
subsystem, no provider prose" — the band's actual criteria hold; recorded, not a
miss). Draft 14 min (seq 45–240). Review rounds 1–3, all `needs-review`, open sets
honest and shrinking (r1 raised 0B/5M/6N open 0/0/1; r2 0/5/4 open 0/0/1; r3
0/2/4 open 0/0/1). **Opportunistic drill (d) LANDED: third-strike concern thrash** —
the "generic stub / deliver model text" fingerprint raised r1..r3; round 3's
convergence carries `"concerns":["delivered empty final generic model non produced
reply stub text turn"]` (seq 1023), the loop stopped instead of recursing, **no
verification round bought** (the fold-derived denial working live), review exited to
decompose (seq 1027/1028, no gate, no auto_decision), and the final gate rendered the
`### Concern history` section with the cluster's r1/r3 entries (all resolver-edited,
none open) — every assertion of the pre-registered (d) protocol observed.

**Decompose (06:10–06:15Z) — the drill's heart: the granularity contract held on
first live proof.** `stage_enter(decompose)` seq 1028, decomposer spawn seq 1029,
exit seq 1107. The emitted tasks.md (13 items: 11 code + docs + full-verification)
opens with the contract in the decomposer's own words — "Every task is one complete
red→green cycle — the reproducing tests and the implementation land in the same
task, and each task must leave the working tree green (`bun run test:affected` in the
loop; full suite before finishing)" — and **every code item bundles its reproducing
tests inside the same item** ("Red→green additions in `tests/…`" phrasing, 11/11),
with **zero test-only items and zero test/impl pairs split across items** — the C9
failure shape (2.3-red-test/2.6-implement pairs) is absent. Scope note: the plan grew
bug 3 to all four chat platforms (13 items vs the 2–4 estimate — review rounds pushed
Mattermost/Kontur Talk in; items 4.1–6.2) — an attendance cost, not a granularity
violation; the new sibling splitter modules (`src/chat/<platform>/format-chunking.ts`)
are max-lines-driven in-package files, not top-level modules. Atomicity pass:
`{"split": 0, "merged": 0}` — no further granularity edits owed.

**Final gate v1 → operator APPROVE (06:19–06:27Z).** Presented seq 1131 (mode
final); digest tasks 0/13, cost $6.71 · 4466s, zero assumptions (no acks owed), one
dismissed nitpick (informational). Grammar note: the render offers no
`→ RUN 1 MORE` at final gates (extend is early-gate-only in the current engine —
`appendEarlyCapHitSections`; C7's extend-at-final lane predates this grammar) — the
file's own grammar (APPROVE/VETO/ABORT) is what the operator saw, per protocol.
Operator settle **APPROVE** written to `gate-1.md`, consumed by the resumed waiter.
**The armed D3 ordering landed live (again):** one classified
`resume{artifact-skip, gate}` seq 1134 → `stage_exit(gate)` 1135 →
`stage_enter(implement)` 1136 → `gate answered{final, v1, approve}` 1137 (implement
already active) → fresh-drive self-loop 1138 → `task started{id: 1}` 1139 — the walk
ignited, zero hand writes beyond the gate answer.

**The walk (06:27Z→): items 1–3 green through their own checks, zero operator
writes.** Item 1 (1.1) 10.7 min → slice commit `225b5076a` (impl + its reproducing
tests + the checked box in ONE commit — 38 impl lines + 189 test lines); item 2
(2.1) 11.5 min; item 3 (2.2) 6.0 min — each `task started → done` with green
per-item `test:affected`, no `task failed`, no escalations.

**Induced F-P3 drill (07:00:09Z) — the assertion FAILED at the commit-time call
site: live finding F-W1.** The rename (`mv tasks.md tasks.md.induced-fp3`) was
timed for late t3 flight but t3 finished early (06:55:46 — a 6-minute item), so
the break landed mid-t4-bracket (after t4's entry read, during its implementer
flight). t4's implementer completed normally (seq 1600, 10.9 min, $1.30 nominal),
the per-item check ran green — and the slice commit crashed the holder:
`commitTaskSlice` (`afk-runner/src/work/slice-commit.ts:36`) does its OWN
`readFile(tasksPath)` after the check, outside the walk-robustness guard's wrap,
and the ENOENT threw crash-shaped (refusal-alarm) — holder dead, no
`stage_failed`, no escalation, memo stale at `running` (the C6 crash contract
working as designed). **The walk-robustness claim "the crash-the-holder seam is
gone" is falsified at this second call site**: the F-P3 fix wrapped
`runImplementWork`'s entry read (`readTaskItems`) but not the commit-time read.
The drill's F-P3 entry-read assertion remains unproven live (the induction missed
its window — recorded honestly, not re-faked); the commit-path hole is the honest
finding. Disposition put to the operator below.

**F-W1 disposition (operator, 2026-09-08): record + route** — the finding routes
to `afk-runner-walk-robustness` (F-P3's owner) as an owed follow-up item
(wrap the commit-time read in the same `StageHaltError{precondition}` shape);
no in-change fix (the run is not blocked by it). **Crash recovery, live and clean
(operator-verb only: restore + resume):** `mv` the file back, `resume` → exactly
one classified `resume{path:'stage-rebuild', stage:'implement'}` seq 1601 → fresh
implement bracket seq 1602 → `task started{id:4}` #2 seq 1603 (attempts 2 of 2,
inside the bound) → fresh implementer spawn seq 1604 (the prior t4 session settled
`done`, so fresh per the continuation precedence — correct) → the re-run reads the
restored tasks.md (seq 1610) with its prior edits on disk. No state faked; the
C6 crash contract (stale `running` memo, fold-is-truth re-entry) did its job.

**Spawn-side wall cap + killed-session continuation, autonomous (08:09Z).** Task 6
(the big Telegram splitter item, 4.1) ran long: `implement-t6 exited with code 1:
Process timed out after 1800000ms` → `stage_failed{implement, exhausted}` seq 1964
(honest bookkeeping) → under-budget self re-run, **no escalation gate** → task 6
re-picked (started #2, attempts 2 of 2) → done in 2.5 min. The session ledger
proves the continuation: `implement-t6` round 6 attempt 1 `killed` → attempt 2
`done` on the **same id** `ses_f800a86c4ffejqQ2yFI1Ax7q0J` — the F-A4 fix's
kill-continuation shape, wall-cap flavored (bonus drill-(b)-shaped evidence). The
walk absorbed the kill with zero operator writes.

### Walk completion and release (10:02–10:09Z)

Task 13 (the full-verification item, 7.2) closed the walk — including one
`retrying{stall}` (10-min inactivity, the known glm-5.3 endpoint stall class)
absorbed by its watchdog retry; the item itself ran the full serial suite +
`bun check:full` + `test:mutate:changed` as its work. **All 13/13 tasks done
through their own per-item checks.** `stage_exit(implement)` seq 2831 → verify
entered 2832 → `verify-1.log`: `Ran 18023 tests across 1630 files. [145.80s]` /
`exit 0` / **`verdict: green`** — green first time, no red routing owed → release
entered 2834 → **release gate presented v2** seq 2836 (verb-only grammar,
extend absent by design) with `auto_decision{rule: none, decision: gate}` seq
2837 (no rung decides) and the full execution digest: tasks 13/13, verify-1
green, 13 commits listed item-text-first. Operator settle **APPROVE** → the D7
ordering landed: one classified `resume{artifact-skip, gate}` seq 2839 →
`stage_exit(gate)` 2840 → `gate answered{release, v2, approve}` 2841 — exit then
answer, **no implement mover** → terminal memo **`completed`**. Total: 2,841
events, $17.15 nominal list-rate metering (subscription bills $0), ~5.0 h wall.
Target tree clean; 13 slice commits on `walk-drill-target` from base 72a8ed4c8.

## Adjudication (task 6.1)

**The pre-registered assertion PASSED, with the run's only red finding unrelated
to granularity:**

- **Zero operator re-targets — PASS.** The complete operator-write ledger for the
  run: the final-gate APPROVE (gate-1.md), the release-gate APPROVE (gate-2.md),
  the pre-registered induced `mv` (F-P3 attempt) + its restore `mv`, and three
  `resume` invocations. No hand merges in tasks.md mid-walk (the fold's own
  slice-commit box-checks are the only mid-walk tasks.md writes), no
  baseline-resetting hand commits, no surgical completions.
- **Green-per-item decomposition — PASS.** The decomposer's 13-item plan contains
  zero test-only items and zero test/impl pairs split across items; every code
  item bundles its reproducing tests with the implementation and landed green
  through its own `test:affected` check (13 slice commits, each bundling impl +
  tests + the checked box). The implementers' own commit texts articulate the
  granularity reasoning ("one cycle, not separate tasks", "independently
  verifiable, so it stays a separate task") — the contract penetrated the whole
  walk, not just the decomposer. **Design D2's wake trigger did NOT fire.**
- **Walk resilience (not-arisen / honestly-arisen ledger):** zero `task failed`;
  one `stage_failed{implement, exhausted}` (t6's 30-min spawn wall cap) recovered
  autonomously through the under-budget re-run riding killed-session continuation
  (same session id in the ledger — F-A4-fix shape); one holder crash (F-W1,
  induced) recovered by restore + `resume` with exactly one classified
  `resume{stage-rebuild, implement}`; **zero escalation gates across the whole
  run** — the C9 contrast (six on Run P, eleven on Run U) is the fix's measure.
- **Verify routes green-first-time; release settles verb-only — PASS** (verify-1
  green 18,023 tests; no red-routing owed; D7 exit-then-answer observed live).
- **Drill (d) third-strike thrash — LANDED** (pre-registered opportunistic; see
  the think-half record: convergence `concerns` field, no verification round
  bought, `### Concern history` rendered at the final gate).
- **Drill (e) `C<n>` — not-arisen** (no cross-artifact disagreement synthesized;
  fixture evidence stands). **F-U3 live — not-arisen** (no check exceeded 30 min;
  per-item checks ran 2–8 min, the verify boundary 2.5 min). **F-P4 live —
  not-arisen** (no implementer attempted a blocked git verb; the widened
  blocklist sat unused). **F-P3 entry-read assertion — not-proven-live** (the
  induction missed its window; recorded, not re-faked) **with finding F-W1**
  (commit-time read unwrapped — routed to `afk-runner-walk-robustness` as an owed
  item per the operator's disposition).

### n=4-style ledger re-score (which of U1/U2/U4/U8 moved or held)

- **U1 team/mission spawner — hold.** Every stage single-spawn again; zero
  role-scheduling failures. Trigger unchanged (a stage needs >2 concurrent
  schema-carrying role agents with measurable finding loss).
- **U2 child-actor execution — park, closest approach yet recorded.** The walk
  consumed ~3.8 h of the ~5.0 h wall over a 13-item plan whose platform groups
  (Telegram/Mattermost/Kontur, items 4.x–6.x) are genuinely independent of each
  other and of the verifier workstream — but the serialized wall was not a
  bottleneck for any gate this cycle, and the dependency-bearing core
  (1.x→2.x→3.x) does not parallelize. Trigger not fired; the observation rides
  the row for the next armed cycle to confirm or decay.
- **U4 documenting+reflection states — hold.** This cycle's reflection is an
  append-only notes.md authoring pass atop the attended span — well under the
  day trigger; the operator load was two gate answers.
- **U8 TUI re-host — hold.** Surface discovery was near-zero this cycle (the
  five-key config front door worked first-try; telescope + status verbs answered
  everything) — far under 20% of attended wall.
- **No trigger fired anywhere in the ledger — zero `next` rows return; the
  §"Living follow-ups ledger" paragraph in `docs/architecture/afk-runner.md` is
  unchanged by this cycle** (evidence, not nostalgia).

### Post-run verification (in the target)

`openspec validate fix-the-response-delivery-path-verification-fallback-chunking
--strict` — **green** ("Change … is valid", 2026-09-08); target tree clean at
`263b40feb` (13 commits); the product awaits the operator's merge decision (PR or
direct) — out of the drill's scope.

### Close-out incident (recorded for forensics, 2026-09-08 ~15:14–15:19 local)

A parallel agent session working an unrelated change (`agent-todos-capture`) in
THIS worktree ran two scratch depth-S runs and, while committing its own five
commits, treated the drill's uncommitted harvest edits (oracle, README row, both
tasks.md edits, the freshly copied lane) as "stray working-tree edits" and
reverted them; the drill source in the target worktree and notes.md (untracked)
were untouched. All edits were re-applied byte-identically, the full serial suite
re-run green (18,025 tests, 0 fail — the pre-wipe run's report had honestly
flagged STALE), and everything committed as `18696527f` with pre-commit checks
4/4. Shared-host lesson: commit harvested evidence before tending anything else
on a worktree another session can reach.
