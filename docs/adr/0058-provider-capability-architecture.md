<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0058: Provider Capability Architecture

## Status

Accepted

## Date

2026-04-10

## Context

papai already had a mature capability architecture for task providers (`Capability` on `TaskProvider`), but no equivalent for chat providers. This asymmetry caused several concrete problems:

1. **Chat providers were flat**: Provider-specific behavior leaked into `bot.ts`, setup/wizard flows, config UI, and startup through platform-name checks (`chat.name === 'telegram'`) and duck typing.
2. **Plugin plans were underspecified**: Plugin design described framework permissions (`"store"`, `"scheduler"`, `"taskProvider"`, `"chat"`) but not the specific task/chat capabilities a plugin needs to function.
3. **Plugin tool binding was wrong**: The design said plugin tools should be provider/user-bound factories, but the implementation plan stored raw tools at activation time.
4. **New providers needed a subset model**: Discord MVP demonstrated the need for a deliberately smaller chat surface expressible without adding more `chat.name === ...` branches.
5. **Naming collision risk**: Task `Capability` and any future chat capability type would share a generic name, making cross-provider reasoning ambiguous.

The design document at `docs/superpowers/specs/2026-04-10-provider-capability-architecture-design.md` specified six goals: shared provider metadata, explicit chat capabilities, provider-agnostic interaction routing, first consumer refactors, plugin capability requirements, and task capability rename.

## Decision Drivers

- **Must make task and chat capability systems symmetric** — both provider families expose the same kinds of metadata
- **Must be additive** — no breaking changes to existing `ChatProvider` consumers
- **Must eliminate platform-name branching** — replace `chat.name === 'telegram'` with capability predicates
- **Should support subset providers** — Discord MVP must be expressible as a deliberately smaller capability set
- **Should preserve plugin compatibility path** — plugins must be able to declare required capabilities

## Considered Options

### Option 1: Additive ChatProvider evolution with shared metadata

Add `ChatCapability`, `ChatProviderTraits`, `ChatProviderConfigRequirement`, and `IncomingInteraction` to the existing `ChatProvider` interface. Rename `Capability` to `TaskCapability` with a transitional alias. Add a provider-agnostic interaction router and capability helper predicates.

**Pros:**

- Symmetric model across task and chat providers
- No breaking changes — `ThreadCapabilities` stays separate, `onInteraction` is optional
- Capability predicates (`supportsInteractiveButtons`, `supportsFileReplies`, etc.) are testable in isolation
- Plugin manifests can declare `requiredTaskCapabilities` and `requiredChatCapabilities`
- Subset providers (Discord MVP) are first-class with explicit capability gaps

**Cons:**

- Six-task implementation plan with broad surface area
- Temporary `Capability = TaskCapability` alias until migration completes
- Plugin design docs need revision to align with new model

### Option 2: Generic provider base class

Create a generic `BaseProvider<C, R>` class that both `TaskProvider` and `ChatProvider` extend, sharing capability and config requirement logic at the type level.

**Pros:**

- Maximum code reuse between provider families
- Single source of truth for capability set operations

**Cons:**

- Over-engineering for current needs — task and chat providers have fundamentally different lifecycles
- Forces a class hierarchy where structural typing suffices
- Higher risk of coupling unrelated concerns

### Option 3: Adapter pattern per chat provider

Keep the existing flat `ChatProvider` but add per-provider adapter classes that wrap capability checks internally.

**Pros:**

- No interface changes
- Each adapter owns its own capability logic

**Cons:**

- Doesn't solve the platform-branching problem — consumers still need to know which adapter they're talking to
- Capability logic is scattered across adapters instead of centralized
- Doesn't address plugin capability requirements

## Decision

We chose **Option 1**: Additive ChatProvider evolution with shared provider metadata.

Key elements:

1. **`TaskCapability` rename**: Existing `Capability` becomes `TaskCapability` with a transitional `Capability = TaskCapability` alias.
2. **`ChatCapability` union**: Behavior-oriented capability names (`messages.buttons`, `interactions.callbacks`, `users.resolve`, etc.) — not implementation-oriented.
3. **`ChatProviderTraits`**: Non-boolean constraints like `observedGroupMessages`, `maxMessageLength`, `callbackDataMaxLength`.
4. **`IncomingInteraction`**: Provider-agnostic interaction event shape with `kind`, `user`, `contextId`, `callbackData`.
5. **Shared interaction router**: Centralizes `cfg:*`, `wizard_*`, and future `plugin_*` callback routing — removes Telegram-owned callback files.
6. **Capability helper predicates**: `supportsInteractiveButtons()`, `supportsFileReplies()`, `supportsUserResolution()`, `supportsCommandMenu()` in `src/chat/capabilities.ts`.
7. **Plugin manifest extension**: `requiredTaskCapabilities` and `requiredChatCapabilities` fields, plus `incompatible` plugin state.

