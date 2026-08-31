# Design — sdd-runner-simplify

## Context

See `proposal.md` for motivation. The constraints that shape this design:

- **The pure state layer already exists.** `foldSlots`/`foldFindings` (`watch-view.ts`), `ReplayFolder` (`replay.ts`), `renderPipelineMap` (`renderer.ts`), and `deriveResumePoint` (`run-state.ts`) are written and tested. The Ink component layer (`WatchView`) renders them but is wired to a stub loop that feeds it an empty state once. The gate session's decision logic (`gate-session.ts`, `gate-answers.ts`) is front-end-agnostic: it collects answers and writes `gate-<n>.md` through a write-then-parse self-check.
- **Agents are spawned stateless today.** `attemptRun` (`review-loop/src/agent-runner.ts:152`) invokes `opencode run` bare; the line handler (`line-handler.ts:148`) already appends every raw JSON event line to a per-spawn log but discards the `sessionID` each line carries.
- **Session resumption is verified, not assumed.** Spike on the installed binary (2026-08-19): `opencode run --help` documents `-s, --session <id>` ("session id to continue"), `--fork`, and `--title`; and a live `opencode run --format json` invocation emitted `"sessionID":"ses_…"` on the first `step_start` line of the stream. Capture = lift one field from a line we already parse; resume = one flag on a command we already build.
- **`events.ndjson` is replay-sufficient** (three altitudes, append-only) — the property the TUI and crash-resume both lean on.
- No DB, no papai runtime: all state is files under `<workDir>/runs/<id>/`. Scope-model impact: none (local developer tooling).

## Goals / Non-Goals

**Goals:**

- One interactive surface (Ink TUI) that displays run state and collects gate decisions, backed by the existing fold/replay layer, writing only files that already have a grammar.
- Exact-state agent resume after interruption via opencode session ids, with graceful degradation to today's stage-boundary resume when a session cannot be continued.
- Config a newcomer can write from memory (5 keys) and a CLI with one routing verb.

**Non-Goals:**

- In-TUI **mid-run steering keys** (`e` extend / `a` abort while a round is live). `steer.md` stays the only steering surface; TUI v1 has no decision keys on the running screen. (Gate-pending screen decisions are not steering — they are the gate.)
- Re-architecting pipeline stages, review-loop semantics, or sidecar formats.
- Touching review-loop's own CLI/config; only the shared `agent-runner.ts` seam changes.
- Session *forking* or branching agent runs (`--fork` is available but unwanted: a resumed spawn must continue the same context, not diverge from it).
- Backward-compatible parsing of removed config keys/flags — the new schema rejects them loudly.

## Decisions

### D1 — Session capture: lift `sessionID` from the event stream; never query

`sessions.jsonl` (one line per spawn attempt: `{label, role, round, attempt, model, opencodeSessionId, promptHash, status: spawned|done|killed}`) is appended by the line handler the moment the first `sessionID`-bearing line arrives — before the agent does any meaningful work, so a crash mid-agent still leaves the id on disk.

Alternatives rejected: post-hoc `opencode session list --format json` lookup (racy with concurrent spawns — reviewer, skeptic, resolver can interleave); `--title` correlation (same race, plus title collisions). The field is already in every line of a stream we already parse; lifting it is one accessor.

### D2 — Resume policy: artifact-first, session-second, rebuild-last

On `sdd <id>` of an interrupted run:

1. `deriveResumePoint` as today — if the interrupted stage's artifact is complete, continue past it (no agent touched).
2. If an agent was in-flight (`sessions.jsonl` last line for that stage is `status: spawned|killed` with no artifact), re-spawn `opencode run --session <id> --auto --format json --model <m> "continue"` — exact context restored at marginal token cost.
3. If the session id is missing (pre-change runs) or continuation fails (session pruned, provider error), fall back to today's prompt-rebuild re-spawn at the stage boundary. **Never worse than today**; the fallback is also the migration path for existing runs.

Prompt-rebuild machinery (sidecar ledgers, carry-forward) is not deleted: it remains the mechanism for *fresh* rounds — a new review round is a new spawn by design, not a continuation.

### D3 — One view: Ink TUI as a disposable front-end over the fold layer

Single process: orchestrator and Ink share one event loop; the orchestrator's `emit` bus feeds the same fold functions `watch` uses, and the folded state drives the components. The TUI holds no state of its own that matters: closing the terminal and running `sdd <id>` again replays `events.ndjson` into the identical screen. `DynamicRenderer` (~260 lines of hand-rolled ANSI) and the clack/readline prompter stack are deleted; `LineRenderer` stays byte-identical for pipes/CI.

