<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# review-loop live progress reporting

**Date:** 2026-07-15
**Status:** Approved (design)
**Workspace:** `review-loop/`

## Problem

A `review-loop` run can take 10-30 minutes. During each `opencode run` agent
turn (reviewer / matcher / fixer / fixer-retry) the terminal shows nothing useful
between the one scrolling line that precedes it and the result that follows it.
An observer sees a single stale status for the entire duration of a turn, with no
indication of what the agent is doing, which tool it is running, or whether it is
stuck.

## Root cause

`review-loop/src/agent-runner.ts` spawns `opencode run` through `execFile`, which
buffers the entire stdout/stderr and only resolves when the process exits. The
buffered output is appended to `agent-output.log` **after** the run
(`agent-runner.ts:50`). There is no streaming, no heartbeat, and no elapsed
timer. The `ProgressLog` interface (`progress-log.ts`) is `{ log(message): void }`
wired to `console.log`.

## Enabler

`opencode run --format json` streams real-time NDJSON events to stdout:

| Event         | Notable fields                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `step_start`  | `timestamp`                                                                                         |
| `tool_use`    | `part.tool`, `part.state.status` (`running`\|`completed`\|`error`), `part.state.input`, `part.time` |
| `text`        | `part.text`                                                                                         |
| `step_finish` | `part.reason` (`stop`\|`tool-calls`), `part.tokens` (`input`/`output`/`reasoning`), `part.cost`     |

`--thinking` additionally surfaces reasoning parts. This event stream is the
source of all live progress.

## Decision

**Approach A — Hybrid rendering:** keep the existing scrolling phase lines
(`[round x/y]`, `[fix] "title" → fixed`) and add a single in-place live line per
agent that refreshes as events stream. Raw NDJSON is also streamed to
`agent-output.log`, replacing today's post-mortem append.

Rejected alternatives:

- **Scrolling-only heartbeat** — simpler and capture-safe, but noisier and
  provides no single live status; does not match the desired UX.
- **Decoupled status file + viewer command** — most flexible (attach/detach,
  future dashboards) but two commands and file-write churn are overkill for a
  live-terminal-only consumer.

## Goals / non-goals

**Goals**

- Show, during every agent turn: agent label, current tool + one key argument,
  elapsed time, and tool count — refreshing in place.
- Preserve the existing scrolling phase/round/issue lines and the full
  `agent-output.log` transcript.
- Zero new runtime dependencies.
- Keep the DI-first test pattern intact.

**Non-goals**

- Showing raw tool output, full assistant text, or thinking blocks in the live
  line (compact mode chosen). These remain in `agent-output.log`; `--thinking`
  and a future `--verbose` toggle are reserved hooks, not built now.
- A machine-readable `status.json` or external viewer (Approach C).
- Hung-process timeouts. The ticking timer makes a hang _visible_, which is the
  prerequisite; an actual kill/timeout is a follow-up.

## Architecture

### Component changes (`review-loop/src/`)

