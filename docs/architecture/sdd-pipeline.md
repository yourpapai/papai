<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# SDD Pipeline

The `sdd-runner/` workspace automates the outer loop of spec-driven development: a runner sub-project orchestrates drafting, fresh-eyes review, convergence, and decomposition across spawned `opencode run` agents inside one OpenSpec change, reporting progress at pipeline altitude and concentrating human attention at a single gate. The stages compose end-to-end via `src/orchestrator.ts` (`runStart`/`runResume`/`runGateResume`); `src/report.ts` synthesizes evidence-backed run/PR reports from `events.ndjson`, the change folder, and the branch git log.

## Stages

```
INTAKE → DRAFT → REVIEW LOOP → DECOMPOSE → ATOMICITY → GATE → (exit)
```

- **Intake**: depth classification (S/M/L), change scaffolding via `openspec new change`. Two classification caveats are surfaced as `intake:` warn lines rather than left in the event log: a `--depth` override skips the estimator, which is the only source of the `oversize` verdict, so such a run is never decomposed into child runs; and a two-level split between the estimator and the keyword prescreen names both readings and the higher one taken.
- **Draft**: proposal, specs, design per the `auto-sdd` schema DAG.
- **Review loop**: fresh-spawned reviewer agents per round, resolver pass, and a convergence predicate over **two** count sets — *raised* (every finding the round recorded) and *open* (only what a human can settle). A nitpick-only cap-hit is treated as converged (see "Raised vs open" and "Severity-based convergence" under Gate protocol).
- **Decompose**: tasks.md generation.
- **Atomicity**: split/merge tasks (skipped at S).
- **Gate**: single human gate with checkbox protocol.

### Admission vs division

Two of the project's rule sets pull in opposite directions on size, and read together
they look like a contradiction. They are not: they answer different questions, at
different stages.

```
   ADMISSION                          │  DIVISION
   does this scope exist at all?      │  how is admitted work broken up?
   ── DRAFT ──────────────────────▶   │  ── DECOMPOSE → ATOMICITY ──────▶
   openspec/config.yaml               │  openspec/config.yaml
     rules.proposal, rules.design     │    rules.tasks
   "state what breaks without it";    │  "independently verifiable chunks";
   "name what already covers it"      │  sdd-runner/src/decompose.ts splits
                                      │  any task bundling several
```

`rules.proposal` asks a drafter to justify each declared capability and routes scope
that fails that test into the proposal's Non-goals, where it stays visible as
declined. Nothing there argues for fewer tasks. Once scope is admitted, the atomicity
checker is free to split it as finely as the work warrants — splitting is this
repository's settled answer to size, the same answer `max-lines` gives for a file.

A minimality rule must therefore never be added to `rules.tasks`: it would argue with
a checker built to split. Nothing enforces that boundary — it is a rule about prose,
and a test matching phrasing in YAML would fail legitimate rewordings while missing
a rule worded differently. This section is the guard.

## Event model

Three altitudes in `<runDir>/events.ndjson`:
- **L0** agent telemetry (tool use, token/cost deltas)
- **L1** agent lifecycle (spawned, retrying with reason, killed, done)
- **L2** pipeline semantics (stage transitions, round open/close, findings, assumptions, convergence, gate)

The event log is sufficient to rebuild the rendered view by replay alone.

The L1 `done` event carries the model id (`done.model`) that produced its usage. Pre-change logs lacking the field are backfilled at reprice time from the agent→model map rebuilt by replaying `spawned` events.

Three L2 variants exist for run decomposition — `plan` (child count + digest), `child_spawned` (child id + run id), `child_done` (child id + `done|failed` outcome + optional aggregated usage) — and `gate.mode` accepts `'plan'`. The plan branch emits them (see Composite runs); replay folds them into `ReplayState.children`, and pre-decomposition logs replay to the identical state plus an empty `children` map.

### Cost fallback

