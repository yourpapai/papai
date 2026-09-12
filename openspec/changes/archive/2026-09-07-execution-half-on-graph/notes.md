<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Cycle notes: execution-half-on-graph §9 (de-facto C9 — the execution-half live drill)

Pre-registration precedes evidence (the live-proof contract). This roster is written BEFORE any §9
run starts and presented to the operator for sign-off; working notes accumulate append-only below,
and `reflection.md` (task 9.3, n=3 preamble — C7, C8, this cycle) is the closing artifact. Status:
**locked at operator sign-off, 2026-09-03** — roster as drafted (induced a/b, priced c,
opportunistic d/e/f, optional g/h/i all in); Run P = `glm-5.3-flash` ceiling **0.10**; Run U =
`glm-5.3`, `budget: null`, `deadline: 10`. Task picks: agent proposes, operator confirms at
pre-flight (the money gate for Run P — model confirmed above, task text confirmed there).

## Locked cycle plan

- **Scope:** ≥2 armed productive runs (`start --execute`) through the new states — final-gate
  approve igniting the walk (exit → implement mover → answer, D3), the sequential task walk with
  runner-made slice commits (D4), verify as routing (D5), the release gate on the C4/C5 stack (D7)
  — one **priced-metered** run (numeric ceiling, cost known) and one **unmetered** run
  (`budget: null`); both reach terminal memos (the both-regime scenario; C8 proved the regimes on
  the think-half engine, the execution half re-opens both).
- **Priced route:** `zai-coding-plan/glm-5.3-flash` ($0.075/$0.25/$0.015 per M — promo rates valid
  through 2026-09-09 per `opencode-priced-model-route` notes; re-verify if the cycle slips past).
  Cost doctrine: the subscription bills nothing per token — `costUsd` reads list-price metering
  ("what this run would have cost at API rates"), which is exactly the real-rate projection the
  numeric-ceiling drill needs. `synthetic/hf:zai-org/GLM-5.3-Flash` (the C8 priced
  entry) only if probed responsive at pre-flight. Run U runs `zai-coding-plan/glm-5.3` (locked at
  sign-off — full-strength implementer, no ceiling rides it).
- **Attendance:** no time limit (operator decision, C8 precedent). The agent drives the runner
  (start/resume/status/runs/report), telescopes `events.ndjson`, induces the pre-registered kills,
  and **pauses at every gate for the operator to settle** — never self-settles a productive run's
  gate. Final-gate grammar: `APPROVE` / boxes+acks / `VETO: <redirect>` / `ABORT` /
  `→ RUN 1 MORE`; release gates are verb-only (`APPROVE` / `VETO: <redirect>` / `ABORT` — extend
  rejected by design). Expected honest shape: on the unmetered run a clean-converged final gate may
  R1-auto-approve in milliseconds before attendance (C8 pass-1 precedent) — the walk then ignites
  from a policy settle; recorded, not a miss. On the priced run the calibrated ceiling should keep
  the final gate human-answerable (over-ceiling ⇒ R4 label, no insta-approve).
