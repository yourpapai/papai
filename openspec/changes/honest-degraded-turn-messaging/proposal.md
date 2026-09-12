# Proposal: honest-degraded-turn-messaging

## Why

Same 2026-09-04 incident, effect layer: when turns degrade (empty model text, zero tool calls), the verified-completion path replies with `neutralFallback` — "Я выполнил запрошенные действия, но не смог подтвердить результат" / "I ran the requested actions but could not confirm the result" — an assertion that is factually false when nothing ran. The verdict log said `confirmed` for turns where nothing happened, and `llm-orchestrator:send` logged `responseLength: 0` while a 1202-char verifier message actually went out. Degraded turns must produce truthful user messages and a truthful operational picture.

## What Changes

- Fallback selection by fact: when verification cannot produce text, the fallback is chosen by the turn's actual shape — a turn with tool activity gets "ran but could not confirm"; a turn with zero tool activity gets an honest "nothing was executed, please repeat" message (en/ru dictionaries).
- Verdict taxonomy: `deriveVerdict` gains a `no-op` verdict (empty text + no tool-result messages in the turn) so logs and traces stop calling nothing-happened turns `confirmed`.
- Verifier read-only toolset: add the `read_` prefix to `READ_ONLY_PREFIXES` so the diagnostics readers (`read_recent_logs`, `read_llm_traces`, `read_recent_turns`, `read_recent_tool_failures`) are available to the verifier — they are read-only by construction and already assembly-gated (bot-admin DM); today the verifier structurally cannot verify diagnostics claims.
- Send logging: log the length of the actually-sent text (verifier or model), not the discarded `result.text` length.

No breaking changes. Both reply paths (interactive `sendLlmResponse` + proactive `finalizeAndLog`) route through the one `buildVerifiedCompletion`, so all platform instances and both task providers get the behavior; locale resolves per config-context as today. No persisted state; no DB impact.

## Capabilities

### New Capabilities

- `verified-completion`: first spec for the degraded-turn completion contract — risky-turn detection, verdict derivation (including `no-op`), verifier toolset composition, honesty of last-resort messages, and truthful send logging. Without it: any empty-model-text turn tells the user actions were performed when they were not (the incident's user-facing lie), `confirmed` masks no-op turns in ops logs, and sent-length logging misleads incident response. The existing `src/completion/verified-completion.ts` module covers verification mechanics; this change extends its verdict/fallback derivation rather than adding a parallel module.

### Modified Capabilities

None — `openspec/specs/` has no completion-messaging spec today.

## Impact

- Code: `src/completion/verified-completion.ts` (verdict + fallback selection, `READ_ONLY_PREFIXES`), `src/llm-orchestrator-send.ts` (logging), `src/i18n/locales/{en,ru}.ts` (dictionary strings), tests in `tests/completion/`.
- Docs: `docs/architecture/behaviors.md` (verified-completion behavior section).

## Non-goals

- Changing the verifier prompt's tone or language rules — only the machine-chosen fallback strings and verdict change.
- Retrying the main or verifier LLM call on empty output — recovery belongs to `disclosure-tool-call-repair` (cause layer).
- New locales beyond the existing en/ru.
- Analytics events for verdicts — record as declined unless an operator need appears.