`done.usage.costUsd` is the emit-time meter read; for subscription providers (e.g. `zai-coding-plan/glm-5.2`) it is `0` regardless of token volume. `aggregateUsage` (`usage-aggregate.ts`) runs a reprice pass before reducing: every zero-cost `done` event with tokens > 0 is repriced via `resolveCost` (`pricing.ts`), which fetches `https://models.dev/api.json` (60-min cache at `~/.cache/sdd-runner/models.json`) and resolves PRIMARY (configured provider's own non-zero price) → FALLBACK (median of non-zero entries across providers) → LAST RESORT (`null`). `reasoningTokens` fold into the input side of the recompute. Repricing is a no-op when emit-time cost is already non-zero, so an upstream fix composes without conflict. `pricing.ts` has a second consumer that reads none of this: `lookupModel` returns the **whole** catalogue row — `limit`, `reasoning`, `tool_call`, `temperature`, `attachment` — and `opencode-agent/src/model-metadata.ts` splices those into the OpenCode provider config it emits, so a model OpenCode cannot find still gets a declared context window. Every field beside `cost` is `.catch(undefined)` rather than merely optional: `loadDb` swallows a parse error and answers `{}`, so one malformed entry would otherwise cost both consumers the whole database.

The gate's `### Cost / duration` line carries a marker:
- **metered** — `costKnown: true`; cost came from the provider meter (emit-time non-zero) or a PRIMARY resolve.
- **estimated** — `costKnown: false` with non-zero cost; a FALLBACK median was applied.
- **unknown** — `costKnown: false` with zero cost; resolve fell through to LAST RESORT.

Network/parsing failures are swallowed: the resolver returns `null` for every model, so the gate degrades to `$0.00 · <walls>s · unknown` rather than halting. Pricing never fails a run, but it is not cosmetic either: `costKnown: false` makes the R4 rung gate unconditionally, so an unreachable database leaves the autonomy ladder inert and every gate human-decided (see Known limitations). The live renderer's status line applies the same resolver at display time (see Live rendering) with a `~$` marker for estimated figures; only the gate digest shows the aggregate (repriced) cost with the full tristate marker.

## Depth profiles

- **S**: no design.md, 1 review round, no atomicity check. Expected path for small changes via `--depth S`.
- **M**: design.md, 3 review rounds, atomicity check.
- **L**: design.md, 4 review rounds, concurrent skeptic lens, atomicity check.

Mid-run escalation only (M gains the skeptic lens when BLOCKERs remain open after round 2).

## Gate protocol

The gate is enterable at three points: an early cap-hit presentation (before decomposition, blockers-focused), a final presentation (after atomicity, full digest), and a plan presentation (oversize tasks, before any child runs — see Composite runs). All share a versioned `gate-<n>.md` file that is the single decision record and hash/audit anchor.

### Deciding a gate (the three front-ends)

**Primary path — interactive session (TTY).** `sdd <runId>` on a terminal opens the Ink **gate screen** (`tui-gate-session.ts` driving `tui-gate.ts`; decision logic in `gate-session-state.ts`): every finding and assumption is a checkbox row with its evidence and blast radius (toggle to veto; veto collects the redirect through an inline single-line text input), cap-hit blockers take a free-text answer or `OVERRIDE`, the trajectory ack (T1) is a checkbox, and the decision menu `(a)pprove · (e)xtend · (x)abort` prints each choice's downstream consequence beside it — the same mode-conditional phrases the gate file's `### Decisions` block renders (`decisionConsequences` in `gate-render.ts`; one copy source, two front-ends). Approve is unavailable until T1 is affirmed and every blocker is answered. The session **writes** `gate-<n>.md` from the collected answers (`gate-answers.ts` renders the identical grammar the parser accepts, guarded by a write-then-parse self-check that refuses to proceed on any drift); abandoning (`q`) before a decision writes nothing and the gate stays pending.

**Non-TTY / CI / scripts.** There is no flag surface: decision flags were removed with the subcommand cutover and the invocation fails naming the hand-edited gate file as the decision path. Hand-edit `gate-<n>.md`, then rerun `sdd <runId>`; internal callers (deadline waiter, steer directives) settle gates through the same file-writing seam.

**Power path — hand-edited file.** The file protocol is preserved verbatim; an operator who hand-edits `gate-<n>.md` and resumes on a non-terminal gets identical behavior to today:

- Check every assumption box to **approve**.
- Leave a box unchecked to **veto** (optional `→ <redirect>` beneath).
- Answer a cap-hit blocker with `→ <answer>` or `→ OVERRIDE`.
- Write `→ RUN 1 MORE` on its own line to **extend** an early cap-hit gate by one round (early-gate only).
- Write `ABORT` on its own line to abort.

Bare approve with open blockers fails — override must be explicit.

Every presentation carries a `### Decisions` block naming each decision's downstream effect, so no approval is consequence-blind.

### Pending-gate discovery and run-id ergonomics

Multiple runs may be gate-pending concurrently, so every halt prints a next-step line with the concrete run id (`Next: sdd <runId>`). That line is copy-pasteable only where `sdd` resolves: the `sdd-runner` package declares it as a `bin`, so `bun link` inside `sdd-runner/` installs it — without the link the equivalent is `bun run sdd-runner:start -- <runId>`. Bare `sdd` lists or opens the pending runs (`listPendingGates` scans `runs/*/state.json` for a non-null `gate`, sorted by recency, with id, change name, gate version, and wait time; a sole pending run routes directly). Run-id arguments accept exact ids and unambiguous prefixes (`resolveRunId`); an ambiguous prefix fails loudly listing every candidate. Prefixes are an interactive convenience — scripts should use full ids.

### Approve-continues semantics (**BREAKING**)

Approving an **early** (cap-hit) gate no longer finalizes the run. It means "I accept the remaining findings as resolved — proceed": the pipeline continues into decompose → atomicity (depth ≠ S) → a **final** gate presented at `gate-<n+1>.md`, exactly as a converged review loop would (shared post-convergence tail, `post-review-tail.ts`). The human approved the *design* at the early gate; the final gate is where they sign off the *task list* — its digest renders `tasks: <done>/<total>`. Skipping it would trade one consequence-blind approval for another.

Consequences:

- No approval path produces a `completed` run without `tasks.md`. `completed` is reached only via final-gate approval; `aborted` is the only non-completing exit.
- The final gate after an early approval carries the next gate version (`n+1`), preserving the versioned audit trail.
- A stop-early outcome remains available as `ABORT`, which honestly records that the run did not complete.

### Raised vs open

The loop counts each round twice, because two different questions are asked of it:

```
   RAISED — what reviewers said        OPEN — what only a human can settle
   ─────────────────────────────       ──────────────────────────────────
   trajectory (R2's window)            R1, R2's eligibility, the never-cut
   burndown, sparkline                 blocker pre-check, cap-hit gating,
   lens escalation (M gains skeptic)   the gate's finding sections
   review.md's per-round verdict
```

A resolution is **open** when only a human can settle it: the resolver `dismissed` it; it claims `assumed` with no assumption record carrying that finding's id; or it claims `edited` but the change folder is byte-identical to the previous round's snapshot. `evidence-answered`, a linked `assumed`, and a real edit are closed. Splitting these was the fix for a finding the resolver had already *fixed* still reading as open — which is why no round could converge if anything above a nitpick was ever raised, and why depth S cost two human gates for work nobody objected to.

Both claims a resolver could otherwise make for free are checked rather than trusted. `sidecars/round-hashes-<n>.json` snapshots the agent-authored artifacts at each round close (`recordRoundDigests`, reusing the gate's own `recordArtifactHashes` and `listAgentArtifacts`) so an `edited` claim that moved no bytes reads as open; `AssumptionRecord.findingId` ties an `assumed` resolution to the assumption it logged. A sidecar whose assumptions carry no `findingId` at all predates the link and falls back to a round-level check, so pre-change runs resume with no migration. The snapshot deliberately excludes `review.md` and `assumptions.md` — the runner rewrites both every round, so including them would make every round look changed and the guard would never fire.

The round verdict is three-valued: `converged` (nothing open above a nitpick, ≤3 open nitpicks), `needs-review` (nothing open, but an edit above a nitpick that no reviewer has seen), `open` (something above a nitpick needs a human). The `convergence` event carries both count sets — `open` is optional, and a pre-split log folds it equal to `counts`, reproducing that run's original verdicts exactly. The `finding` event's action enum is deliberately **not** widened: replay folds counts straight from the convergence event, so nothing finer is needed for replay-sufficiency.

### Severity-based convergence

A cap-hit round with **zero open BLOCKERs and zero open MATERIALs** flows into decompose → atomicity → final gate **without presenting an early gate**, however many open nitpicks survived — the verdict's three-nitpick allowance governs whether the loop keeps running, not whether a human is needed. A cap-hit with any open BLOCKER or MATERIAL still presents the early gate. The review loop itself keeps reporting `cap-hit`; reclassification lives in the orchestrator (`routeCapHit` in `post-review-tail.ts`) so the loop's semantics and sidecar formats are untouched.

A cap-hit whose verdict is `needs-review` buys **exactly one** verification round before the tail, so the last round's edits are not shipped unreviewed. The bound is structural rather than a counter: that round's result routes straight to the tail instead of back through `routeCapHit`, so a second can never be granted for the same cap-hit. The budget guard declines it — unknown cost included, failing closed as R4 does — and the run continues to its final gate, where a human sees the result either way.

### Resume and continue

`resume` re-enters at the interrupted stage, derived from artifacts and the event log rather than persisted stage pointers (`deriveResumePoint` — self-healing when `state.json` drifted from reality):

- A pending gate is loud, not silent: `resume` on a gate-pending run prints that the run awaits a gate decision plus the exact `sdd-runner gate resume <runId>` command, then exits without side effects.
- The review loop counts as settled when a converged verdict is recorded, an early gate was answered by a human (approve = human-decree convergence), or the pipeline already entered decompose (severity convergence).
- Missing `tasks.md` after a settled review → resume at `decompose`; `tasks.md` present at depth ≠ S without a recorded atomicity stage → resume at `atomicity`. Both continuations source the review result from the `resolutions-<round>.json` sidecars (`readReviewResultFromSidecars`) and run the shared post-convergence tail to the final gate, numbered after the highest existing `gate-<n>.md`.
- Stages are idempotent by construction (decompose rewrites `tasks.md` wholesale; atomicity rewrites in place), so a spurious re-run after a crash-between-artifacts is wasted tokens, not corruption.

`continue` is the one routing verb that never fails silently (`continue.ts`): gate-pending → the gate flow (interactive session on a TTY, flag/file handling otherwise); interrupted mid-stage → the `resume` stage path; completed → a pointer to `sdd-runner report <runId>`. Without an id, a single gate-pending run routes directly and several print the per-run gate commands (a picker on TTY, a plain list otherwise) instead of guessing.

### Change digest

Every `gate-<n>.md` carries a `### Change digest` section between `### Summary` (the slug, a stable machine-readable anchor) and `### Cost / duration`, so a human opening the gate can answer "what is this change and what does it touch" in seconds without opening `proposal.md`/`design.md`. It is extract-only (no agent spawn) and pure-additive — the parser, checkbox semantics, and resume contract are unaffected.

The section renders a 5-tuple sourced from existing artifacts (`extractChangeDigest` in `gate-digest-extract.ts`; threaded in by `readChangeDigest` from `presentGateAt`):

| Field   | Source                                          | Tolerance on missing                              |
| ------- | ----------------------------------------------- | ------------------------------------------------- |
| WHAT    | First 1–2 sentences of `proposal.md` `## Why`   | `_(no "Why" section in proposal.md)_`             |
| WHY     | Full `proposal.md` `## Why`                     | `_(no "Why" section in proposal.md)_`             |
| TOUCHES | Bullets under `proposal.md` `## Impact`         | `_(no "Impact" section in proposal.md)_`          |
| RISKS   | Reference to an already-rendered findings block | Mode-aware (see below)                            |
| BLAST   | Reference to the assumptions block              | `_(no assumptions logged)_` when the list is empty |

Mode-aware rendering: at the **early** (cap-hit) gate TOUCHES carries no task line and RISKS points at `### Open MATERIAL findings at cap`; at the **final** gate TOUCHES gains a trailing `tasks: <done>/<total>` entry parsed from `tasks.md` and RISKS points at `### Nitpicks (informational)`. Only ATX headings (`## Why`) are recognized; setext-style headings and empty/malformed sections degrade to a placeholder rather than failing the gate.

### MATERIAL-only cap-hit path

When the round cap is reached with 0 BLOCKERs but ≥1 MATERIAL finding still open, the early gate surfaces additional content so the human can distinguish a converging loop from a stuck one:

- **Cap-hit trajectory** — a per-round burndown (`round k: <b>m <n>n · <resolved> resolved · <dismissed> dismissed · <verdict>`), rendered by `formatTrajectoryBlock` from `events.ndjson` replay. NITPICKs are count-only (not expanded).
- **Open MATERIAL findings** — each open MATERIAL finding gets a checkbox (`- [ ] F<n> <gap>`) with `resolver: <resolution> — <outcome>` beneath. Leaving a box unchecked is a veto (optional `→ <redirect>`). The gap is the reviewer's verbatim quote, joined from `findings-<n>.json` and `findings-skeptic-<n>.json` (`readRoundGaps`), collapsed to one line, stripped of a leading `→`, and truncated — an unsanitized multi-line gap could otherwise be parsed back as a decision it never was. A finding missing from the sidecars falls back to its identifier. `renderGateAnswers` flattens every free-text field it writes for the same reason: it is the single writer of gate files, so a caller that hands it raw multi-line prose still cannot open a second line the parser would read as `ABORT`, `→ RUN 1 MORE`, or a checkbox row.
- **Trajectory-reviewed ack** — a required `T1` checkbox under a `### Trajectory reviewed` heading, present only when cap-hit fires with 0 BLOCKERs. The gate SHALL NOT be approvable without checking it; `--confirm-all` checks it like any other box. This is the vacuous-approval guard: without it, an early gate with 0 blockers and 0 assumptions would be trivially approvable.

### Open-MATERIAL-finding veto

Open MATERIAL findings rendered as `- [ ] F<n>` checkboxes have the same semantics as assumption boxes: checking = proceed, leaving unchecked = veto (optional `→ <redirect>` beneath). `--confirm-all` checks them.

### Veto resolver pass

A veto triggers exactly one resolver pass before the gate is re-presented at `gate-<n+1>.md`:

1. **Sidecar update** (`updateAssumptionsFromVetoes` in `veto-updater.ts`) — for each vetoed assumption with a redirect, the runner mechanically sets `assumption.text = redirect` in `resolutions-<round>.json`; assumptions vetoed without a redirect are marked `status: 'vetoed'`. Finding vetoes with a redirect update the matching resolution's `outcome`. This is deterministic — no agent intelligence is needed.
2. **Updater agent** (`runVetoUpdater`) — a `resolver`-role `runStageAgent` spawn (`veto-updater.ts`) applies the redirects to the affected artifacts. The prompt (built by `buildVetoUpdaterPrompt`) names each vetoed entry (id + original text/gap + redirect), embeds the current artifact content, instructs the agent to apply the redirects and scan for stale references, and names the report sidecar (`veto-updater.json` → `{ files_updated: [...] }`). The spawn follows the drafter's write + `openspec validate --strict` + retry-on-failure pattern (up to 2 attempts).
3. **Drift check** — if `files_updated` touches `specs/` or `tasks.md`, the runner invokes the existing drift-check resolver to reconcile `tasks.md`.
4. **Re-presentation** — `presentGateAt` re-materializes `assumptions.md` from the updated sidecar and writes `gate-<n+1>.md` with new artifact hashes, cost/duration, and `state.gate.mode` preserved (early → early, final → final). The outcome is `'veto'` with `version: n+1`.

`vetoRedirects(outcome)` (`gate.ts`) is the wiring point: it pulls the veto list from the gate outcome and feeds the updater. Repeated vetoes converge only when the human approves — each cycle produces a content-different `gate-<n+1>.md` because the updater rewrites the affected artifacts.

### Extend directive (`→ RUN 1 MORE`)

At an **early** cap-hit gate the human may write `→ RUN 1 MORE` on its own line. The runner bumps the effective round cap by 1, executes exactly one more review round, and re-presents the gate at `gate-<n+1>.md`. This is **Shape B — extend-and-re-cap**: one decision binds one round of spend; repeated extends require writing the directive again at each successive gate. The directive is rejected at a final gate (post-convergence there is nothing to extend) and only the literal `→ RUN 1 MORE` is accepted — `→ RUN 2 MORE`, `→ RUN MORE`, etc. are rejected with an error naming the line, leaving room for future parameterization without silently accepting typos.

**State** — a new optional `state.roundCap` field defaults to `ROUND_CAPS[depth]` and is bumped by each extend:

```
state.depth     classification (S/M/L) — set once at intake, never mutates
state.roundCap  current ceiling       — starts at ROUND_CAPS[depth], grows on extend
```

The depth profile and the cap are distinct: an M-profile run that extends three times has `state.depth = 'M'` and `state.roundCap = 6`. The depth governs lens escalation (`M gains skeptic when blockers remain after round 2`); the cap only bounds the loop. Overloading `depth` would conflate a classification with a counter and silently change the lens mix.

**Carry-forward** — the extended round reads `resolutions-<state.round>.json` as its prior ledger via the existing `readResolutionsLedger` sidecar mechanics, so already-resolved findings stay resolved. The runner re-enters the review loop at `state.round + 1` with the bumped cap (`runReviewLoop({ startRound, cap })`); rounds already executed are never re-run, so `events.ndjson` and the trajectory block stay append-only.

**Worked example** — an M-profile run cap-hits at round 3:

```
gate-1.md  trajectory: round 1 · round 2 · round 3            (cap = 3)
           ↓ human writes → RUN 1 MORE
gate-2.md  trajectory: round 1 · round 2 · round 3 · round 4  (cap = 4, still cap-hit)
           ↓ human writes → RUN 1 MORE
gate-3.md  trajectory: round 1 · … · round 5                  (cap = 5, converged → final gate)
```

Each extend appends exactly one trajectory row and bumps the cap by 1. When an extended round converges, the run flows into decompose → atomicity → final gate at the same `gate-<n+1>.md` version, exactly as a fresh `runPostReviewToGate` would. The `runGateResume` outcome is `'extend'` with `version: n+1` and the new `gateMdPath`, distinguishing "we ran another round" from approve/veto/abort for the CLI and event log.

### Nitpicks at the final gate

When the loop converges with surviving nitpicks (≤3 NITPICK findings), the final gate lists them under `### Nitpicks (informational)` as plain bullets (gap + resolver outcome). No checkboxes — they are informational only, not a veto surface.

## Commands

```bash
bun run sdd-runner:start -- [<task-file> | <run-id>] [--depth S|M|L] [--pr] [--reopen [<n>]] [--config <path>]
bun run sdd-runner:start -- stop [<run-id>]

# after `bun link` inside sdd-runner/ — the form the runner's own hints print
sdd [<task-file> | <run-id>] [flags]
sdd stop [<run-id>]
```

The `sdd` name comes from the package's `bin` entry (`sdd-runner/package.json` → `src/index.ts`, which carries the `#!/usr/bin/env bun` shebang the link needs). The `/sdd:auto` command wrapper documents the same flag inventory, pinned against `parseSddArgs` by a test so the prose cannot drift from the parser again.

One routing verb: an existing task-file path starts a run; an exact run id or unambiguous prefix routes by the run's state (gate-pending → decision flow, interrupted/stopped → resume, completed → report). With no target on a terminal, a sole pending gate or sole interrupted run routes directly (the obvious next step), while a sole completed run opens the **session screen** — its report is passive output, one Enter away, and creation stays reachable instead of being stranded behind a dump; any other ambiguity also opens the **session screen** (`tui-session-picker.ts` — every run as one selectable framed row: name, stage `r<round>/<cap>`, token/cost totals (cost tokens: known cyan, `cost ?` dimmed), last activity, pending decision; Enter routes by state, `s` stops an active row through the liveness-aware stop seam (live → calm-stop marker, dead → immediate settle), `r` re-opens the hovered settled gate then enters its session, `n` opens the inline creation form, `q` quits writing nothing) and zero runs goes straight to the creation form. The session screen rides the footer/help-overlay chrome per sub-screen — the list's footer lists only the hovered row's active bindings and `?` opens the overlay on the list. **Deletion** (`remove-run.ts`): `d` on a deletable row (persisted terminal or stopped) enters a confirmation naming the session — change name and run id, what is lost, `y` deletes permanently, any other key cancels back to the list with the cursor preserved (`?` cancels like any other key: the confirmation is an any-key surface and is never composed with the overlay); `d` on a running row is an immediate refusal notice instead. The guard never trusts the rendered row: at delete time (after `y`) it re-reads `state.json` and refuses anything whose persisted status is running (gate-pending and stop-requested included) or whose run dir has a live owner (`holder.json` + `kill(pid, 0)`), both pointing at calm-stop first; otherwise the run directory and nothing else is hard-deleted. The screen is a **loop, not a launcher**: every completed action — a settled gate, a finished run, a displayed report, a requested stop, a finished or cancelled creation, a settled deletion or its refusal — re-presents the screen with rows re-read from storage, and a run that took over the terminal returns to it when its surface finishes; an action that fails surfaces a notice (any key returns — the ack shell, framed like every panel with its any-key footer and exempt from the overlay: `?` acks) instead of exiting, and only an explicit quit ends the process. Reports render inside the shell as a static block (no pager — terminals scroll) followed by the any-key return. Without a terminal the sole routable run (pending gate first, then interrupted, then completed) routes directly and ambiguity keeps the loud contract — every candidate listed with the concrete `sdd <run-id>` command that selects it, exit without side effects. Screen decisions execute through the same orchestrator entries as explicit ids (`session-flow.ts`); no new pipeline verbs exist behind it.

Sessions are named for humans: a new run's id is the slugified change name (`runs/<slug>/`; lowercase `[a-z0-9-]`, 64-char clamp; `allocateSessionId` refuses while a non-terminal twin holds the name and otherwise takes the next free `<slug>-2`), while legacy datetime-named run dirs stay fully addressable by prefix; deleting a run removes its directory entirely, so the freed bare slug is allocatable by a later session. Inline creation is a form inside the session screen (`session-create-form.ts`: a title field and an optional description field — Tab/up/down switch focus, Enter submits, Esc cancels back to the list with the cursor preserved; the form is permanently a text-entry context, so `?` is always inserted as literal input text and never opens the help overlay, while its bindings ride the footer; submitting with an empty title is inline validation — the form shows a notice and stays open — never an exit). The composed title plus description becomes the task text — the first line names the session via the heading-derived change name, the full text persists inside the run dir as `task.md`, and no task file in the repo is required. One exception, for pasted documents: a description that itself opens with an H1 becomes the task text verbatim (prepending the typed title would give it two H1s) and its own heading names the session; a paste lands in the description buffer as one input chunk, so its embedded newlines survive where a typed Return would submit. A submitted form starts the run exactly as a task-file start, and when its turn on the terminal ends the screen re-presents per its loop; a failed start is a notice, not an exit. The old readline creation prompt (and its stdin-restore seam) is deleted — creation never leaves the Ink surface. Explicit task-file starts behave exactly as before.

`sdd stop [<id>]` is liveness-aware: a process driving a run records itself in `runs/<id>/holder.json` (pid + start time, written before stage work, removed on every exit path — only a hard process death leaves it behind), and stop checks it. A live owner gets the calm-stop marker, honored at the next stage or round boundary, leaving the run resumable; a dead owner (no holder, or a holder whose pid is gone — every pre-holder legacy run qualifies) settles immediately instead: a run that died mid-pipeline records `stopped` (resumable exactly like a live calm stop), a run that died before intake classification (`depth: null`, nothing to resume) records `aborted`, and a stale stop marker is consumed so a later resume is clean. Gate-pending and non-running runs are honest no-ops. The session screen's `s` key routes through the same seam and prints the same outcome line. Several active runs without an id fail listing them. `--depth` is the only run-shaping start flag; `--config` overrides the config path (else `SDD_RUNNER_CONFIG`); `--pr` flavors a completed run's report; `--reopen [<n>]` re-presents a settled auto-decided gate (latest when `n` is omitted) and refuses while a gate is pending. The removed subcommand shapes (`start`/`resume`/`gate`/`continue`/`report`/`audit`/`watch`) and decision flags (`--confirm-all`/`--extend`/`--veto`/`--abort`/`--wait-deadline`/`--no-wait`/`--autonomy`) fail with an error naming the replacement; the non-interactive decision path is the hand-edited `gate-<n>.md`.

## Live rendering

Two surfaces, picked once at startup (`wireLiveView` over `render-mode.ts`): the **Ink TUI** only when a live terminal owns both stdio streams and neither `CI` nor `TERM=dumb` overrides it; everything else — pipes, redirects, CI — gets the append-only **LineRenderer** (`renderer.ts`, the CI / log-file contract; the TTY check is hard-gated so a redirect never gets ANSI escapes). `SDD_DEBUG=1` raises the line renderer's altitude (L0 tool-call/step lines) but never forces the TUI. The choice is exclusive per process: in TUI mode the LineRenderer is not subscribed to the event bus, and every route that drives stages (task-file start, state-routed resume, continue, a gate-resume's post-decision tail — after the gate screen has closed) mounts the running screen (`tui-run-session.ts`); on attach it first re-folds the run's `events.ndjson` so a re-entered run opens at current state.

The TUI (`run-view.ts` + `tui-gate.ts`) holds no state of its own — it is a pure render of the fold layer (`foldSlots`/`foldFindings`/`ReplayFolder`). The running screen is split into an append-only history region and a live region: finalized rows (closed-round burndown rows, filed findings, done-agent rows, folded chronologically by `tui-history.ts` into `RunFold.history`, done rows keyed by agent label + spawn ordinal so a re-spawned label never collides) render in Ink's `Static` exactly once — later events never mutate or reorder them — while the live region keeps the pipeline stage map (joined to one line at 60+ columns, stacked one stage per line below that), one line per active/retrying agent carrying its current tool call, and a status line (round/cap, token totals, cost, elapsed) with the `q to stop` affordance. The view is disposable: after any unmount it re-folds from `events.ndjson` alone (`tui-restore.ts`), including a pending gate's presentation state. Calm-stop keys: `q` or the first Ctrl-C requests the calm stop (honored at the next boundary, the run records stopped-but-resumable); a second Ctrl-C exits 130 (`exitOnCtrlC: false`; the reducer in `tui-signals.ts` owns the key). While a gate deadline is armed the TUI shows the remaining time; the TUI decision write and the expiry waiter are first-writer-wins mutual-exclusive claimants of the gate (`gate-<n>.settle-claim`, the legacy `expiry-claim` counts as the waiter's) — the loser is rejected as already-settled and renders the settled state.

A shared presentation layer (`tui-tokens.ts`, `tui-panels.ts`, `tui-chrome.ts`, `tui-width.ts`) decorates every interactive screen without touching semantics. Semantic color tokens (`tui-tokens.ts`) color severity (blocker red+bold, material yellow, nitpick dim), stage status, cost state, and retry badges — decoration only, every distinction keeps its non-color marker, and `NO_COLOR`/colorless terminals resolve to a monochrome mode that omits the props entirely (structural equality is test-pinned). Panels share one frame style (`tui-panels.ts`) with display-width pad/truncate via `string-width`/`cli-truncate` — the single width authority for intra-line columns — and reflow by `joinOrStack` (side-by-side at or above the 60-column threshold, stacked below it); terminal width is reactive (`useTerminalWidth` over Ink's `useWindowSize`), so a resize reflows without a restart and never loses in-progress input buffers. Every screen composes `ScreenChrome` (`tui-chrome.ts`): a persistent key-hints footer listing only currently-active bindings plus a `?` help overlay rendered as an inset panel above the footer — while the overlay is open every key except its dismiss keys (`?`, Esc) is swallowed, so no decision or stop key fires through it.

## Gate decisions

On a terminal the gate is an Ink screen (`tui-gate.ts`): every assumption, open finding, and blocker listed with its evidence — framed panels in the shared style, item rows joined with their evidence at wide width and stacked below the join threshold — with blocker rows carrying the blocker severity token; checkbox toggles, text redirects and blocker answers collected in view; approve stays unavailable until the trajectory ack is affirmed and every blocker answered, naming the unmet condition; consequences render beside `(a)pprove`/`(e)xtend` (early gates only)/`(x)abort`; policy-prechecked items are read-only with their `decided-by` attribution. The gate screen rides the same footer/help-overlay chrome as every screen: `?` toggles the overlay (an open overlay swallows every key but its dismiss keys), and while a redirect or blocker input is open `?` is literal input text, never the toggle. The session settles through the same write-then-parse self-check as every other write path (`gate-answers.ts`) — abandoning writes nothing; identical key sequences produce identical gate files regardless of presentation state (color mode, overlay toggles, width — test-pinned). Without a TTY the hand-edited gate file is the decision path. The old clack/readline prompter front-ends are deleted.

## Config and autonomy

Five keys, single mode: `repoRoot`, `workDir`, `model`, `budget` (USD, default 5), `deadline` (minutes, optional). Everything else is rejected at load time naming the replacement (`autonomy`/`budgetUsd` → `budget`, `models` → `model`, `timeouts` → compiled constants). The ladder always evaluates and settles what it can (assist semantics): level ranks, the `rules` map, `permittedAt`, and the R2 auto-extend count bound are gone — the trajectory window and the R4 budget guard against the one `budget` key are the sole extension bounds. Audit records are unconditional: every presented gate gets its preview block, one `auto-policy.jsonl` line, and an event; undecidable gates additionally append the workdir-level `policy-debt.jsonl` entry.

The deterministic decision ladder (`sdd-runner/src/auto-policy.ts`, pure): **R1** converged-final-approve (0 open BLOCKER/MATERIAL/NITPICK + all surviving assumptions low-blast → auto-approve); **R2** trajectory auto-extend (cap-hit, 0 BLOCKERs, ≥1 open MATERIAL, strictly decreasing open findings over the last 2 rounds, projected spend under `budget` → auto-extend exactly one round reusing `runExtendRound`; the bound is persisted before the extended round spends); **R3** assumption blast-radius triage (low-blast iff all `evidence.files` recorded, inside the change folder/run dir, no spec delta, no `tasks.md` line; missing/empty/un-cross-checkable evidence fails closed to high-blast; the agent's `blast_radius` text is display-only; on a mixed gate R3 pre-checks the low-blast items with `decided-by: policy R3` and still presents the gate); **R4** budget guard (`costKnown === false` or projected exceedance against `budget` always gates); **R5** reversibility (leaving-the-branch actions are never auto-decided).

Never-cut invariants: an open BLOCKER always gates; budget/round-cap exceedance always gates; auto-decided gates still write `gate-<n>.md`, consume a version, and settle through the same `verifyGateIntegrity` path as human approvals; `events.ndjson` stays append-only and replay-sufficient (the L2 `auto_decision` event carries `{ rule, decision, evidenceDigest, gateVersion }` and folds into `ReplayState.autoDecisions`).

## Deadline

The config `deadline` key (minutes) arms `gateDeadlineAt` at presentation (bell/notification line; the process exits without blocking). The derived wait: a deadline is set and the context is non-TTY ⇒ the waiter runs. It polls `state.json` and the gate file each second without caching, settles stable hand edits through the normal path (content hash unchanged 3 consecutive ticks), translates landing steer directives, and at expiry claims the gate through the same first-writer-wins settle claim as the TUI, re-runs the ladder conservatively (by design: R1 approve, else R2 extend, else stay pending), and re-arms at most once — never auto-aborts. In practice the conservative branch never applies and every expiry stays pending, so an armed deadline is a notification plus one re-arm; see Known limitations.

## Reopen and steering

`sdd <run-id> --reopen [<n>]` re-presents a settled auto-decided gate at a fresh version as an unanswered digest (boxes unchecked, answered section cleared, fresh hashes sidecar), reverts a terminal `completed` status to the pre-settle stage state, clears deadline fields, and sets `state.gate` pending so the existing veto/abort resume mechanics apply. It refuses when a gate is already pending, the version is missing/never settled, or not the latest settled gate.

Queued steering: `runs/<id>/steer.md` accepts `extend`, `veto <id>=<redirect>`, `abort`, consumed at round boundaries (staged set persisted to `steer.staged.json` before the append-only rename to `steer.consumed.<n>.md`); unknown directives warn and skip; a steered `extend` re-reads the persisted round cap at the next boundary and never consumes `autoExtendsUsed`; staged aborts/vetoes take precedence over pending auto-settles.

## Write guard

Every stage spawn is bracketed by a `git status --porcelain` snapshot: any path newly dirtied outside the run's **own** change folder (`openspec/changes/<changeName>/`) fails the attempt with `DiffGuardViolationError` naming each violation (`working-tree-guard.ts`). The scope is the run's folder, not the whole `openspec/changes/` tree, so an agent cannot rewrite a *sibling* change's artifacts and have it read as in-bounds; a caller with no change name in hand falls back to the tree-wide prefix. Sidecars live under the gitignored `workDir`, so they never register as dirty.

## Durability artifacts

Every agent attempt gets a transcript at `runs/<id>/transcripts/<label>-r<round>-a<attempt>.jsonl` (review agents carry their round in the label, e.g. `resolver-r2`), and every spawn/done/killed appends a line to the run's session ledger `runs/<id>/sessions.jsonl` (`{label, role, round, attempt, model, opencodeSessionId|null, status, ts}`), written synchronously so a crash loses at most the in-flight line. Session resume reuses `opencode run --session <id>` continuations where the captured session exists, with a fresh prompt-rebuild spawn as the fallback. The completed-run report footer names both paths.

The decomposition plan data layer: `state.json` accepts optional additive `plan` (topo-ordered child ids + digest) and `children` (per-child `pending|running|done|failed` status records) fields — old files parse unchanged, and `deriveResumePoint` gains a parent branch that resumes at the next pending child in topo order ahead of the existing cascade. `sdd-runner/src/plan.ts` validates and topo-sorts a plan (`children.min(1)`, no upper bound) and materializes one `GENERATED by sdd-runner`-marked task file per child at `runs/<parent-runId>/children/<n>-<slug>.md` (1-based topo index).

## Composite runs

An oversize task takes a decomposed path end to end. At intake, the read-only estimator sidecar carries the verdict (`oversize: boolean`, undefined reads false) recorded in the `depth` event **before any scaffolding** — `driver.newChange` moves after the estimator in the single branch, so folder contents are identical and a failed estimator leaves nothing behind. An oversize verdict skips the scaffold entirely: the planner (`runPlanner`, role `planner`, `PlanSchema` sidecar at `sidecars/plan.json`) drafts a plan, and structural failures (duplicate ids / unknown deps / cycles from `validatePlan`/`topoSortChildren`) trigger exactly one replan pass with the validation error appended to the prompt (bounded by `PLAN_REPLAN_PASSES`), then a loud failure. `runPlanBranch` (`children.ts`) materializes the child task files, emits the `plan` event, records `state.plan` + seeds `state.children`, and presents the **plan gate** — one `C<n>` checkbox row per child in topo order, membership-routed by the parser like assumptions/findings; every C-box checked approves, an unchecked C-box vetoes that child with an optional `→ <redirect>`, `ABORT` aborts, and `→ RUN 1 MORE` is rejected (cap-hit only). The plan gate's prelude is **R4 only**: the budget guard runs with the per-child projection `spent + childCount × DEFAULT_ROUND_COST_USD` (plus the tree baseline), no rule can approve/extend/accept-items there, and the auto-settle/extend paths refuse plan mode loudly.

Approval drives `runChildren` (`children.ts`): a sequential walk of `state.plan.childIds` — one child in flight, skipping children already `done` — where each child is a nested `runStart` over its materialized task file. The loop emits `child_spawned { child, runId }` then `child_done { child, outcome, usage }` (usage aggregated from the child's own log), surfaces a gate-pending child's concrete `sdd <childRunId>` line and records it `running` (the operator settles the child's gate, then resumes the parent, which skips forward), and stops immediately on a child ending aborted/failed/stopped — `child_done 'failed'`, parent `stopped` with an operator line naming the blocking child (an unloadable child state counts as not-done, fail closed); when the operator later completes that failed child's run and the parent resumes, the flight is adopted as `done` and a fresh `child_done 'done'` with the full current usage supersedes the stale failure-time line. The parent marks `completed` exactly when every child reads `done`, and **never creates a change folder** — only children own one. The **tree budget ledger fails closed**: `treeSpend` = parent done-events + Σ per-flight `child_done.usage` (last `child_done` per spawn-to-spawn flight, so an outcome flip counts once while a retried child's new flight spends again) with `costKnown: false` when any usage is absent; the loop halts before each `child_spawned` on unknown-or-exceeded spend (parent `stopped`, loud line naming the budget guard), and the parent passes its committed spend as a `spendBaselineUsd` into each nested run so the child's R4 guard compares parent + prior children against the single budget. **Calm-stop is subtree-scoped**: while a child is in flight the parent watches its own marker and writes the *child's* stop marker on request; the child honors it at its next boundary, the parent consumes its own marker and settles through the shared stopped tail — both nodes resumable, completed children untouched. A plan-gate **veto round** (`settlePlanVeto`, `gate-resume-tail.ts`) re-runs the planner with the round's redirects, re-materializes wholesale, emits a fresh `plan` event (the replay fold resets `children`), and re-presents at `gate-<n+1>.md` with the policy ladder skipped — rounds repeat until approve or ABORT, the only terminals. Parent resume intercepts plan-carrying states before the single-run resume flow and re-drives `runChildren`.

**Tree-aware routing (6.1).** Discovery of the deepest gate-pending descendant lives in one place: `descendantGateOf` (`run-index.ts`) reads a parent's persisted `children` records, resolves each `running` child's concrete runId from the parent log's last `child_spawned` line (`lastSpawnedHandleOf` — the append-only log stays the only source of flight ids), loads the child's `state.json`, recurses into grandchildren (deepest first), and tolerates failure the same way everywhere — an unloadable child state or a spawn line without a runId is no pending gate, so the parent falls back to a plain resume; a visited-set guards malformed cyclic state. `continue` and the routing verb consult this resolver through `pendingDescendantGateOf` (`resume-flow.ts`) after the run's own gate: a plan parent whose next action lives inside a descendant routes into that child's gate decision flow (`runGateResume`) with the child's concrete `sdd <childRunId>` line, while a null result falls through to the unchanged `runResume` → `runChildren` skip-forward; `runResume`'s plan-parent `gate-pending` result threads `childRunId` so every caller can route. Discovery surfaces show the same tree: `continue`'s multi-pending listing prints each run's mode beside its version (`gate <mode> v<n>`, matching the sole-candidate hint), and `routeByState` plus both sole-candidate paths (`cli-routing.ts`) route a gate-null parent to `{ kind: 'gate', runId: <childRunId> }` instead of a blind resume. Child runs are ordinary top-level dirs under `runs/`, so `resolveRunId`'s exact/prefix/ambiguous semantics were already tree-total and are pinned, not changed — a tree-member prefix ambiguity still fails loudly listing every candidate.

**Decompose-split re-entry (7.1).** The decomposer report gained an optional `needs_split: boolean` (undefined reads false; old sidecars parse unchanged) whose prompt contract scopes a `needs_split: true` report's `tasks.md` to the **first slice only** — child #1 of the split. The shared post-convergence tail diverts on that verdict **between decompose and atomicity** (`post-review-tail.ts`): no atomicity spawn, no final gate — "before any further stage spend" is literal. The diversion re-enters through the landed `runPlanner` over a composed task text (the original task from the run's `task.md`, the existing change name pinned as child #1, a drafted-artifact summary via `readChangeDigest`, and the re-scoped first-slice-only `tasks.md`), deterministically pins `changeName` on the first planned child, and rewrites the promoted `sidecars/plan.json` so the durable sidecar carries the pin; the landed `runPlanBranch` then performs the conversion itself (`state.plan`/`children` seeding, `plan` event, plan-gate presentation with the R4-only prelude) — the plan gate is the backstop: the operator sees child #1 (the existing change) plus the partitioning siblings and can ABORT before any further spend. The `changeName`-carrying child then gets a **continuation start** (`runContinuationStart`, `plan-resume.ts`): a nested run that skips intake/draft/review (no `newChange` collision with the existing folder, no re-draft of reviewed artifacts), inherits the parent's depth (derived from the child task file's `children/` dir, loud when the parent state is unloadable), and enters the shared tail at atomicity (`runTailFromAtomicity` — the extracted back half), presenting its final gate over the adopted-review surrogate (`PLAN_REVIEW_SURROGATE`) with its own task progress and costs. The session-id allocator gives the child run the next free `<slug>-<n>` (the parent holds the bare slug while non-terminal) while `state.changeName` keeps pointing at the existing folder; the ledger stays undoubled because draft/review spend is booked in the parent's log only and the child's log carries its own tail spend.

**Live and report tree visibility (8.1–8.2).** The LineRenderer renders the three tree-event L2 lines on composite runs — `plan: <n> children (<digest>)`, `child <id> spawned (run <runId>)` (the run part drops on legacy spawn lines without a runId), `child <id> <outcome>` — the only permitted non-TTY additions under the frozen byte contract; single-change runs never emit the events, and the single-run stream is pinned byte-identical. The Ink running screen gains a framed `Children` panel (the shared panel style, after `Agents`) from the `ReplayState.children` fold — one `<child-id> <status>` line per entry, the first non-pending/non-done child (the in-flight or failed node) marked with the `▶` the pipeline map uses, the panel omitted entirely when the fold is empty so single-run screens are unchanged. A parent's report (`state.plan` present) renders a **children section** instead of `### Tasks` — the parent owns no change folder or task list to count: one `- <id> · run <latestSpawnRunId> · <status> · <cost>` row per planned child (status from the live child `state.json`, falling back to the parent's `children` record when unloadable; never-spawned children drop the run part), per-child cost via `childUsageOf` (already subtree-shaped), and a `subtree total:` row from `treeSpend` over the parent's repriced events; unknown/unpriced cost renders the established `unknown` marker — fail-closed display, never `$0.00`. Single-run reports are pinned byte-identical.

**Plan-gate TUI decidability (8.3).** The plan gate is decidable from the interactive TUI: child `C<n>` rows ride the same generic checkbox machinery as assumptions (toggle = checked; unchecked = veto with an optional inline redirect collected beneath the row; settle with every child checked approves, an unchecked child vetoes carrying the redirect; `e` is refused — extend is early-only), with no plan-specific affordances beyond the rows themselves. The write-then-parse self-check parses against the **shared** children-aware expected content (`expectedGateContentOf`, `gate-session.ts` — the TUI's former children-blind local duplicate is deleted), so the file grammar the TUI writes is exactly the grammar the parser accepts.

## Known limitations

Everything below is known, reproduced, and deliberately unaddressed. The shared blocker is measurement: no completed run's `events.ndjson` exists in this repo, so the *magnitude* of each item — how many events a real run emits, what a round actually costs, which model tier the work wants — is unmeasured. Figures quoted here come from synthetic benchmarks over `appendEvent`/`readEvents`, not from an observed run. Each entry names the observation that would justify changing it.

**Appending an event is O(n) in the log, so a run is O(n²).** `nextSeq` (`events.ts`) re-reads and splits the whole NDJSON file on every `appendEvent` to derive the next sequence number. Synthetic append benchmark, one L0 `tool_use` event per iteration:

| events | total   | per event | share in `nextSeq` |
| -----: | ------: | --------: | -----------------: |
|    500 |   48 ms |   0.10 ms |                64% |
|   2000 |  315 ms |   0.16 ms |                91% |
|   8000 | 4114 ms |   0.51 ms |                96% |

One representative run on a 4-vCPU container; the wall figures move by tens of percent run to run, the `nextSeq` share does not.

`buildBus` (`gate-digest.ts`) subscribes both `appendEvent` and the live renderer to one bus, so the cost lands on the render thread. It is invisible at a few hundred events and dominant past a few thousand. What makes a fix cheap is that `seq` is **write-only** — stamped, schema-validated (`StampShape`, `event-schemas.ts`), persisted, and never read for behavior. `replay.ts:144` parses it into `AutoDecisionRecord.seq`, and that record's sole consumer (`watch-view.ts:81`) renders rule/decision/gate-version without it. Nothing sorts by `seq`. **Revisit when** a real run's log passes ~2000 events.

**Reading the log is not the cost; reading it four times is a type lie.** One gate presentation calls `readEvents` from `gate.ts:196`, `gate.ts:251`, `gate-prelude.ts:116` and `gate-signals.ts:30`, each re-parsing the whole file. Measured at ~15 ms per call over an 8000-event / 1.1 MB log — roughly 60 ms per gate, which is noise. The real cost is coherence: four independent reads of an append-only file can disagree if it grows between them. **Revisit** only alongside the `nextSeq` work; alone it does not pay for itself.

**One malformed line makes a run unrecoverable.** `readEvents` throws on the first line failing `JSON.parse` or `SddEventSchema`, and no call site guards it — not `tui-restore.ts:16`, not `replay.ts:157`, not `report.ts:211`, not the gate path. A torn final line (ENOSPC mid-write, power loss) therefore breaks gate presentation, resume, report and TUI restore at once, leaving hand-editing the NDJSON as the only recovery. This has never been observed: `appendFileSync` of a sub-KB line to an `O_APPEND` file rarely tears. The exposure is asymmetric — low probability, total loss — and the remedy (tolerate a trailing partial line, still fail on an interior one) is small. **Revisit** on the first observed occurrence, or sooner if that trade reads badly.

**`modelFor` ignores its role.** `modelFor(config, _role)` (`config.ts:123`) returns `config.model` for all eight `AgentRole` values; the parameter marks the seam rather than selecting on it. Every agent — drafter, reviewer, resolver, estimator, planner — runs the one configured model. A cheap tier for the mechanical roles is the obvious lever once a run proves expensive, and the seam is already where it would go. **Revisit when** a measured run shows the aggregate cost and which roles carry it.

**`budget` is a boundary check, not a limit.** Spend is compared against `config.budget` at exactly two points: the R4 rung when a gate is *presented* (`auto-policy.ts:166`), and before each `child_spawned` in a composite run (`children.ts:169`). Nothing checks inside a review round. A run crossing the ceiling mid-round therefore finishes that round plus every remaining round up to its cap before the cap-hit gate can act — at most `ROUND_CAPS[depth] - 1` further rounds (`review-model.ts:13`: 3 on L, 2 on M, 0 on S). Bounded and modest against the runner's own `DEFAULT_ROUND_COST_USD` projection of $0.50/round, but real. **Revisit when** an observed run overshoots by an amount that matters.

**The budget default is uncoupled from the model price.** One ceiling (`budget`, default 5) governs runs whose configured models differ by an order of magnitude in price: `config.json` pairs `zai-coding-plan/glm-5.3` with `budget: 10`, `config.example.json` pairs `anthropic/claude-opus-4-1` with `budget: 5`. No relation between the two is expressed or checked, and no defensible default can be picked before a run is measured. **Revisit when** a measured run gives a per-round cost per model tier.

**An unreachable pricing DB silently disables the autonomy ladder.** `loadDb` (`pricing.ts:187`) swallows every fetch/parse failure and answers `{}` when no cache exists, so `resolveCost` returns `null` for every model, `costKnown` goes false, and `r4FailsClosed` — a never-cut pre-check ahead of R1/R2/R3 — gates unconditionally. Net effect on a host that cannot reach `models.dev`: no gate is ever auto-decided, the ladder is inert, and every run waits for a human. Reproducible in any network-isolated container. Failing closed is the right direction, but the `unknown` marker (`gate-render.ts:36`) is emitted both when pricing is unreachable and when agents genuinely reported no usage, so an operator cannot tell an inert ladder from a free run. **Revisit** by separating those two causes in the marker; that is the whole fix.

**A gate deadline never auto-settles.** `conservativeBranchApplies` (`deadline-waiter.ts:265`) re-runs the ladder at expiry with a synthetic signals object hardcoding `costKnown: false`. Since R4 fail-closed precedes R1/R2, the ladder always answers `gate`, so the predicate always returns false: an expired deadline re-arms once and then leaves the gate pending indefinitely, never approving or extending. Relatedly, `deadlineExpired` is never set `true` anywhere in `src/` (`gate-prelude.ts:66,102` hardcode `false`), so its one reader — R3 suppression at expiry, `auto-policy.ts:222` — is unreachable as well. Both halves are covered by green tests that never meet: `auto-policy.test.ts` exercises the ladder through a helper defaulting `costKnown: true`, while `deadline-waiter.test.ts:142` injects the branch predicate directly instead of calling the real one. The behavior is safe — pending is the conservative outcome — but it is not the behavior the ladder was written for. **Revisit when** the auto-settle half is actually wanted; until then treat `deadline` as a notification plus one re-arm.