| File                       | Change                                                                                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-runner.ts`          | Replace buffered `execFile` with streaming `child_process.spawn`. Add `--format json` to the `opencode run` args. Pipe stdout, split into lines, forward each line to an `onLine` callback and to `agent-output.log` as it flows. Result-file read and retry logic unchanged. |
| `event-stream.ts` _(new)_  | Pure module: `parseEventLine(line)` and the discriminated-union `OpencodeEvent` type. No I/O.                                                                                                                                                                                 |
| `progress-log.ts`          | Evolve `ProgressLog` → `ProgressReporter`; keep `log()` as a back-compat alias.                                                                                                                                                                                               |
| `live-renderer.ts` _(new)_ | Owns terminal output: `event()` (scrolling), `live()` (in-place refresh), `clearLive()`. Raw ANSI, zero deps.                                                                                                                                                                 |
| `loop-controller.ts`       | No structural change. Holds the richer reporter; drives a live phase around `runBuildCheck` (and the retry build) via a small `withLivePhase` helper.                                                                                                                         |
| `cli.ts`                   | Constructs one `LiveRenderer({ stdout: process.stdout })` and passes it as `log` to `runReviewLoop`. The real spawn now streams.                                                                                                                                              |

### Spawn abstraction (DI-friendly)

`SpawnFn` gains one optional parameter so existing fakes (which ignore it) keep
working:

```ts
export type LineSink = (line: string) => void
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
  onLine?: LineSink, // invoked per stdout line as it arrives
) => Promise<{ exitCode: number; stdout: string; stderr: string }>
```

The real implementation uses `spawn` with `stdio: ['ignore','pipe','pipe']`,
accumulates the full stdout string (so the buffered return shape is preserved for
existing consumers) **and** calls `onLine` per line as it flushes. Test fakes are
free to ignore `onLine`.

## Event parsing & live-line content

### `event-stream.ts`

```ts
type OpencodeEvent =
  | { type: 'step_start'; timestamp: number }
  | { type: 'tool_use'; tool: string; status: 'running' | 'completed' | 'error'; input: unknown; elapsedMs?: number }
  | { type: 'text'; text: string }
  | { type: 'step_finish'; reason: string; tokens: { input: number; output: number; reasoning: number }; cost: number }
```

`parseEventLine(line)` JSON-parses one line, reads `evt.type` + `evt.part`, and
normalizes to the union above. Unknown or malformed lines return `null` (counted,
never thrown).

### Per-agent live state

Reduced inside `runAgent` from the event stream:

| Field                        | Source                                                                       | Example           |
| ---------------------------- | ---------------------------------------------------------------------------- | ----------------- |
| `label`                      | `options.label` (reviewer / fixer / matcher / fixer-retry)                   | `fixer`           |
| `elapsedMs`                  | `now - first step_start timestamp`, refreshed every event + every timer tick | `42s`             |
| `toolCount`                  | count of `tool_use` events                                                   | `3 tools`         |
| `currentTool` + `currentArg` | last `tool_use`: `tool` + one key arg                                        | `edit src/cli.ts` |

### Key-argument extraction

A small per-tool mapper so the live line is meaningful, not raw JSON:

- `read` / `edit` / `write` → `filePath` (basename)
- `bash` → `command` (first ~40 chars)
- `grep` / `glob` → `pattern`
- `task` → `description` / `subagent_type`
- fallback → first string value, truncated

### Live-line format

```
  reviewer ▶ read loop-controller.ts · 12s · 2 tools
  fixer    ▶ edit src/cli.ts · 42s · 3 tools
```

Label column-padded; `▶` while running. On `step_finish` a compact footer
scrolls up once, then the live line clears:

```
  reviewer ✓ 18s · 4 tools · in 13373 / out 31
