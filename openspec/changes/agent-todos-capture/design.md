# agent-todos-capture — Design

## Context

The capture seam and the transport both exist (see proposal.md — Why). One live run (`walk-drill-target/.afk-runner/runs/fix-the-response-delivery-path-verification-fallback-chunking/transcripts/`) pins the wire shape — `resolver-r1`, `implement-t2`, `implement-t4` all call `todowrite`; `drafter-*`, `reviewer-*`, `skeptic-*`, `estimator` do not:

```json
{"type":"tool_use","timestamp":…,"sessionID":"ses_…",
 "part":{"type":"tool","tool":"todowrite","callID":"…",
   "state":{"status":"completed",
     "input":{"todos":[{"content":"RED: add llm:verifier rows …","status":"in_progress","priority":"high"}, …]}}}}
```

Constraints: the event log is append-only and fold-driven (L0/L1 noise is tolerated, never drives — `agent-noise-schemas.ts`); both folds skip unmapped types (`kernel/fold.ts` `tolerated += 1`); `ProgressReporter` has three consumers (review-loop, afk-runner, mutation-improve), so any new hook must be optional.

## Goals / Non-Goals

**Goals:**
- Todo snapshots land in `events.ndjson` as first-class L0 events, live-appended while the agent runs.
- One normalized todo shape regardless of backend; zero behavior change when no todo tool is called.

**Non-Goals:** board display, fold consumption, steering, transcript/session-storage reads — all declined in proposal.md.

## Decisions

**D1 — Capture at the line handler, surfaced through a new optional `ProgressReporter.todos?` hook.** In `applyEvent`'s `tool_use` case, a `todowrite`/`TodoWrite` tool name routes `evt.input.todos` to `reporter.todos?.(todos)`. Alternatives rejected: smuggling the list through `formatToolArg`'s `arg` string (loses structure, corrupts the slot-line grammar, which anchors on line starts); the board reading `transcripts/*.jsonl` directly (couples the read-only projection to backend stream formats and multiplies its per-poll cost); re-homing spawns on the ACP/magi stack (out of scope by orders of magnitude). The hook mirrors `usage?`: review-loop stays display-agnostic, afk-runner decides what becomes a run fact.

**D2 — Backend normalization lives in review-loop, one shape crosses the seam.** opencode's observed item is `{content, status, priority}`; claude's `TodoWrite` documents `{content, status, activeForm}`. The decoder normalizes both to `{content, status}` before the hook fires; `priority`/`activeForm` are agent-internal and dropped. `todoread` (read-only) never emits. Unknown tool names are ignored — a renamed or new todo tool degrades to today's bare marker, never to noise. The opencode envelope above is pinned verbatim by a test fixture; the claude route's documented shape is pinned by a second fixture (not yet observed live in this repo — a future claude-route run can confirm it without touching specs).

**D3 — Event shape: `L0 agent_todos {agent, todos: [{content, status}...]}`.** Declared in `agent-noise-schemas.ts` (the "telemetry the fold tolerates, never drives on" lane), unioned into `event-schemas.ts` so `appendEvent`/`readEvents` validate it. `createAgentReporter` maps the hook to `{altitude:'L0', type:'agent_todos', agent: label, todos}`.

**D4 — Dedup and bounds live in afk-runner's reporter, not review-loop.** The reporter closure keeps the agent's last emitted snapshot (serialized compare); an identical consecutive list emits nothing. Bounds: max 20 items, `content` truncated at 200 chars — the `sanitizeRowGap` precedent (one line, no leading `→` is not needed here; todo content is JSON-safe text, only length is bounded). Observed volume is ~2 calls per agent, so the dedup is a guard, not a hot path. review-loop stays stateless per spawn; afk-runner owns per-agent state where the event is minted.

**D5 — Fold/parity: deliberately untouched.** `toKernelEvent` returns null for the new type (tolerated accounting, both folds); no fixture grows, no scenario is added, golden replay is unaffected. The pin is a small test asserting fold accounting counts `agent_todos` as tolerated and the kernel snapshot is unchanged by it — the same shape as the existing L0/L1 tolerance guarantees.

**D6 — Keying is run-scoped, nothing else.** Events carry the emitting agent's `label` (as every L0/L1 event already does); they live in the run's `events.ndjson` under the work dir. No platform-instance, config-context, storage-context, or user keying; no DB rows.

## Risks / Trade-offs

- [Log volume — each event rewrites the whole list] → D4 dedup + caps; observed ~2 calls/agent; worst case a few hundred KB per run.
- [Todo content echoes repo paths, test names, code] → the raw stream is already persisted in `transcripts/*.jsonl`; the log gains no new exposure class. Truncation bounds the copied surface.
- [`ProgressReporter` blast radius to mutation-improve] → optional hook, unobserved consumers unaffected; review-loop's own renderer ignores it (same as `usage?` today).
- [Backend tool rename drift] → unknown tools are ignored (D2); degradation is silence, not corruption.

## Migration Plan

Purely additive: new tolerated event type, no schema migration, no backfill. Old logs fold exactly as before; new logs on old binaries leave the events unread-but-valid (schema validation still parses them — the union grows). Rollback is stop-emitting; already-written `agent_todos` lines stay harmless tolerated noise.

## Hook/TDD interactions

Gateable files: `review-loop/src/line-handler.ts`, `afk-runner/src/agent-reporter.ts`, `afk-runner/src/agent-noise-schemas.ts` — each lands test-first: (1) `tests/review-loop/` line-handler fixture asserting the hook fires with the normalized list from the pinned opencode envelope (and not for `todoread`); (2) `tests/afk-runner/` reporter mapping + dedup/bounds; (3) fold-tolerance accounting test. The new schema file changes gate `tests/afk-runner/` suites per the write-hook pipeline.

## Open Questions

None blocking. The one unpinned shape (claude route's `TodoWrite`, D2) is normalization-by-documentation with a fixture pin; observing it live later changes nothing structural.
