<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0065: Discord onInteraction Refactor

## Status

Accepted

## Date

2026-04-12

## Context

Discord's button interaction handling bypassed the shared `src/chat/interaction-router.ts`. While Telegram routes button callbacks through `chat.onInteraction(...)` (registered in `src/bot.ts`), Discord maintained its own `handleConfigEditorCallback` and `handleWizardCallback` in `src/chat/discord/handlers.ts` — a near-duplicate of the shared router's `defaultHandleConfigInteraction` and `defaultHandleWizardInteraction`. This meant any new interaction domain (e.g. `plugin_*`) had to be implemented twice or forgotten for Discord.

The provider capability architecture design (`docs/superpowers/specs/2026-04-11-discord-capability-alignment-design.md`, Section 2) identified this as a concrete gap and prescribed the migration path.

## Decision Drivers

- **Must eliminate duplicate interaction routing logic** between Discord and the shared router
- **Must align Discord with Telegram/Mattermost** so new router domains work across all providers without per-adapter duplication
- **Must preserve existing button interaction behavior** (config editor callbacks, wizard flows)
- **Should reduce total lines of code** by deleting the duplicate handler module

## Considered Options

### Option 1: Implement onInteraction on DiscordChatProvider

Add the optional `onInteraction()` method from `ChatProvider` interface, map Discord button interactions to `IncomingInteraction` via a new `interaction-helpers.ts`, and route through the centralized `routeInteraction()` function.

**Pros:**

- Symmetric with Telegram and Mattermost
- New interaction domains automatically available on Discord
- Deletes ~141 lines of duplicate logic in `handlers.ts`

**Cons:**

- Requires a new helper module to map Discord-specific interaction types
- Slight behavioral risk if mapping diverges from what the inline handler did

### Option 2: Keep Discord handlers but extract shared logic

Refactor the shared router to call into a common function that both the router and Discord handlers use.

**Pros:**

- No change to Discord's integration surface

**Cons:**

- Still requires maintaining per-adapter dispatch code
- Does not solve the scaling problem (every new provider needs handlers)
- More indirection without reducing duplication

### Option 3: Move all interaction logic to provider layer

Have each provider fully own its interaction handling with no shared router.

**Pros:**

- Maximum provider autonomy

**Cons:**

- Massive duplication across providers
- Defeats the purpose of the shared interaction router
- Inconsistent with existing architecture

## Decision

Implement **Option 1**: Add `onInteraction()` to `DiscordChatProvider` and route all button interactions through the shared `routeInteraction()`.

The implementation includes:

1. **New `interaction-helpers.ts`**: `buildDiscordInteraction()` maps Discord button interactions to `IncomingInteraction`, mirroring the Telegram pattern
2. **`onInteraction()` method**: Registers the handler, wired transparently by `src/bot.ts` at startup
3. **Refactored dispatch**: `dispatchButtonInteraction` maps the raw interaction, calls `routeInteraction()`, and falls back only for unrecognized prefixes
4. **Deleted `handlers.ts`**: The `handleConfigEditorCallback` and `handleWizardCallback` duplicates are superseded by the shared router

## Rationale

1. **Architectural consistency**: Every chat provider now follows the same interaction routing pattern — register via `onInteraction`, let the shared router dispatch
2. **Single point of extension**: Adding a new interaction domain (e.g. `plugin_*`) only requires updating `routeInteraction()`, not each adapter
3. **Code reduction**: ~141 lines removed from `handlers.ts` plus associated tests
4. **Test coverage preserved**: New `interaction-helpers.test.ts` covers the mapping logic; existing Discord provider tests updated for `onInteraction` wiring

## Consequences

### Positive

- Discord button interactions flow through the same router as Telegram/Mattermost
- Plugin system can add interaction handlers in one place (`routeInteraction`) instead of N adapters
- ~200 lines of code removed (handlers + tests)
- Future interaction domains automatically work on all providers

### Negative

- New helper module adds ~33 lines of mapping code
- Slightly more indirection in the button dispatch path

### Risks

- **Mapping divergence**: If `IncomingInteraction` shape changes, all adapters must update their helpers. Mitigation: TypeScript enforces the interface contract.
- **Fallback dead code**: `routeButtonFallback` may have no remaining callers. Mitigation: Verified via test suite probe before deletion.

## Implementation Notes

### File Structure

| File                                             | Change                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `src/chat/discord/interaction-helpers.ts`        | **New** — maps Discord button interactions to `IncomingInteraction`        |
| `src/chat/discord/index.ts`                      | Modified — added `onInteraction()`, refactored `dispatchButtonInteraction` |
| `src/chat/discord/handlers.ts`                   | **Deleted** — superseded by shared router                                  |
| `tests/chat/discord/interaction-helpers.test.ts` | **New** — tests for mapping function                                       |
| `tests/chat/discord/handlers.test.ts`            | **Deleted** with source                                                    |
| `tests/chat/discord/index.test.ts`               | Modified — updated for `onInteraction` wiring                              |

### Context Detection

DM vs group context is determined by Discord channel type (`CHANNEL_TYPE_DM = 1`). DM interactions use the user ID as `contextId`; group interactions use the channel ID. This mirrors the Telegram pattern.

## Verification

- `bun test tests/chat/discord/` passes
- `bun typecheck` succeeds
- `bun lint` passes
- No imports of `./handlers` remain in `src/chat/discord/`

## Related Decisions

- ADR-0051: Discord Chat Provider (original implementation with inline handlers)
- ADR-0014: Multi-Chat-Provider Abstraction (foundation for shared patterns)
- ADR-0058: Provider Capability Architecture (identified this gap)

## References

- Spec: `docs/superpowers/specs/2026-04-11-discord-capability-alignment-design.md` (Section 2)
- Plan: `docs/superpowers/plans/2026-04-12-discord-oninteraction-refactor.md`
- Shared router: `src/chat/interaction-router.ts`
- Telegram pattern: `src/chat/telegram/interaction-helpers.ts`
