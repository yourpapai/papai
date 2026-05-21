<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0042: Bot Configuration Wizard UX

## Status

Accepted

## Date

2026-03-27

## Context

The papai bot requires several configuration values before it can interact with LLM providers and task trackers:

- `llm_apikey` - API key for the LLM service
- `llm_baseurl` - Base URL for the LLM API
- `main_model` / `small_model` - Model names for different operations
- `embedding_model` - Optional embedding model for semantic search
- `kaneo_apikey` / `youtrack_token` - Task tracker credentials
- `timezone` - User's timezone for date/time handling

Previously, users had to configure these via the `/set <key> <value>` command, which:

- Required knowledge of all configuration key names
- Provided no validation until the bot tried to use the values
- Was error-prone (typos in API keys, invalid URLs)
- Had no guidance for first-time users
- Required manual verification that all required values were set

We needed a more user-friendly onboarding experience that would:

1. Guide users step-by-step through configuration
2. Validate inputs in real-time (where possible)
3. Work consistently across both Telegram and Mattermost platforms
4. Support both new users and re-configuration scenarios
5. Maintain the existing platform-agnostic architecture

## Decision Drivers

- **Must support both chat platforms** (Telegram and Mattermost) without duplicating logic
- **Must validate inputs** to catch errors early and reduce support burden
- **Should pre-populate existing values** for re-configuration scenarios
- **Should mask sensitive values** (API keys, tokens) in prompts
- **Must maintain existing architecture** where `bot.ts` is the platform-agnostic orchestration layer
- **Should auto-start for new users** to reduce friction

## Considered Options

### Option 1: Platform-Native Dialogs (Interactive)

Use Telegram's InlineKeyboard and Mattermost's Interactive Dialogs for a rich UI.

- **Pros**: Native feel on each platform, buttons for skip/confirm actions
- **Cons**: Mattermost requires HTTP endpoints (current adapter is WebSocket-only), significant platform-specific code, harder to maintain consistency

### Option 2: Text-Based Wizard (Platform-Agnostic)

Use a text-based conversation flow with prompts and responses, consistent across platforms.

- **Pros**: Works identically on both platforms, simpler implementation, easier to test, no HTTP endpoints needed
- **Cons**: Less visually polished than native dialogs, no inline buttons (though can be added incrementally)

### Option 3: Web-Based Configuration

Host a web form for configuration, linked from the bot.

- **Pros**: Rich UI possible, validation can be client-side
- **Cons**: Requires web server, breaks conversational flow, additional authentication complexity

## Decision

We will implement a **text-based wizard** (Option 2) with the following architecture:

```
src/wizard/
├── types.ts              # Type definitions
├── state.ts              # In-memory session management
├── steps.ts              # Step definitions and validation
├── validation.ts         # Live validation (API calls)
├── engine.ts             # Core orchestration
├── save.ts               # Config persistence
├── telegram-handlers.ts  # Telegram button callbacks
└── index.ts              # Public exports
```

The wizard integrates into `bot.ts` via platform-agnostic message interception:

```typescript
// bot.ts - Before processing commands, check for active wizard
if (hasActiveWizard(userId, storageContextId) && !isCommand) {
  const result = await processWizardMessage(userId, storageContextId, text)
  if (result.handled) {
    await reply.text(result.response)
    return
  }
}
```

## Rationale

1. **Platform Consistency**: Text-based flow works identically on Telegram and Mattermost, reducing maintenance burden
2. **Architecture Preservation**: The interception point in `bot.ts` maintains the existing design where providers remain decoupled
3. **Incremental Enhancement**: Telegram-specific button handlers can be added without affecting the core engine
4. **Testability**: Pure text flows are easier to test than UI interactions
5. **Validation Strategy**: Consolidated end-of-wizard validation balances user experience (no interruptions) with correctness

Key implementation decisions:

- **Session storage**: In-memory Map with 30-minute TTL (not SQLite) for simplicity and performance
- **Validation timing**: At wizard completion, not per-step (faster completion, batch validation)
- **Auto-start**: Wizard automatically starts for authorized users who lack configuration
- **Value masking**: Sensitive values shown as `****last4` in prompts

## Consequences

### Positive

- **Improved onboarding**: New users are guided through configuration step-by-step
- **Reduced errors**: Real-time validation catches invalid API keys and URLs before use
- **Cross-platform consistency**: Same experience on Telegram and Mattermost
- **Re-configuration support**: Existing values are pre-populated and can be selectively updated
- **Security**: Sensitive values are masked in prompts and never logged
- **Maintainability**: Centralized wizard logic in platform-agnostic modules

### Negative

- **In-memory sessions**: Lost on bot restart (acceptable for short-lived configuration)
- **No persistent draft**: Cannot resume partially-completed wizard after session expiry
- **Text-only flow**: Less visually engaging than native dialogs (mitigated by Telegram button callbacks)
- **No per-step live validation**: Errors only caught at end (trade-off for faster flow)

### Risks

- **Session accumulation**: Uncompleted wizards could accumulate in memory (mitigated by 30-min TTL cleanup)
- **Concurrent edits**: No locking mechanism if user starts wizard on multiple devices (edge case)

## Implementation Notes

### Session Structure

```typescript
interface WizardSession {
  userId: string
  storageContextId: string // userId for DMs, groupId for groups
  startedAt: Date
  currentStep: number
  totalSteps: number
  data: Partial<Record<ConfigKey, string>>
  skippedSteps: number[]
  platform: 'telegram' | 'mattermost'
  taskProvider: 'kaneo' | 'youtrack'
}
```

### Validation Flow

1. Per-step validation (syntactic): URL format, non-empty checks, timezone validity
2. End-of-wizard validation (semantic): API key connectivity, model existence, URL reachability

### Telegram-Specific Enhancements

- Inline buttons for "Use same as main model", "Skip", "Cancel"
- Callback query handlers in `telegram-handlers.ts` for button interactions
- Button responses mapped to text equivalents for engine compatibility

### Commands Integration

- `/setup` - Explicitly start or restart the wizard
- `/config` - Shows hint to use `/setup` for interactive editing
- `/set` - Shows wizard suggestion when called without arguments

## Related Decisions

- ADR-0014: Multi-Chat Provider Abstraction — Wizard builds on this platform-agnostic foundation
- ADR-0009: Multi-Provider Task Tracker Support — Wizard adapts steps based on `TASK_PROVIDER` env var

## References

- Implementation plan: `docs/plans/done/2026-03-27-bot-configuration-ux-implementation.md`
- Wizard engine: `src/wizard/engine.ts`
- State management: `src/wizard/state.ts`
- Step definitions: `src/wizard/steps.ts`
- Integration tests: `tests/wizard/integration.test.ts`
