<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0163: Mattermost Mention-Prefixed Command Syntax

## Status

Implemented

## Date

2026-05-28

## Context

The Mattermost provider matched incoming WebSocket post text starting with `/`
as papai commands. This does not align with how Mattermost actually handles
slash commands: Mattermost's native slash-command resolver intercepts bare
`/command` input before it reaches the bot, so the user gets "command not
found" from Mattermost instead of papai's intended behavior. papai's local
bare-slash parser only worked by accident in edge cases where Mattermost did
not intercept first.

The design spec
(`docs/archive/2026-05-28-mattermost-command-syntax-design.md`) and
implementation plan
(`docs/archive/2026-05-28-mattermost-mention-command-syntax.md`) established
that Mattermost commands should require an explicit `@papai /command` form,
removing the misleading bare-slash fallback entirely.

## Decision Drivers

- **Honest UX**: Command syntax must reflect what actually works in
  Mattermost, not pretend slash commands that Mattermost itself rejects.
- **Provider-local change**: The normalization logic belongs inside the
  Mattermost adapter, not in shared command handlers.
- **No backward compatibility for broken behavior**: Bare `/command` parsing
  was never reliable; preserving it as a fallback would sustain user
  confusion.
- **Minimal discovery surface**: `@papai /help` is the primary discovery
  mechanism; no autocomplete or native slash registration is required.
- **Preserve natural-language mentions**: Mention-addressed natural language
  (`@papai summarize this thread`) must continue reaching the main message
  flow unchanged.

## Considered Options

### Option A: Register real Mattermost custom slash commands

Use Mattermost's REST API to register native slash commands and receive them
via the `post` event or a dedicated integration hook.

- **Pros**: Autocomplete and native UX; aligns with Mattermost user
  expectations.
- **Cons**: Significant provider integration work; requires per-instance
  command registration; conflicts with the project's stated non-goal of
  native slash-command integration; introduces state that must survive
  server restarts.

### Option B: Require `@papai /command` everywhere (chosen)

Only messages of the form `@papai /command` are treated as commands. Bare
`/command` is ignored by papai. The provider normalizes mention-prefixed
input before command matching.

- **Pros**: Honest about what works; no Mattermost API dependency for
  command registration; simple, predictable behavior; localized change in
  the Mattermost adapter.
- **Cons**: Users must type the mention prefix even in DMs; no native
  autocomplete; syntax differs from Telegram's slash menu model.

### Option C: Accept both `@papai /command` and bare `/command` with a warning

Keep bare-slash matching but reply with a deprecation notice guiding users
to the mention-prefixed form.

- **Pros**: Backward-compatible transition period.
- **Cons**: Bare-slash parsing is fundamentally unreliable in Mattermost
  (the server intercepts it first); a deprecation path for broken behavior
  creates false confidence and adds complexity.

## Decision

**Option B**: Mattermost commands require the mention prefix `@papai
/command` in all contexts (DMs, channels, threads). Bare `/command` is not
recognized as a papai command.

| Topic                       | Decision                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Command form                | `@papai /command` only. Bare `/command` is not a papai command.                                                 |
| DMs vs channels             | Same syntax everywhere. No DM-only bare-slash shortcut.                                                         |
| Natural-language mentions   | `@papai <non-slash text>` still reaches the message flow as `isMentioned: true` with `commandMatch: undefined`. |
| Normalization               | Provider-local `normalizeMattermostMessageText()` detects mention, strips it, classifies remainder.             |
| Empty mention-only messages | Reply with guidance: "Use `@papai /help` to see commands, or mention me with a question."                       |
| Discovery                   | `@papai /help` is the primary entry point. No autocomplete.                                                     |
| Handler impact              | No changes to `src/commands/` handlers. The adapter owns normalization and classification.                      |
| Bare-slash removal          | Complete removal, not a deprecation path. The existing bare-slash match was unreliable by design.               |

## Consequences

### Positive

- Command syntax is honest and consistent with Mattermost's actual message
  flow.
- No conflict between papai's slash parser and Mattermost's native
  command resolver.
- Change is localized to `MattermostChatProvider`; shared command handlers
  remain unchanged.
- `IncomingMessage` fields (`text`, `isMentioned`, `commandMatch`) stay
  internally coherent after normalization.

### Negative

- Users must type `@papai` before every command, even in DMs.
- No Mattermost autocomplete or native slash discovery.
- Command syntax intentionally differs from Telegram's native `/command`
  model, which may cause cross-platform user confusion.

### Risks

- Users who accidentally relied on bare `/command` in edge cases will need
  to learn the new syntax. The empty-mention guidance message mitigates
  this partially.
- If Mattermost changes how it routes unrecognized slash commands, the
  current assumption that bare `/command` never reaches the bot may need
  re-evaluation.

## Implementation Notes

Key change in `src/chat/mattermost/index.ts`:

- `normalizeMattermostMessageText(message, botUsername)` returns
  `{ text, isMentioned, commandInput }`. If the message starts with
  `@<botUsername>`, the mention is stripped and `isMentioned` is `true`;
  if the remaining text starts with `/`, `commandInput` is set;
  otherwise it is `null`.
- `buildPostedMessage()` calls the normalizer before command matching.
  `matchCommand()` only receives already-normalized slash input.
- Empty mention-only messages (`msg.isMentioned && msg.text === ''`)
  trigger a short guidance reply before normal dispatch.
- Bare `/command` messages without a leading mention are not matched and
  are treated as regular group noise.

Tests in `tests/chat/mattermost/index.test.ts` cover: mention-prefixed
command routing, bare-slash non-routing, mention-prefixed natural-language
message flow, and mention-only guidance behavior.

## Related Decisions

- ADR-0014: Multi-Chat Provider Abstraction — the chat provider model that
  makes it possible to localize this change to the Mattermost adapter.
- ADR-0009: Multi-Provider Task Tracker Support — provider capability
  model; no task-provider changes required for this decision.
