# Proposal: disclosure-tool-call-repair

## Why

Live incident (2026-09-04, Telegram DM): after one tool-heavy turn, every following turn died silently — the model called tools it had used in the previous turn (`read_recent_logs`, `run_diagnostics`), but the turn-scoped disclosure session had reset, so those calls either fell out as `invalid` (NoSuchTool) or were dropped by the gateway entirely. Result: zero tool executions, empty model text, 186–402 billed output tokens per turn, and no log signal. Progressive disclosure needs a recovery path for misdirected calls and a signal for the anomalous-empty-turn shape.

## What Changes

- Attach a `repairToolCall` hook (stable AI SDK v7 `generateText` option) on both generation paths: when the model calls a tool that is registered in the turn's full toolset but not in the step's active set, rewrite the call into `load_tool({ names: [<requested>] })` — always-active — so the session activates the tool via the existing `markLoaded` and the model retries on the next step.
- Add degraded-turn detection: when a turn ends with billed output tokens above a threshold, empty final text, and zero tool calls, emit a warn-level log with the token counts (today this shape is completely silent).
- Add one line to the disclosure protocol prompt (en/ru): activations from previous turns do not persist; call `load_tool` again.

No breaking changes. Applies uniformly to all platform instances and both task providers; no DB or persisted-config impact — the disclosure session stays in-memory and turn-scoped (thread-isolated by the existing storage-context turn lifecycle).

## Capabilities

### New Capabilities

- `tool-calling-resilience`: the agent loop recovers misdirected tool calls (registered-but-inactive names) instead of dropping them, and surfaces the "burned tokens, empty turn" anomaly. Without it: any model that imitates its own prior-turn tool calls after a disclosure reset loses the whole turn with no execution, no reply content, and no operator signal — exactly the incident. The existing `src/tools/disclosure/` module (registry, `load_tool`, prepare-step) already provides activation mechanics; this capability extends it with the repair redirect built on the SDK seam — no parallel mechanism.

### Modified Capabilities

None — `openspec/specs/` has no spec for disclosure or the agent loop today; `tool-calling-resilience` is the first one touching this area.

## Impact

- Code: `src/tools/disclosure/` (new repair builder), `src/llm-orchestrator-invoke.ts` (attach on interactive path), `src/deferred-prompts/proactive-llm.ts:190` (attach on proactive path), `src/llm-orchestrator-support.ts` (anomaly warn near "LLM response received"), `src/i18n/locales/{en,ru}-system-prompt.ts` (protocol line).
- No new dependencies — `repairToolCall` ships in the installed `ai@7.0.79`.
- Docs: `docs/architecture/tools.md` (disclosure section).

## Non-goals

- Sticky cross-turn activation memory (carrying `loaded` across turns) — changes disclosure token economics; recorded as declined, revisit only with cost evidence.
- Auto-retry of an anomalous empty turn — detection first; retry policy needs its own incident data.
- Changing `DISCLOSURE_STALL_STEPS` / no-progress thresholds — the incident turns were 1–2 steps; the failsafes never reached.
- Fixing gateway-side call-dropping (external to papai; the warn makes it visible).
