<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0289: Review-Loop Live Progress Reporting

## Status

Implemented (with divergence)

## Date

2026-07-15

## Context

A `review-loop` run can take 10-30 minutes. During each `opencode run` agent turn (reviewer / matcher / fixer / fixer-retry) the terminal showed nothing useful between the one scrolling phase line that preceded it and the result that followed it. An observer saw a single stale status for the entire duration of a turn, with no indication of what the agent was doing, which tool it was running, or whether it was stuck.

The root cause was buffered spawning: `agent-runner.ts` ran `opencode run` through `execFile`, which buffers the entire stdout/stderr and only resolves when the process exits. The buffered output was appended to `agent-output.log` only after the run completed. There was no streaming, no heartbeat, and no elapsed timer; the `ProgressLog` interface was a single `{ log(message): void }` wired to `console.log`. The build check (a shell command, not an agent) was equally silent.

The enabler is `opencode run --format json`, which streams real-time NDJSON events to stdout — `step_start` (timestamp), `tool_use` (`part.tool`, `part.state.status`, `part.state.input`), `text`, and `step_finish` (`reason`, `tokens`, `cost`). This event stream is the source of all live progress. The design (`docs/superpowers/specs/2026-07-15-review-loop-live-progress-design.md`) and plan (`docs/superpowers/plans/2026-07-15-review-loop-live-progress.md`) chose a **hybrid rendering** approach: keep the existing scrolling phase lines and add a single in-place live line per agent that refreshes as events stream, with raw NDJSON streamed to `agent-output.log` as it flows (replacing the post-mortem append).

## Decision Drivers

- **Show what the agent is doing, live.** During every agent turn an observer must see the agent label, current tool + one key argument, elapsed time, and tool count — refreshing in place, so a 5-minute `bash` is visibly progressing, not silently hung.
- **Preserve the existing transcript and scrolling phase lines.** Round/issue/fix boundary lines must keep scrolling; the full raw event stream must still land in `agent-output.log`.
- **Zero new runtime dependencies.** Pure ANSI/`child_process` only; no TUI library.
- **Keep the DI-first test pattern intact.** The spawn seam gains an optional per-line callback so existing fakes (which ignore it) keep working; no `mock.module`.
- **Capture-safe in non-TTY.** Piped / CI output must never emit ANSI or interval writes that desync the cursor; degrade to scrolling-only.
- **Build checks are not silent either.** The build check can also stall for minutes; it needs a live phase too, even though it has no event stream.
- **Make a hang visible.** The ticking elapsed timer is the prerequisite for noticing a stuck process; an actual kill/timeout is an explicit follow-up.

## Considered Options

### Option 1 — Hybrid rendering: scrolling phase lines + one in-place live line per agent (chosen)

Keep `[round x/y]`, `[fix] "title" → fixed` etc. as scrolling lines. Add a single in-place live line per agent that refreshes on each event and on a 1s interval: `reviewer ▶ read loop-controller.ts · 12s · 2 tools`. On `step_finish` emit a compact scrolling footer (`reviewer ✓ 18s · 4 tools · in 13373 / out 31`) then clear the live line. Raw NDJSON streams to `agent-output.log` as it arrives.

- **Pros:** matches the npm/cargo "progress pinned below scrolling output" UX; single live status; capture-safe (non-TTY degrades to scrolling); zero deps; the transcript is richer, not lost.
- **Cons:** requires a streaming spawn, an event parser, and a small terminal state machine; the in-place line needs width truncation so it never wraps.

### Option 2 — Scrolling-only heartbeat

Print a heartbeat line every N seconds during a turn.

- **Pros:** simplest; fully capture-safe; no ANSI.
- **Cons:** noisier (every tick is a new line); no single live status; does not show the current tool; does not match the desired UX.

### Option 3 — Decoupled status file + external viewer command

Write a `status.json` the loop updates; a separate `review-loop status` command reads and renders it.