Detection: TUI iff `stdout.isTTY && stdin.isTTY && !process.env.CI && TERM !== 'dumb'`; anything else → LineRenderer. `--verbosity` flags are cut; `SDD_DEBUG=1` env raises altitude for line mode.

**Risk note:** the Ink path has never rendered live under Bun (the stub proved import-ability, not sustained rendering). The first implementation task is a walking skeleton (Ink + orchestrator + one fold) before any component polish.

### D4 — The TUI writes files, never a fourth grammar

Every TUI decision maps to the existing file protocol:

| TUI action | Written artifact | Engine |
|---|---|---|
| assumption/finding checkbox, blocker answer, `OVERRIDE` | `gate-<n>.md` | `gate-answers.ts` (write-then-parse self-check) |
| approve / extend / abort | `gate-<n>.md` `### Decisions` block | same, via `decisionConsequences` |
| redirect / answer text entry | `gate-<n>.md` field grammar | same |
| stop request | stop seam (D6), not a file | orchestrator flag |

Gate-pending screen keeps `(a) approve · (e) extend · (x) abort` with consequences rendered beside each — this is the gate decision menu, one copy source with the file grammar. Approve stays blocked until T1 affirmed and every blocker answered (constraint lives in the decision logic the TUI calls, not in the components).

### D5 — Text input: Ink TextInput

Veto redirects and blocker answers use Ink's TextInput component (in-TUI, single-line). `$EDITOR` spawn rejected: newcomers don't have one configured, escape/quit mid-edit is a new failure mode, and TextInput keeps the whole decision in one process where the write-then-parse self-check can guard it.

### D6 — Signals: calm stop, then hard exit