## Rationale

1. **Symmetry**: Both provider families now expose `name`, `capabilities`, `configRequirements`, and optional traits. This makes the rest of the application reason about providers consistently.
2. **Additive only**: The existing `ChatProvider` interface gains new optional fields (`onInteraction?`) and new required fields that adapters fill in. No existing behavior changes until consumers opt into capability gating.
3. **Subset-friendly**: Discord MVP can advertise a deliberately smaller capability set (`mentions_only` group observation, no file replies) without any special-casing.
4. **Interaction centralization**: Moving Telegram callback routing into a shared router (`src/chat/interaction-router.ts`) eliminates `src/chat/telegram/config-editor-callbacks.ts` and `src/wizard/telegram-handlers.ts`.
5. **Plugin alignment**: Separating framework permissions from provider capability requirements gives the plugin system a clear incompatibility state instead of collapsing provider mismatch into generic activation failure.

## Consequences

### Positive

- Platform-name branching (`chat.name === 'telegram'`) eliminated from `/config`, `/context`, `/group`, wizard, and startup
- Chat providers declare capabilities explicitly — future providers start from a known subset model
- Plugin system can reject activation when provider capabilities don't match requirements
- Interaction routing is provider-agnostic — Telegram, future Mattermost webhooks, and Discord components all use the same router
- Capability predicates are individually testable with minimal mocking

### Negative

- Six-task implementation plan touches 30+ files across providers, chat, commands, wizard, bot, and tests
- Temporary `Capability = TaskCapability` alias must be cleaned up after all consumers migrate
- Mattermost does not advertise button/interaction support in this phase — the architecture reserves space but the real callback receiver is deferred

### Risks

- Capability set may grow faster than consumers adapt — mitigation: helper predicates centralize checks so adding new capabilities doesn't require touching every call site
- Plugin tool factories may need further refinement when the plugin system is actually implemented — mitigation: the factory shape is documented but not yet runtime-validated

## Implementation Notes

### Provider Capability Assignments

| Provider   | Chat Capabilities                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram   | `commands.menu`, `interactions.callbacks`, `messages.buttons`, `messages.files`, `messages.redact`, `messages.reply-context`, `files.receive` |
| Mattermost | `messages.files`, `messages.redact`, `messages.reply-context`, `files.receive`, `users.resolve`                                               |
| Discord    | Reserved subset target for future implementation                                                                                              |

### Key Files

- `src/providers/types.ts` — `TaskCapability` type and `TaskProvider` interface
- `src/chat/types.ts` — `ChatCapability`, `ChatProviderTraits`, `IncomingInteraction`, evolved `ChatProvider`
- `src/chat/capabilities.ts` — Helper predicates
- `src/chat/interaction-router.ts` — Shared callback router
- `src/chat/startup.ts` — Capability-aware command menu registration
- Deleted: `src/chat/telegram/config-editor-callbacks.ts`, `src/wizard/telegram-handlers.ts`

### Consumer Refactors

- `/config` — text-first fallback when interactive buttons unavailable
- `/context` — warning when file replies unsupported
- `/group` — requires explicit user ID when username resolution unavailable
- Wizard — buttons gated by `supportsInteractiveButtons`, no platform field in session state
- Startup — `registerCommandMenuIfSupported()` replaces duck-typed command menu logic

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support (original task provider capability model)
- ADR-0014: Multi-Chat Provider Abstraction (original ChatProvider design)
- ADR-0051: Discord Chat Provider (subset-capability consumer)
- ADR-0031: Provider-Agnostic Status vs Column Abstraction (earlier provider abstraction precedent)

## References

- Design Document: `docs/superpowers/specs/2026-04-10-provider-capability-architecture-design.md`
- Implementation Plan: `docs/superpowers/plans/2026-04-10-provider-capability-architecture.md`