- **Pros:** most flexible — attach/detach, future dashboard/dashboard consumers.
- **Cons:** two commands and file-write churn are overkill for a live-terminal-only consumer; the file write is itself work on every event; reserved as a documented follow-up, not built now.

## Decision

The chosen Option 1 shipped as streaming `child_process.spawn` + an NDJSON parser + a `LiveRenderer` terminal state machine, threaded through every agent call site and the build check:

1. **Streaming spawn.** The agent spawn switched from buffered `execFile` to `child_process.spawn` with `stdio: ['ignore','pipe','pipe']`. stdout is accumulated (so the buffered return shape is preserved for existing consumers) **and** split into lines, with each line forwarded to an `onLine` callback as it flushes.
2. **`--format json`.** `opencode run` is invoked with `--format json`, so each stdout line is one NDJSON event.
3. **`SpawnFn` gains an optional `onLine` callback** (DI-friendly): existing test fakes ignore it and keep working.
4. **`event-stream.ts`** — a pure module: `parseEventLine(line)` JSON-parses one line, reads `evt.type` + `evt.part`, and normalizes to a discriminated-union `OpencodeEvent` (`step_start` / `tool_use` / `text` / `step_finish`). Unknown or malformed lines return `null` (counted, never thrown). No I/O.
5. **`progress-log.ts`** — `ProgressLog { log }` is replaced by a richer `ProgressReporter` interface: `event()` (scrolling), `live()` (in-place refresh), `clearLive()`, `log()` (back-compat alias → `event()`), plus a `dynamic` flag.
6. **`live-renderer.ts`** — formatting helpers (`formatDuration`, `formatToolArg`, `formatStepFooter`, `formatLiveLine`) + the `LiveRenderer` terminal state machine. TTY → in-place line with `\r\u001b[2K` clear + width truncation; non-TTY → degrade to scrolling. A 1s `setInterval` re-renders the live line so elapsed ticks even while the agent is silent.
7. **Per-tool key-argument extraction** so the live line is meaningful: `read`/`edit`/`write` → `filePath` basename; `bash` → `command` (~40 chars); `grep`/`glob` → `pattern`; `task` → `description`/`subagent_type`; fallback → first string value, truncated.
8. **`agent-runner.ts`** reduces the event stream to per-agent live state (label, elapsed, deduplicated tool count, current tool+arg) and drives `reporter.live()` / `clearLive()` / the `step_finish` footer. Raw NDJSON is appended to `agent-output.log` line-by-line as it flows.
9. **Reporter threaded through every call site** — `loop-controller` types `log` as `ProgressReporter` and forwards `reporter: deps.log` to reviewer, matcher, fixer, and inspector `runAgent` calls.
10. **Build-check live phase** via a `withLivePhase(reporter, label, fn)` helper: `[build] running...`, a ticking `[build] Ns...` live line, then `[build] passed · Ns` / `[build] FAILED · Ns`. Reused by the fixer retry build path.
11. **`cli.ts`** constructs one `LiveRenderer(process.stdout)` and passes it as `log`; the real spawn streams.

## Consequences

### Positive

- An observer now sees, during every agent turn, the agent label, current tool + key argument, elapsed time, and tool count — refreshing in place. A long-running `bash` or a stuck agent is visibly progressing (or visibly not), instead of silent for 10-30 minutes.
- The build check is no longer a silent gap either: `[build] running...` / `[build] passed · 18s` bracket it with a ticking elapsed line.
- The full raw NDJSON event stream lands in `agent-output.log` as it flows (richer than the prior post-mortem append), and the existing scrolling phase/round/issue lines are preserved.
- Capture-safe: piped / CI output degrades to scrolling-only — no ANSI, no interval writes, no cursor desync.
- Zero new runtime dependencies; the DI-first test pattern is intact (spawn fakes ignore the optional `onLine`).
- The elapsed timer is the prerequisite for a future kill/timeout follow-up: a hang is now visible (elapsed climbs with no tool activity).

### Negative