`q` and the first `Ctrl-C` request a calm stop: the orchestrator gets a stop flag (same shape as review-loop's `stop-controller`) honored at the next round/stage boundary — in-flight agents run to completion, artifacts and `events.ndjson` stay consistent, run status records `stopped`, and `sdd <id>` resumes later. Second `Ctrl-C` hard-exits 130 (review-loop precedent). `SIGHUP`/terminal loss kills the run; D2 resume covers it — the TUI being disposable is the point. `sdd stop [id]` is the same calm-stop seam from another process (sets a `stop-requested` marker file the runner checks at boundaries; a marker beats signals because it survives process boundaries and works on the run you meant, not the one wired to your terminal).

### D7 — Config: five keys, strict schema

```json
{ "repoRoot": "..", "workDir": ".sdd-runner", "model": "…", "budget": 5, "deadline": 90 }
```

`budget` (USD, default 5) replaces `budgetUsd ⊕ autonomy.costCeilingUsd` (was `min()` of two) and becomes the bound the policy ladder checks (R2 projected-spend, R4 guard). `deadline` (minutes, optional) replaces `deadlineMinutes`/`--auto-deadline`; the waiter is derived (deadline set + non-TTY ⇒ wait). `timeouts` become compiled constants (30 min wall / 10 min inactivity) — no user has ever changed them in this repo. Schema parses `.strict()`: removed keys (`autonomy`, `models`, `timeouts`, `budgetUsd`) fail with the offending key named, not silently dropped (Zod's default strip would turn a stale config into a quiet behavior change). `state.json` parsing stays lenient (`.strip()`-equivalent): old runs must keep resuming; new `stopped` status and `sessions.jsonl` are additive.

**Autonomy collapse semantics (code-verified).** Every ladder rule is permitted at `assist`, and `auto` adds only the deadline mechanism (`permittedAt` fields in `auto-policy.ts`; `planGatePresentation` in `gate-prelude.ts`). Single mode therefore adopts exactly the `assist` semantics: the ladder always evaluates and auto-settles every gate it can decide; undecidable gates present. The `observe`-mode artifacts (`auto-policy.jsonl`, preview block, policy-debt ledger) remain and stop being level-conditional — they are the unconditional audit trail of every gate. R2 loses its count bound (`autoExtendsUsed < autoExtendMax`, cut with `autonomy.autoExtendMax`): eligibility is the strictly-decreasing open-findings window (k=2) plus R4's projected-spend guard under `budget`, so a non-converging loop cannot extend forever — each extension must be earned by an improving trajectory with projected spend under the ceiling. The `autoExtendsUsed` state field dies with the bound.

### D8 — CLI: one routing verb

`sdd [<target>]` resolution order: `--help`/flags → target is a task-file path that exists (start new run; `--depth` allowed here only) → exact run id → unambiguous prefix → single gate-pending run → single interrupted run (`interrupted` includes calmly stopped) → single completed run (prints report; `--pr`) → several candidates: list them with the command to pick. `sdd stop [id]`, `--config <path>` (env `SDD_RUNNER_CONFIG` still honored), `--reopen [<n>]` (defaults to latest settled gate). Prefixes stay an interactive convenience; scripts use full ids.

### D9 — Transcripts promoted to first-class

Per-spawn raw event logs move from `<sidecarDir>/logs/<label>-r<round>.log` to `runs/<id>/transcripts/<label>-r<round>-a<attempt>.jsonl`, named to correlate with `sessions.jsonl` (same label/round/attempt key). Content unchanged (raw opencode JSON lines); the rename is discoverability — debugging an agent means finding its transcript next to its session record. Line handler append path is unchanged except the destination. Discoverability does not stop at layout: the output for a completed run (the report the routing verb prints) lists `transcripts/` and `sessions.jsonl` in its footer, so an investigator reaches the raw evidence without prior knowledge of the run directory.

### D10 — Deadline × TUI: single-writer claim on the gate file

At deadline expiry the existing waiter claims via its exclusive-create marker and settles conservatively. With the TUI open, expiry can fire while the operator is mid-answer on a veto. The two writers are mutually exclusive: whichever writes the gate file first wins; the loser's write is rejected with a "gate already settled" notice, and the TUI re-reads and renders the settled state. The TUI displays the countdown while a deadline is armed. No new locking — the existing exclusive-create marker is the seam both writers pass through.

## Risks / Trade-offs

- [opencode session storage is outside our control (pruned, version-migrated, path-moved)] → D2's fallback chain: session-resume failure degrades to prompt-rebuild re-spawn, which is exactly today's behavior. The `sessions.jsonl` record plus `status` lets the runner *report* which path a resume took.
- [Ink-under-Bun sustained rendering unproven] → walking-skeleton task first; `ink-testing-library` (already a devDep) drives component tests; LineRenderer remains the CI contract, so a TUI regression can never redden a pipeline.
- [Session resume re-sends full context → token cost] → resumed spend flows through the existing usage accounting and `budget` guard unchanged; a resume that would blow the budget gates exactly like a fresh round.
- [`.strict()` config breaks stale configs on upgrade] → intended and loud; error names the removed key. One-time local edit, documented in the change's tasks.
- [Terminal resize / tiny terminals] → components re-derive layout from `process.stdout.columns` per frame (the fold layer is width-agnostic); degrade to stacked regions under 60 cols.
- [Cut flags remove a scripted CI decision path (`--confirm-all` etc.)] → the hand-edited gate file is the documented CI path and is byte-identical to today's power path; CI scripts change from flags to a here-doc file write.

## Migration Plan

Order chosen so every step is shippable alone:

1. **Session capture (additive)** — `sessions.jsonl` + transcript relocation in `agent-runner.ts`/line handler. Old runs unaffected; new runs record ids without using them.
2. **Session resume behind the existing verbs** — `deriveResumePoint` consults `sessions.jsonl`; fallback = current behavior. Verifiable independently of the TUI.
3. **Ink TUI** — walking skeleton, then running screen (folds + slots + burndown), then gate screen (decision logic extracted from `gate-session.ts` behind the file-writing seam), then stop seam + `sdd stop`.
4. **Flag/config cutover (BREAKING)** — new `sdd` routing verb, `.strict()` five-key config, old verbs and the `autonomy` block removed, `@clack/prompts` dropped from deps, `docs/architecture/sdd-pipeline.md` rewritten (Commands, Live rendering, Autonomy, deadline, watch sections), `shared-tui-renderer` change re-scoped (sdd-runner consumes format helpers only).

Rollback: steps 1–3 are additive/coexisting (old verbs keep working until step 4); step 4 is one commit to revert.

## Hook / TDD interactions

The Write/Edit TDD resolver treats `sdd-runner/src/**` and `review-loop/src/**` as gateable, mapped to `tests/sdd-runner/**` / `tests/review-loop/**`. Test-first order of work: fold/pure-function extensions (resume point + sessions ledger) → session capture seam → resume decision table → TUI components via `ink-testing-library` (fixtures from folded event sequences) → routing table → `.strict()` schema rejection tests → cutover. Final task: full `bun test`, `bun run typecheck`, `bun run lint`, docs rewrite.

## Open Questions

None blocking — session resumption was spiked (evidence in Context), and remaining unknowns (Ink resize edge cases, session retention horizon) are covered by the fallback and degradation paths above.