```

No raw output, thinking, or tool results appear in the live line. Every raw event
line is appended to `agent-output.log` as it flows.

## Renderer & terminal coordination

### `ProgressReporter` (`progress-log.ts`)

```ts
export interface ProgressReporter {
  event(message: string): void // scrolling line (phase/round/issue boundaries)
  live(line: string): void // refresh the single in-place line
  clearLive(): void // erase the in-place line
  log(message: string): void // back-compat alias → event()
}
```

### `live-renderer.ts`

A state machine over the injected output stream (`{ write(s): void; isTTY?: boolean }`):

1. **`event(msg)`** — `clearLive()`, write `msg + '\n'`, then re-render the live
   line if one is active (the "progress line pinned to the bottom" pattern used
   by npm/cargo).
2. **`live(line)`** — `\r` + `\u001b[2K` (clear line) + `write(line)` with no
   trailing newline. Padded to width if shorter; truncated with `…` if longer, so
   it never wraps and desyncs the cursor.
3. **`clearLive()`** — `\r\u001b[2K`. Safe no-op when nothing is live.

### Elapsed timer

A `setInterval` (every 1s) re-renders the live line so `· 42s` ticks even while
the agent is silent between tool calls. Started on first `step_start`, cleared on
agent exit / `clearLive`. Guarded so it never fires after the live line is gone.

### TTY awareness

- TTY → in-place live line + ANSI.
- Non-TTY (piped/CI) → degrade to `event()` scrolling only: no ANSI, no interval.
  A stray `| tee` / CI capture never corrupts output.

### Wiring

`cli.ts` constructs one `LiveRenderer` and passes it as `log`. `loop-controller`'s
existing `deps.log.log('[round …]')` calls route through `event()` (scrolling).
The live-line driving happens inside `runAgent`, which calls the same reporter's
`live()` / `clearLive()` as events stream. `loop-controller` structure is
unchanged.

## Build-check progress

The build check is a shell command, not an agent, so it has no event stream, but
it can also stall silently. It is treated as a live phase:

- Before `runBuildCheck`: `reporter.event('[build] running bun check:full …')`.
- During: `reporter.live('[build] bun check:full · 12s …')` on the 1s interval.
- After: `clearLive()` then `event('[build] passed · 18s')` or
  `event('[build] FAILED · 18s')`.

A `withLivePhase(reporter, label, fn)` helper in `loop-controller.ts` drives the
interval and reports duration, keeping `build-checker.ts` unchanged. The fixer
retry build path reuses it.

## Error handling & edge cases

| Case                                               | Behavior                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Malformed / non-JSON stdout line                   | `parseEventLine` → `null`; counted, not shown, never throws.                                                                               |
| `opencode run` exits non-zero                      | `clearLive()`; `attemptRun` returns `{ ok:false }` → existing retry path. Stderr surfaced via `event('[reviewer] stderr: …')` (truncated). |
| Agent emits nothing (pre-`--format json` or crash) | Live line never appears; the preceding scrolling phase line remains the only signal — no regression vs. today.                             |
| Result file missing / invalid JSON                 | Unchanged retry-once logic.                                                                                                                |
| Long single tool (e.g. a 5-min `bash`)             | Live line keeps showing that tool + ticking elapsed — the "is it stuck?" visibility currently missing.                                     |
| Terminal resize / narrow width                     | Live line truncates with `…`; never wraps.                                                                                                 |
| Output piped (non-TTY)                             | Scrolling-only degradation; no ANSI, no timer writes.                                                                                      |
| Exception mid-run                                  | `clearLive()` in a `finally` so the cursor is left clean before `cli.ts`'s error handler prints.                                           |
| Hung process (no events, no exit)                  | Out of scope; the ticking timer makes a hang visible (elapsed climbs with no tool activity). Kill/timeout is a follow-up.                  |

## Testing approach

DI-first (no `mock.module`), tests under `tests/review-loop/`:

1. **`event-stream.test.ts`** — pure unit tests on `parseEventLine`: each event
   type from captured fixtures → expected normalized union; malformed / empty /
   unknown → `null`. Golden lines come from real `opencode run --format json`
   output.
2. **`live-renderer.test.ts`** — inject a fake `{ write(); isTTY }` buffer. Assert
   `event()` prints a line and preserves/re-pins a live line; `live()` writes
   `\r\u001b[2K` + content with no trailing newline; `clearLive()` wipes;
   truncation/padding at narrow widths; non-TTY mode emits no ANSI and routes
   `live()` to scrolling.
3. **`agent-runner.test.ts`** (extend) — add a streaming fake that invokes
   `onLine` with canned NDJSON lines then resolves; assert the reporter receives
   the right `live()` / `clearLive()` calls and the `step_finish` footer fires.
   Existing tests keep working (`onLine` optional, buffered `stdout` preserved).
4. **`progress-log.test.ts`** (extend) — existing `messages[]` assertions still
   pass via `event()` / `log()`; add a test that the build-check live phase emits
   `[build] passed · <dur>`.
5. **Key-arg extraction** — table-driven unit test per tool and the fallback.

### Verification

`bun run review-loop:test`, `bun run review-loop:typecheck`,
`bun run review-loop:lint`.