- The `ProgressReporter` interface is a breaking change to the review-loop internals: `live()` now takes an array of lines (not a single string) and the old `ProgressLog` alias was removed, so every `log:` provider and test helper had to move to the richer interface.
- More moving parts: a streaming spawn (with line-splitting), an event parser, and a terminal state machine, each with its own tests.
- `live()` carries an array to support concurrent worker-pool live lines, which is more than this plan's single-line model — every reporter implementation must loop the array even when only one line is active.

### Risks

- **Width truncation assumes a cooperative terminal.** `LiveRenderer` truncates to `stream.columns ?? 80` so the live line never wraps; a terminal that reports the wrong width (or one that ignores `\u001b[2K`) could still desync. Non-TTY mode avoids this entirely by not using ANSI.
- **Hung-process detection is visibility-only.** The ticking timer makes a hang observable; there is no automatic kill/timeout in scope (a documented follow-up). The streaming spawn did, however, gain timeout/kill-grace support independently of this plan's stated non-goal.
- **`withLivePhase` interval coupling.** The 1s `setInterval` is guarded by `reporter.dynamic` and cleared in a `finally`; a reporter whose `dynamic` flag lies (claims TTY when piped) would emit interval ANSI into a capture. The real `LiveRenderer` derives `dynamic` from `stream.isTTY === true`, so this is only a risk for hand-rolled reporters.

## Related Decisions

