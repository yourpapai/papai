# Design: disclosure-tool-call-repair

## Context

Progressive disclosure narrows the per-step tool surface via `prepareStep` (`src/tools/disclosure/prepare-step.ts`) to core + meta + loaded names from a turn-scoped `DisclosureSession` (`src/tools/disclosure/registry.ts`). In AI SDK v7 (`ai@7.0.79`), a model call to a name absent from the step's filtered set throws `NoSuchToolError` inside `parseToolCall`, whose outer catch converts it into an `invalid` tool-call part — never executed, fed back as a tool-error. In the 2026-09-04 incident the model, imitating its own previous-turn calls, hit exactly this shape (or the gateway dropped the calls outright — `toolCalls: 0`, empty text, 186–402 billed tokens, no signal). See `proposal.md` — Why.

Two generation paths attach per-step hooks: interactive `callGenerateText` (`src/llm-orchestrator-invoke.ts:89-115`, has `disclosure` in scope) and proactive `runFullGeneration` (`src/deferred-prompts/proactive-llm.ts:190`). `generateText` accepts a stable `repairToolCall` option (`ToolCallRepairFunction`: receives `{ toolCall, tools, error }`, returns `Promise<LanguageModelV4ToolCall | null>`; the repaired call is re-parsed against the same step's active set).

## Goals / Non-Goals

**Goals:** recover misdirected calls with zero steady-state token cost; make the gateway-drop shape visible; nudge the model via the protocol text.

**Non-Goals** (design-level, beyond proposal Non-goals): no proactive-path parity for the anomaly warn in this change (its result plumbing lacks a usage seam today — revisit with evidence); no metrics/analytics events for repairs; no repair logging above debug.

## Decisions

### D1: Repair = redirect into `load_tool`, not auto-execute

The repair function closes over the `DisclosureSession`:

- If `error` is `NoSuchToolError` AND `session.allNames.has(name)` AND the name is not in `session.activeToolNames()` → call `session.markLoaded([name])`, then return `{ toolCallId: original, toolName: 'load_tool', input: JSON.stringify({ names: [name] }) }`.
- Otherwise → return `null` (original error stands; `InvalidToolInputError` is never touched).

Rationale: the repaired call re-parses against the step's active set, so it must land on an always-active name — `load_tool` qualifies and its existing `execute` returns `{ loaded, unknown, nowActive }`, giving the model explicit feedback to retry. Auto-executing the original tool on the current step is impossible (the step's execution set is fixed before parse); auto-activation without the redirect would leave the model's question unanswered until it retries on its own.

Alternatives: (a) `prepareStep` scanning prior steps for invalid calls and pre-activating — same trigger, but no immediate model-visible result and duplicates parse logic; (b) sticky cross-turn sessions — rejected in proposal Non-goals (token economics). Multiple misdirected calls in one step each redirect to their own `load_tool` call; `markLoaded` is idempotent.

New builder lives in `src/tools/disclosure/repair-tool-call.ts` (one tool-concern per file per `src/tools/CLAUDE.md`; the disclosure module already owns session semantics — no new module level). Attached only when `disclosure !== undefined`; non-disclosure turns keep plain `NoSuchToolError` (a missing name there is genuinely unknown).

### D2: Anomaly warn in `invokeWithLiveStatus`, fixed threshold

After the existing "LLM response received" debug log (`src/llm-orchestrator-support.ts:190-193`), warn when `usage.outputTokens >= 64` AND final `text` is empty/undefined AND `toolCalls.length === 0`. Fields: `{ contextId, outputTokens, finishReason }` — counts only, no content (logging policy). Threshold 64 is a constant, not config: the incident floor was 186; trivial empty stops cost single digits. No settings-UI surface.

### D3: Protocol line in the existing disclosure fragment

One sentence appended to `disclosureProtocol` in `en-system-prompt.ts` / `ru-system-prompt.ts`: activations expire with the turn; re-activate before reusing a tool from an earlier turn. The fragment is assembled by `buildDisclosureFragment` (`src/system-prompt.ts:75-79`) — no new fragment, no fragment gating change.

## Risks / Trade-offs

- [Model learns to rely on repair instead of the search→load protocol] → Repair logs at debug with the repaired name; if reliance grows, the protocol line (D3) and prompt already push correct behavior; no enforcement planned.
- [Gateway-dropped calls remain unrecoverable] → Accepted; that shape is the warn's job (D2). Repair only sees calls the provider returned.
- [`LanguageModelV4ToolCall.input` must be a JSON string] → Pinned by a unit test asserting the exact repaired shape.
- [Repair fires before `ask`-wrapped confirmation semantics] → No interaction: `load_tool` is disclosure-injected and cannot be wrapped by stored prefs (`src/tools/AGENTS.md`); the activated tool keeps its wrapper.

## Scope / Gating / Persistence

No persisted state — the session stays in-memory and turn-scoped (thread-isolated via the existing storage-context turn lifecycle). No capability or `tool_prefs` changes: repair activates only names already inside the gated toolset. No DB migration. No new dependencies (`repairToolCall` ships in `ai@7.0.79`).

## TDD / Hook Interactions

New files gated by the Write/Edit hook: `src/tools/disclosure/repair-tool-call.ts`, its test file, plus edits in `invoke`/`support`/`proactive-llm`/locale prompt files. Order: (1) failing unit tests for the repair builder over a real `DisclosureSession` fixture; (2) failing test that `callGenerateText`/proactive options include `repairToolCall` when disclosure is present and omit it otherwise; (3) failing warn test with a synthetic result object; (4) prompt-content tests en/ru; then implementation.