- **Launch mechanics (operator tooling, C8 five-key-config precedent):** fresh target worktrees off
  `origin/master` per run, branch per target; the CLI's `defaultCliDeps` hardcodes `budget: 5` /
  no deadline and reads only `AFK_RUNNER_MODEL`, so each run launches through a small operator
  wrapper that imports `defaultCliDeps(<target>)` and overrides `config`
  (`budget`/`deadline`/`model`; **`workDir: '.sdd-runner'`** — `.afk-runner/` is NOT gitignored
  and trips the tree guard, the priced-route probe's recorded incident; `.sdd-runner/` is).
  Recorded as a friction for the reflection (the CLI cannot express the regimes — U8-shaped).
- **Task selection:** operator-confirmed at sign-off. Criteria: honest-M band (edits confined to
  existing modules, no provider prose, no new top-level module — C7's two-L-bounds lesson), 2–4
  walked items so the walk is observable and the drill windows recur per item, real backlog work,
  prescreen-keyword-vetted task text (C7 finding 1), assumption-bearing / named-decision content
  to aim the opportunistic drills without fabricating findings.

### Run matrix (proposed)

| Run                    | Regime                   | Model            | Budget                        | Deadline                  | Carries                                                                                                                                            |
| ---------------------- | ------------------------ | ---------------- | ----------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P** (priced-metered) | metered, numeric ceiling | glm-5.3-flash    | **0.10** (locked at sign-off) | none                      | induced (b) implementer-child kill → escalation; pre-registered (c) numeric-ceiling R5 at that same gate; opportunistic (d)(e)(f)                  |
| **U** (unmetered)      | `budget: null`           | glm-5.3 (locked) | null                          | **10** armed (drill h in) | induced (a) holder kill mid-implement; optional (g) release-veto cycle, (h) unattended-gate expiry, (i) zero-signal probe; opportunistic (d)(e)(f) |

Both runs' logs harvest into the live lane (task 9.2); re-drill passes (C8 needed four on Run B)
suffix `-2`/`-3`… and stay workdir-resident unless they become the slot's drill-carrying log.

### Budget calibration for Run P (locked 0.10 — C8 D7 method)

Evidence: priced-route depth-S probe $0.0501 think-half (glm-5.3-flash); C8 scratch M-shaped think
half $0.233 over 13 spawns at the same price class. Expected M think-half on flash ≈ $0.10–0.25;
the walk adds ~$0.03–0.08 per green implementer spawn (killed spawns are cheap — killed early).
**Draft ceiling 0.10**: likely crossed by the final gate (human-answerable, R4-labelled — good) and
certainly crossed at the (b)-drill escalation gate (think-half spend + the walk's start ⇒ R5's
`spentUsd >= ceiling` numeric branch fires there). Consequences of crossing early are honest and
never-cut: R4 may refuse a needs-review verify round (proceeds unreviewed — recorded); ladder
labels change, nothing is severed. Stated uncertainty: if the run lands leaner and the ceiling is
never crossed by the escalation, that is a recorded finding (known-in-advance miss shape, C8
precedent) — fixture evidence stands and recalibration + re-drill is the operator's option; if it
crosses very early, same recording, never-cut bounds the damage.

### Drill roster

**Induced (operator-aimable; required by tasks 9.1):**

- **(a) Holder kill mid-implement** (Run U): telescope for `task started` + the implementer
  `spawned`; kill the holder pid (`runs/<id>/holder.json`) **and its process group**, then the
  orphaned implementer child (own pgid — the C7/C8 orphan premise; both kills pre-registered).
  `resume <runId>`. Assert: **exactly one** classified `resume{path: 'stage-rebuild', stage:
'implement'}` event for the invocation, **no double-open** (no duplicate bracket opener for the
  re-entered walk — the log-fidelity owedness pair, implement-shaped), the re-pick continues the
  killed implementer session per the `(label, round)` ledger keying — the continuation spawn's
  argv carries `--session <killed-id>` — and the run reaches its terminal memo. Any-prefix
  recovery is part of the shape: a kill landing in any window resumes cleanly (reversed window →
  `owedAnswerOf`; slice 8 proved it in-process; this is the n≥2 live confirmation).
- **(b) Implementer-child kill → escalation-approve** (Run P): kill the spawned implementer
  **child only** (holder alive) on item k's bracket, and its watchdog retry → `retrying{stall}` →
  `stage_failed{implement, exhausted}`; the under-budget re-run's fresh bracket re-picks item k —
  **assert killed-session continuation live**: that spawn consults the ledger's killed
  `(implement-t<k>, k)` entry and rides the continuation path (`--session` argv; C8's F-A4
  observed this exact re-run minting fresh — the delivered fix must now continue; a fresh mint is
  a red finding). Kill it again → second `stage_failed` → escalation gate v1 (failure ledger,
  interstitial from still-active implement). **At v1 the numeric-ceiling drill (c) lands on the
  same gate.** Operator settles **approve** → assert the retry movers (`stage_exit`/`stage_enter`
  implement). Pre-registered interplay (forced by the landed design, first live observation): two
  failed brackets consumed two `started`s, so the approve-retry bracket hits the
  `TASK_FIX_ATTEMPTS = 2` bound and declares exhaustion **before any spawn or event** → the
  failure pair re-presents escalation v2 with the attempts-exhaustion ledger — the bound-vs-budget
  interplay is itself drill evidence. The v2 settle is the operator's: abort (honest `failed`
  memo) or the resumeHint's designed hand re-target (re-express the exhausted item as a fresh
  walkable id in the change's tasks.md, the walk skip-forwards) — decided at the gate, recorded
  here either way.

**Pre-registered/priced (required):**

- **(c) Numeric-ceiling refusal** (Run P, at the (b) escalation gate): cost known (priced route)
  and `spentUsd >= ceiling` ⇒ the escalation ladder records `auto_decision{rule: R5, decision:
gate}` (the exceedance branch — R4's cost-unknown branch is metered-only and was C8's live
  shape; the numeric branch is fixture-proven only) **and `→ RUN 1 MORE` is suppressed from the
  rendered gate** (`extendOffered = rule !== 'R5'`). The gate stays operator-answerable
  (approve/abort); extend's absence from the rendered grammar is the refusal. If the ceiling is
  uncrossed at that gate: recorded finding per the calibration note, never fabricated.

**Opportunistic (pre-registered protocols; not-arisen never fails the cycle — task selection
aims, fixture evidence stands):**

- **(d) Third-strike concern thrash** — a fingerprint raised to its third raise: convergence event
  carries the cluster ids, no verification round bought (denial is fold-derived), the following
  gate renders `### Concern history`. Aim: assumption-bearing, contentious named decisions in the
  task text.
- **(e) `C<n>` cross-artifact finding** — a named decision rendered differently across
  proposal/design/spec becomes a synthesized MATERIAL finding naming both files, riding the
  lens→resolver path with a fingerprint. Aim: increment-shaped tasks with named constants (C8
  aimed Run A this way; not-arisen there — verified identical by hand).
- **(f) Red-verify routing** (likely on real work): the walk's verify boundary runs the full
  serial suite; a red boundary routes back into implement as a **normal outcome** (no
  `stage_failed`), the fix re-target maps the failing tail to the culprit slice commit
  (runner-made, deterministic), re-starts it (attempts 2), and the completed fix **answers the
  verify log artifact by appending past the verdict** — the self-answering ledger, live. Green
  first time: slice-8's armed resume-equivalence fixture remains the proof, recorded not-arisen.

**Optional operator-verb drills (in if the operator opts at sign-off):**

- **(g) Release-veto cycle**: if the release digest shows a real flaw worth a redirect, settle
  release v1 `VETO: <redirect>` — asserts answer-exit-mover ordering, the `release-veto.md`
  sidecar, the fix re-target reading it, verify re-run, release v2 approve. Degrades honestly: a
  clean digest settles `APPROVE` and the cycle records not-arisen (never fabricate a redirect).
- **(h) Unattended gate past armed deadline** (Run U, `deadline: 10`): designate one mid-run gate
  unattended; the wired expiry (F-C3's fix — fixture-proven only) claims it with its
  `auto_decision` audit event (settle names the rule / re-arm records `none`+`pending`); no
  human-settled gate carries a waiter event.
- **(i) Zero-signal probe at the release gate**: answer one release presentation first with
  prose-only — expect rejection with directive guidance, response-error artifact, nothing
  settled, waiter alive (the contained-settle contract at the new verb-only gate mode).

### Cycle-level protocol points

Pre-registration boundary: an induced fault is a real condition the engine must handle honestly;
faking state remains a hack and fails the cycle. Operator writes are gate answers, steer inputs,
resume/stop verbs, and the enumerated induced faults only. Escape clause (C7/C8 D5 precedent): a
crash-shaped run-blocker or log-honesty bug may be fixed in-change, red-first, with the deviation
recorded here. Harvest (task 9.2): both productive runs' `events.ndjson` + `state.json` copy into
`tests/afk-runner/fixtures/live/` as new lanes; the oracle extends the C8 way — roster + per-lane
fold≡memo rows + per-lane incident-shape assertions, plus the `runs`-row status vocabulary widens
with `gate:release v<n>` (VALID_ROW_STATUS today knows only early/final/plan/escalation) and the
`exec:<stage> d/total` shapes; lane README rows; `bun run typecheck` after the oracle edit. The
reflection (9.3) regenerates the corpus report over the workdirs + live lane (`analyze` is
read-only, change-free — pinned) and re-scores the U-ledger: U3 → delivered, exactly one `next`
(or a tie note), U13 addressed explicitly (wake condition is U3 delivery; first probes zero-spawn).

## Pre-flight record (to complete before the first start — 9.2 opens here)

- **Task picks locked at the second sign-off gate (2026-09-03):** Run **P** ← S6-5+S6-7 (mutation
  ratchet scope for the coding-agent workspace — verified open on `origin/master`
  `stryker.config.json` mutate globs carry no `opencode-agent/**` entry; the C8-named fallback;
  numeric baseline floors + shard sizing as the named decisions), Run **U** ← the afk-runner CLI
  launch configuration surface (`loadRunnerConfig` exists with zero callers; absorbs the
  `.afk-runner` gitignore gap; the env-vs-config-file-vs-flags decision sits under the
  parseStartArgs command-doc pin). Fresh master worktrees, branch per target.
- [x] Priced-route probe (2026-09-03): `glm-5.3-flash` responsive, `step_finish cost 0.00286` /
      tokens 38,094 — cost-known live (promo rates still in effect; expiry 2026-09-09 noted).
      `glm-5.3` probe-verified 2026-09-02 in the priced-route notes (responsive, cost 0.0533) —
      not re-probed. Synthetic endpoint not considered (unneeded).
- [x] Target worktrees created off `origin/master` **15a806136** (advanced past 176a9fbde by a
      bot baseline-ratchet commit; S6-5 re-verified still open on the new master — mutate globs
      carry no `opencode-agent` entry): `~/Projects/yourpapai/u3-live-proof-target-{p,u}`, branches
      `u3-live-proof-target-{p,u}`; `bun install --frozen-lockfile` ×2 (the walk's per-task
      affected checks and the verify suite need node_modules a fresh worktree lacks); wrapper
      config pins `workDir: '.sdd-runner'`.
- [x] Task files written + prescreened: both texts run through `prescreenProfile` → **M / M**
      (L- and S-words both avoided by construction); parked at `<target>/.sdd-runner/task.md`.
- [x] Launch wrapper verified: `u3-run.ts` in the session temp dir constructs
      `defaultCliDeps(<target>)` with the `U3_*` env overrides (model / budget `number|null` /
      deadline) and dispatches all six verbs; `runs` against target-p printed the empty roster
      and exited 0.
- [ ] Drill telescope rehearsed: `tail -f <workDir>/runs/<id>/events.ndjson` for
      `task started` / `spawned`; `holder.json` pid read; child pid from the spawn event/ledger.

## Working notes (append-only during the cycle)

### Run P — launched 2026-09-03 (S6-5+S6-7, target-p, glm-5.3-flash, budget 0.10 metered, armed)

Operator misstep first (recorded for honesty; an engine-shape bonus came of it): the initial
`start` ran in the foreground and was killed at the agent's own 10-minute shell timeout mid-draft
(seq 99, holder 12838) — not an engine event. The orphaned drafter child (pid 17588, own pgid —
the C7/C8 orphan premise again) was killed by hand ~20 min in, then `resume task` under `nohup`
(holder 17719, the C8 launch pattern from here on). **Bonus live shape (unplanned):** the kill
landed mid-spawn and `resume` recovered exactly per design — one classified
`resume{path: 'stage-rebuild', stage: 'draft'}` (seq 100), fresh draft bracket (seq 101), re-spawn
(seq 102) riding the killed-session continuation seam — the F-A4-fix path observed live on the
think half before any planned drill fired. Run id `task` (slugified from the task-file basename —
cosmetic; lane names chosen at harvest).

**Think half (attended 2026-09-03/04):** intake honest-M (prescreen M, estimator M — no
misclassification); draft → 3 review rounds; round 3 closed `needs-review` at cap with spend
$0.68 ≥ ceiling $0.10 → **the R4 numeric refusal landed live**: no round 4, no `auto_decision`,
`stage_enter decompose` (the refused-round shape) — C8's live evidence was the cost-unknown
branch; this is the exceedance branch, think-half flavored. Final gates v1/v2 carried
`auto_decision{rule: R4, decision: gate}` (human-answerable, no R1 insta-approve) and rendered
**without the `→ RUN 1 MORE` directive** (extend suppressed at over-ceiling final gates — the
metered never-buy shape). **Calibration miss recorded:** the ceiling was crossed mid-draft (draft
alone ≈ $0.30) — zai flash at list rates burns ~3× the C8 synthetic-flash calibration; the
pre-registered never-cut bound held (nothing severed; only refusal labels changed). **Operator
settles:** final v1 `VETO: consolidate` (27-item plan → the revision rode the tail re-run with no
new review round, the C8-measured shape; re-presented v2 at tasks 0/23 in the six demanded
seam-groups — granularity stayed fine per repo conventions) → v2 `APPROVE` → **the armed D3
ordering landed live**: `stage_enter(implement)` seq 970 → `gate answered{approve}` seq 971
(implement already active) → fresh-drive self-loop seq 972.

**Drill (b) — implementer-child kill → escalation-approve — landed as registered.** Killed
`implement-t1`'s spawn + watchdog retry (child only, holder alive) → `retrying{stall}` seq 995 →
`stage_failed{implement, exhausted}` seq 1002 → the under-budget re-run's fresh bracket
(`task started` #2, seq 1003) **rode the killed-session continuation**: argv
`--session ses_f95784f40ffeLaJT6Oe86MO3Vh`, the ledger showing attempts 1+2 `killed` and the
re-entry continuing the same id — **the F-A4 fix's first live proof** (C8's same re-run minted
fresh). Two more kills (one landing as a `validation` retry) drove the attempts bound: the
re-picks threw `task 1 exhausted his fix attempts (2)` **before any spawn or event** (the bound's
designed refusal), the failure ledger honestly mixing kill-flavored and bound-flavored entries →
escalation gate v3 (seq 1040). **Drill (c) — numeric-ceiling refusal — landed at that gate:**
`auto_decision{rule: R5, decision: gate}` seq 1041 (cost known, $0.38 ≥ 0.10) and the rendered
gate offers **only** the T1-box approve and ABORT — extend suppressed, exactly the registered
assertion. **Operator settle: hand re-target + APPROVE** (the resumeHint's designed escape — 1.1's
box checked with the work re-expressed as appended item 6.6; the change's tasks.md is the
product, the engine's own hint names it): `gate answered{escalation, v3, approve}` seq 1042 →
retry movers `stage_exit`/`stage_enter(implement)` seq 1043/1044 → self-loop 1045 →
`task started{id: 2}` — the walk skip-forwarded past the hand-checked item and is running 1.2
with a real spawn. The pre-registered approve-retry-hits-the-bound cycle was observed INSIDE the
v3 ledger (bound-flavored failures) rather than after the settle — the hand re-target preceded
the approve, so the retry had a walkable item.

**Escape-clause deviation (operator-approved, 2026-09-04) — live finding F-P1: the runner-issued
slice commit fails silently under a rejecting pre-commit hook.** The target repo's `pre-commit`
hook runs `scripts/check.sh --staged`; the implementer's item-2.1 test carried a lint error
(`no-conditional-in-test`), the hook rejected the commit, and `EXEC_GIT`'s contract returns no
exit code — `commitTaskSlice` could not observe the failure, so items 2–4 were marked done with
their work staged-uncommitted. Aggravator: each commit re-checks the whole accumulating staged
set, so one red item poisons every later slice commit — the run could produce no commits at all
from that point. Fix (red-first, `--no-verify` in `commitTaskSlice`, the mirrored suite's argv
expectations + the implement seam's pins updated): the verify boundary is the walk's quality
gate; a per-commit hook double-gates and cross-poisons. Engine swapped mid-run (holder killed,
orphan implementer killed, resume on fixed code — `resume{stage-rebuild, implement}` seq 1246,
implement-t5 continuation). The staged blob (items 2–4) rides into the next successful slice
commit via `add -A`; the lint error rides into verify, where D5's routing is designed to catch
it. The exit-code visibility half (EXEC_GIT plumbing) stays recorded as follow-up material, not
fixed in-change.

**Live finding F-P2 (recorded 2026-09-04, operator-approved structural re-target): red-first
task decomposition structurally fails the walk's green-per-item affected check.** The decomposer
followed the repo's own TDD conventions and split test/impl into separate items (2.3 red test /
2.6 implement; 3.1/3.3, 3.2/3.4; 2.4/2.5 share one test file); the walk's per-task
`test:affected` demands green per item, so a legitimately-red pre-implementation test records
`task failed` twice → attempts bound → escalation v4 — and the uncommitted red test rides the
working tree, poisoning every later item's check (the cascade). Settle: 2.3 checked (attempts
burned), 2.4+2.5 / 2.3+2.6 / 3.1+3.3 / 3.2+3.4 merged in tasks.md (ids stable — folded items
checked with a note), the staged blob hand-committed `--no-verify`
(`106a2c99a` — the operator verb that resets the affected baseline), approve v4 → retry movers →
`task started{id: 6}` (merged 2.4) with a clean per-item diff. Design implication for the
reflection/follow-up: the walk's check assumption ("between slice commits the tree is exactly the
current item's work, green") and the repo's red-first decomposition convention are incompatible
at the decomposer — either decompose-guidance forbids red-first pairs at this granularity, or
the check tolerates declared-red pre-impl tests.

**Live finding F-P3 (2026-09-04): the missing-tasks.md precondition crashes instead of
escalating.** The 5.1 seed implementer (a 30-minute wall-capped spawn) spent its bracket doing
5.2's "land as ONE commit" early: it created an `agent/issue-42` branch (opencode-agent
conventions leaking), reset to `origin/master`, and deleted the change folder — then timed out.
The re-entered implement bracket's `readFile(tasks.md)` ENOENT threw a **plain `Error`**
(crash-shaped, refusal-alarm) — the holder died — although the C6 taxonomy names exactly this
shape `StageHaltError{precondition}` (immediate escalation); `implement.ts`'s read-catch wraps
as plain Error instead. Not fixed in-change (recovery by `resume` after the operator's git
restore was clean and the remaining run does not re-enter the path); recorded for the follow-up
with F-P1's exit-code half. **Live finding F-P4: the agent git-verb blocklist is too narrow** —
the TDD hook blocks `git stash`/`checkout --` in spawned bash, but not `git reset`/`git rm`/
branch creation; the write guard checks file writes, never history. The damage was fully
recoverable from the reflog (**operator recovery, 08:09Z**: `reset --soft 0532f8171` +
`restore --source` the change folder + branch-pointer fix + `resume` — seq 2331 implement
re-entry, task 16 re-picked on its last attempt, the seed's partial baseline preserved as
uncommitted diff). The slice commits survived intact; nothing was lost. Bonus already banked
before the crash: item 2.6's slice commit `f2875edbc` — the F-P1 `--no-verify` fix's live
proof — then 2.7/3.3/3.4/4.1/4.2 slices landed in sequence, and the first verify boundary ran
**red and routed back into implement as a normal outcome** (`verify-1.log` last line
`verdict: red`, no `stage_failed` — drill (f), landed).

**Mid-cycle operator decisions (2026-09-04, all recorded):** (1) v5 settle — retry flash once
more (operator choice over the recommended fallback); the retry landed 2.6–4.2 green on flash.
(2) The 5.1 seed wall-capped twice (30-min spawn cap vs a chunked-30–60-min-per-chunk seed job)
→ v6; (3) the pre-registered **glm-5.3 fallback engaged at the endgame** (the C8 mid-cycle
model-switch precedent): 5.1 checked with the seed recorded partial, v6 APPROVE, kill+resume with
`U3_MODEL=glm-5.3`. A second recovery rode the same crash's tail: the rampage's **staged
deletions** survived the first soft reset (index vs worktree divergence — tasks.md briefly a
mangled mix, escalation v7 thrown on stale item-1 residue); repaired with
`restore --staged` + `restore --source --staged --worktree`, the v7 settle pre-written and
consumed by the resumed waiter — task 17 (5.2) started on glm-5.3 (seq 2485/2486). Operational
lesson recorded: recovering a staged-deletion rampage needs index+worktree restore, not soft
reset alone.

**Endgame and completion (2026-09-04 11:00Z).** glm-5.3 walked the endgame cleanly: 5.2's
single landing commit `4ce55c15c` (partial seed inside), 5.3's ordering confirmation, the 6.x
documentation items, 6.6 (the 1.1 re-expression pin), and **6.7 — the mapper flash failed twice —
landed first try** (`e9ade9180`). A fix-mode bracket rode the earlier red boundary: the culprit
mapping re-started item 17, answered verify-1's verdict by appending past it, verify-2 ran
**green** (`verdict: green`, last line). **The release gate presented live** (mode `release`,
v8, seq 3281): verb-only Decisions (approve/veto/abort — extend absent by design), the ladder
logging `auto_decision{rule: none}` (no rung decides), and the full execution digest — tasks
**18/25 done** (the honest fold: 18 walked, 7 hand-retargeted/burned), per-log verify verdicts
(red → green), the run's own 16 commits listed, $6.53 metered at presentation. **Optional drill
(i) landed at the release gate**: a prose-only zero-signal response was rejected —
`gate-8.response-error.md` written, nothing settled, waiter alive. Operator settle `APPROVE` →
`stage_exit(gate)` seq 3284 then `gate answered{release, v8, approve}` seq 3285 — the D7
exit-then-answer ordering with **no implement mover** — terminal memo **`completed`**. Product:
`openspec validate task --strict` green in the target, clean tree, 16 commits on
`u3-live-proof-target-p`, total spend $13.32 nominal (list-rate metering; subscription bills $0).
**Run P verdict: the priced-metered armed regime traversed the full execution half live — armed
final approve (D3), the walk with runner-made slice commits, six escalation gates across four
failure flavors (kill-driven, attempts-bound, red-first, wall-cap) plus the staged-deletion
crash, the pre-registered model fallback, red-verify routing with the self-answering artifact,
and the release gate with its verb-only grammar.**

### Run U — launched 2026-09-04 11:05Z (CLI launch configuration surface, target-u, glm-5.3,

budget null unmetered, deadline 10 armed, `start --execute` under nohup from the start — the
Run P foreground-timeout lesson applied; armed birth event seq 1, the D1 shape live). Carries:
induced (a) holder kill mid-implement; optional (g) release-veto cycle, (h) unattended gate past
the armed deadline (the F-C3 fix's first live proof), (i) zero-signal already landed on Run P;
opportunistic (d)(e)(f). Expected honest shape: a clean-converged final gate may R1-auto-approve
before attendance (unmetered — no ceiling suppression; C8 pass-1 precedent) — the walk then
ignites from a policy settle.

**Think half, first park:** honest-M again (estimator M, no misclassification); draft → round 1
→ round 2's reviewer stalled twice (10-min inactivity, glm-5.3 endpoint-shaped) → escalation v1
presented with **`deadlineAt` stamped** — and the first operator mistake with a lesson: `start`
parks and exits by design (the waiter rides resume only), so the gate sat unattended with no
waiter for over an hour before the agent noticed and resumed. **Drill (h) landed at that gate**:
the freshly-attached waiter claimed the long-expired deadline — `auto_decision{rule: none,
decision: pending}` audit events, replay-distinguishable, the **F-C3 fix's first live proof**.
**Live finding F-U1 (escape-clause fix, operator-approved by the pre-registered clause): the
post-re-arm park floods the log with pending records** — after the single re-arm, every waiter
poll tick re-emitted `auto_decision{none, pending}`: **6,333 duplicate events** over ~2.4h
unattended (one per second) before the explicit APPROVE settle stopped it. The suite had pinned
the re-arm event's singularity but never the pending record's. Fix (red-first, mirrored suite
extended): the pending record is **per-gate-once** — `reArmOrPark`'s parked branch emits only
when no pending record exists for the gate version (`pendingRecordedFor`); the affected sweep
green (one load flake re-verified standalone per the runbook). Engine swapped mid-run (holder +
orphan killed, resume — one classified `resume{session-continuation, review, ses_f93911615…}`,
seq 6763 — the review-round continuation shape as a bonus; flood count frozen at 6333, the
flooded log kept as honest evidence for the lane).

**Drill (a) — holder kill mid-implement — landed as registered (18:13Z).** With
`implement-t1`'s spawn mid-flight, the holder pid 10180 **and its process group** were killed,
then the orphaned implementer child (67619, own pgid — the C7/C8 orphan premise, third
confirmation); `resume` appended **exactly one** classified
`resume{path: 'stage-rebuild', stage: 'implement'}` (seq 7122) with the bracket re-entry at
7123 and **no duplicate opener** for the re-entered walk; the re-pick's spawn **continues the
killed implementer session** — ledger `implement-t1` round 1 attempt 2 on the same
`ses_f926150beffeI5J0mGYdV5kxQt`, the live child's argv carrying
`--session ses_f926150beffe…` (the (label, round) keying, live). Task-started arithmetic: two
`started` events for id 1 (the killed bracket + the re-pick — the attempts bound sees exactly
the walk's two). Resume-event accounting: 3 events for 3 invocations across the run — one per
invocation, none deduplicated.

**Run U endgame (2026-09-05).** The walk collided with F-P2's generalized shape immediately —
every item failed its affected check (the decomposer's red-first sections again, plus each
failed item's red test poisoning every later check), burning escalations v3–v7 while the
operator re-targeted in batches (whole sections checked-and-merged into appended 8.x items, two
baseline-resetting hand-commits). The 8.x core items could not land through the walk (attempts
burned on poisoned checks) → the **operator surgical completion** (2026-09-04/05, approved):
`DEFAULT_*` constants + `resolveRunnerConfig` ladder in config.ts, the pure `defaultCliDeps`
assembler + async `cliMain` resolution in cli.ts, the CLI resolution tests, the agent-seam
signature update — the target's afk-runner suite 1099 green. The verify boundary then taught
three lessons live: **F-U2** (the first serial full-suite run's 34 failures were a cwd leak —
my surgical test's afterEach restored to `import.meta.dir`, poisoning the shared serial
process's cwd; fixed by restoring the captured original), **the self-answering ledger's
operator arm** (verify-1's still-owed verdict blocked the walk in a fix-target loop until the
operator appended the answer line past it — the release-veto.md precedent, live), and **F-U3**
(the runner-spawned verify suite hung 6+ hours with an idle child — verify's command seam
carries no wall cap; recovered by kill+resume; the killed run's red shaped verify-2), and a
**real lint red** (the implementers' matrix conditional — `no-conditional-in-test`, invisible
to test-only runs, caught by verify's lint leg; hoisted, committed). verify-4 **green**
(17552/0), the release gate v12 presented with the brutally honest digest — **Tasks 0/24
done** (8.5's one walked `done` was overwritten by the later fix-mode restart; status
last-wins), verify red×3 → green, 5 commits, $6.35 nominal — and settled `APPROVE`:
`stage_exit(gate)` then `gate answered{release, v12, approve}` — terminal **`completed`**
(10:27Z). Optional drill (g) degrades to **not-arisen-with-cause**: no honest redirect existed
at the release digest, and a fabricated veto is forbidden by the pre-registration.

### Harvest record (task 9.2)

Both C9 lanes copied and the extended oracle green (15/15):
`mutation-gate-widening-live` (Run P, 3,285 events) and `runner-cli-config-live`
(Run U, 7,767 events — F-U1's flood kept as evidence). The oracle's roster carries five
lanes; the armed lanes assert schema-validity, fold≡memo at the completed terminal
(tasks projection included), the armed birth event, the final-approve mover-first
ordering, the release exit-then-answer settle, Run P's R5 + kill-retry shapes, and Run
U's single stage-rebuild implement resume with per-gate-once re-arms; the
`runs`-row status vocabulary widened (`gate:release v<n>`, `exec:<stage> d/total`); the
unpriced count re-pinned at 3 (the C9 lanes are priced/cost-known — first cost-known
lanes in the corpus). Lane README rows added; `bun run typecheck` green after the
oracle edit. Products: both targets strict-valid (`openspec validate task --strict`),
clean trees; Run P 16 commits, Run U 5 commits, both on their target branches.