- [ADR-0064](README.md) — ACP Review Automation — Multi-Agent Review/Verify/Fix Loop: the original review-loop architecture whose buffered, silent agent turns this work makes live. (ADR-0064's source file was pruned with the 0001-0100 batch; referenced via the index.)
- [ADR-0112](0112-review-loop-enhancements.md) — Review Loop Enhancements: severity expansion, plan-then-fix, commit discipline, open permission policy. This work layers live progress on top of that multi-agent loop without changing its control flow; the reviewer/matcher/fixer/inspector call sites are the same ones that now carry `reporter`.
- **ADR-0290 (companion, to be recorded)** — the `review-loop-simplification` plan is the next subagent's target and consolidates the review-loop internals (worker pool, issue processor extraction) that the live-progress wiring landed alongside; several divergences below (e.g. `withLivePhase` and the build phase living in `live-renderer.ts` / `build-checker.ts` rather than inline in `loop-controller.ts`) reflect that simplified structure.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `review-loop/src/event-stream.ts:8-17` | `OpencodeEvent` discriminated union (`step_start` / `tool_use` / `text` / `step_finish`). | `read` confirms. |
| `review-loop/src/event-stream.ts:93-122` | `parseEventLine` — JSON.parse → `part` guard → per-type normalize; malformed/empty/unknown → `null`. Split into `parseStepStart`/`parseToolUse`/`parseText`/`parseStepFinish` helpers. | `read` confirms. |
| `review-loop/src/progress-log.ts:6-12` | `ProgressReporter` interface: `dynamic`, `event`, `live(lines: readonly string[])`, `clearLive`, `log`. (Old `ProgressLog` removed.) | `read` confirms. |
| `review-loop/src/live-renderer.ts:23-31` | `formatDuration` — `0s` / `42s` / `2m05s`. | `read` confirms. |
| `review-loop/src/live-renderer.ts:66-85` | `formatToolArg` — per-tool key-arg extraction (read/edit/write basename; bash command; grep/glob pattern; task description/subagent_type; fallback first string), all truncated to 40. | `read` confirms. |
| `review-loop/src/live-renderer.ts:87-91` | `formatLiveLine` — `label ▶ tool arg · elapsed · N tool(s)`; `thinking` when no tool yet. | `read` confirms. |
| `review-loop/src/live-renderer.ts:93-101` | `formatStepFooter` — `label ✓ elapsed · N tool(s) · in X / out Y`. | `read` confirms. |
| `review-loop/src/live-renderer.ts:103-125` | `withLivePhase(reporter, label, fn)` — `running...` event, 1s ticking live line (guarded by `reporter.dynamic`), `clearLive` in `finally`, returns `{ result, durationMs }`. | `read` confirms. |
| `review-loop/src/live-renderer.ts:127-169` | `LiveRenderer` state machine: `dynamic = stream.isTTY === true`; `event` → clearLive + write+newline; `live(lines)` → non-TTY scrolls each line, TTY writes `\r\u001b[2K` + truncated join; `clearLive` no-op when nothing live. | `read` confirms. |
| `review-loop/src/agent-runner.ts:25-30` | `SpawnFn` gains optional `onLine?: LineSink` (DI-friendly). | `read` confirms. |
| `review-loop/src/agent-runner.ts:218-236` | `attemptRun` invokes `opencode run --auto --format json --model ... --dir ...` with `onLine`. | `read` confirms. |
| `review-loop/src/agent-runner.ts:102-109` | `renderLive` pushes `formatLiveLine(...)` to `reporter.live([...])`. | `read` confirms. |
| `review-loop/src/agent-runner.ts:111-149` | `applyEvent` reduces events: `step_start` starts elapsed + 1s timer (if dynamic); `tool_use` dedups by `callId`, bumps count, sets tool/arg, renders; `step_finish` clears live + emits footer. | `read` confirms. |
| `review-loop/src/agent-runner.ts:151-182` | `createLineHandler` — per-line `appendFile(logPath)` (streaming transcript) + `parseEventLine` + `applyEvent`; `dispose` clears timer + `clearLive`. | `read` confirms. |
| `review-loop/src/spawn.ts:54-103` | `realSpawn` — streaming `spawn` (`detached`, stdio pipe), accumulates stdout/stderr, splits lines via `splitLines`, forwards each to `onLine`, flushes trailing partial on close; timeout/kill-grace (SIGTERM→SIGKILL) added. | `read` confirms. |
| `review-loop/src/spawn.ts:10-15` | `splitLines` factored out (empty-line skipping) and unit-tested separately. | `read` confirms. |
| `review-loop/src/cli.ts:13,17,225` | `LiveRenderer` import; `realSpawn` import; `const log = new LiveRenderer(process.stdout)` passed as `log` to `executeReviewLoop` → `runReviewLoop`. | `read` confirms. |
| `review-loop/src/loop-controller.ts:48` | `ReviewLoopDeps.log: ProgressReporter`. | `read` confirms. |
| `review-loop/src/loop-controller.ts:129,161` | `reporter: deps.log` forwarded to reviewer and matcher `runAgent` calls. | `read` confirms. |
| `review-loop/src/issue-matcher.ts:21,76` | `MatchIssuesDeps.reporter: ProgressReporter`; forwarded to matcher `runAgent`. | `read` confirms. |
| `review-loop/src/issue-processor-attempts.ts:61` | `reporter: deps.log` forwarded to fixer `runAgent`. | `grep` confirms. |
| `review-loop/src/issue-inspector.ts:63,96` | Inspector forwards `reporter` to its `runAgent` calls. | `grep` confirms. |
| `review-loop/src/build-checker.ts:69-77` | `runBuildWithLogging` — `withLivePhase(reporter, 'build', …)` + `reporter.event('[build] passed|FAILED · duration')`. | `read` confirms. |
| `tests/review-loop/event-stream.test.ts:40-46` | Golden-line `step_finish` parser test (plus step_start/tool_use/text/malformed/empty/unknown). | `grep` confirms. |
| `tests/review-loop/live-renderer.test.ts:78-162` | Renderer tests: TTY/non-TTY `dynamic`, ANSI clear-line, truncation to `columns`, and `ProgressReporter.live accepts an array of lines (one per active worker)`. | `grep` confirms. |
| `tests/review-loop/agent-runner.test.ts:288-352` | `streams live progress from agent events` — canned NDJSON via `onLine`; asserts `live` includes `reviewer`+`read`, footer `in 100 / out 5`, and `step_start` in the log. | `grep` confirms. |
| `tests/review-loop/progress-log.test.ts:127-143,192` | `makeReporter` (array-accepting `live`); assertion `messages.some((m) => m.startsWith('[build] passed'))`. | `read` confirms. |
| `tests/review-loop/test-helpers.ts:61-69` | `silentReporter()` helper. | `read` confirms. |
| `tests/review-loop/spawn.test.ts:15-53` | `splitLines` golden table (single/multiple/partial/empty-line/empty-input). | `grep` confirms. |

Plan-vs-implementation notes:

- **`live()` takes an array, not a single string.** The plan/spec modeled the in-place line as a single string (`live(line: string)`). Shipped, `ProgressReporter.live(lines: readonly string[])` accepts one line per active worker so the worker-pool concurrency (which landed alongside the simplification work) can render all in-flight agents' live lines together. `live-renderer.test.ts:152` (`ProgressReporter.live accepts an array of lines (one per active worker)`) pins this. Single-agent callers wrap the one line in an array; multi-agent renderers join with `\n`. Intent (one refreshed live status) is preserved; the shape is broader.
- **`ProgressLog` was removed, not kept as an alias.** The plan/spec said to keep `log()` as a back-compat alias and retain `ProgressLog`. Shipped, `progress-log.ts` exports only `ProgressReporter`; the old interface is gone and every provider moved to it. `log()` survives as a method on `ProgressReporter`.
- **`withLivePhase` and `formatDuration` live in `live-renderer.ts`, not `loop-controller.ts`.** The plan placed `withLivePhase` after `terminalResult` in `loop-controller.ts`. Shipped it is a pure helper in `live-renderer.ts:103`, consumed by `build-checker.ts:runBuildWithLogging`. The build-check live phase is therefore in `build-checker.ts:69-77`, not inline in `loop-controller`'s `processIssue`/`retryFixAfterBuildFailure` — those functions were extracted into `issue-processor.ts` / `issue-processor-attempts.ts` by the concurrent simplification, which now call `runBuildWithLogging`.
- **`realSpawn` was extracted to its own module.** The plan put the streaming spawn inline in `cli.ts`. Shipped it is `review-loop/src/spawn.ts` (`realSpawn` + `splitLines`), imported by `cli.ts`. It also grew timeout/kill-grace support the plan listed as an out-of-scope follow-up: `detached` process group, SIGTERM→SIGKILL escalation, a `timedOut` flag on `SpawnResult`, and `splitLines` factored out and unit-tested in `spawn.test.ts`.
- **`agent-runner.ts` grew beyond the plan.** Alongside the streaming/reporter work it now carries per-agent usage accounting (`AgentUsage` / `AgentRunResult<T>` accumulated from `step_finish` tokens+cost), wall-time measurement (`firstStepAt`), and misplaced-scratch-file detection (`agentWritePath` / `findMisplacedScratches`) that relocates the agent output from `<cwd>/.review-loop/<basename>` to the expected path. The `opencode run` invocation also gained `--auto`. These are concurrent review-loop hardening outside this plan's scope; the streaming-live intent is unchanged.
- **`SpawnFn` / `SpawnResult` signature widened.** Options are now `{ cwd; timeout?; killGraceMs? }` (plan: `{ cwd }`) and `SpawnResult` carries `timedOut?`. The optional `onLine` the plan introduced is preserved verbatim.
- **The reporter is threaded to inspector, not just reviewer/matcher/fixer.** The plan enumerated reviewer/fixer/matcher; shipped also forwards `reporter` through `issue-inspector.ts` (the inspector agent added by ADR-0112's flow), so every agent turn is live.
- **`withLivePhase`'s live-line text omits the command.** The design sketched `[build] bun check:full · 12s …`; shipped emits `[build] Ns...` (label + elapsed only) in `live-renderer.ts:113`, with the `running...` / `passed|FAILED · duration` events bracketing it. The build-check timing visibility goal is met.

The source plan `docs/superpowers/plans/2026-07-15-review-loop-live-progress.md` and design `docs/superpowers/specs/2026-07-15-review-loop-live-progress-design.md` are archived alongside this ADR to `docs/archive/`.
