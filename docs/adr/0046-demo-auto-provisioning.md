<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0046: Demo Mode Auto-Provisioning

## Status

Accepted

## Date

2026-04-04

## Context

The papai bot requires several configuration steps before users can interact with it:

1. **User authorization** — Admin must add users via `/user add` command
2. **Kaneo provisioning** — Users need a Kaneo workspace with API key
3. **LLM configuration** — API keys, base URLs, and model names must be set

This creates friction for first-time users who want to evaluate the bot, especially in demo or trial scenarios. We needed a way to enable "zero-configuration" onboarding where:

- Users can immediately message the bot without pre-authorization
- Kaneo workspace is created automatically
- LLM configuration is inherited from the admin
- Users are restricted to non-admin privileges (view-only, cannot add other users)

Additionally, this feature must:

- Be **opt-in only** via environment variable (`DEMO_MODE=true`)
- Only work in **DM context** (not group chats) for security
- Not interfere with normal authorization flows when disabled
- Allow distinguishing demo users from regular admin-added users

## Decision Drivers

- **Must be opt-in** — Disabled by default, explicitly enabled via `DEMO_MODE` env var
- **Must preserve security** — Demo users cannot manage other users or access admin functions
- **Must work across platforms** — Both Telegram and Mattermost DM contexts
- **Must auto-provision Kaneo** — Create workspace, API key, and store credentials
- **Must copy LLM config** — Inherit admin's LLM settings so bot is immediately usable
- **Must handle /start command** — Commands bypass `checkAuthorizationExtended()`, need separate handling
- **Must skip wizard** — Demo users shouldn't see the configuration wizard

## Considered Options

### Option 1: Environment-Based Demo Mode with Authorization Interception

Intercept authorization checks to auto-add unknown users when `DEMO_MODE=true`, provision Kaneo automatically, and copy admin LLM config.

- **Pros**: Minimal code changes, reuses existing provisioning logic, clean separation of concerns
- **Cons**: Requires careful handling of command bypass (commands don't go through `checkAuthorizationExtended()`)

### Option 2: Separate Demo Bot Instance

Run a completely separate bot instance with hardcoded open registration.

- **Pros**: Complete isolation from production, no risk of accidental exposure
- **Cons**: Requires separate deployment, database, and maintenance overhead; divergence between codebases

### Option 3: Invitation-Based Registration

Generate time-limited invitation tokens that allow self-registration.

- **Pros**: More controlled than open registration, audit trail of invitations
- **Cons**: Requires additional UI for generating/managing invitations, not truly "zero-configuration"

### Option 4: Magic Link Auto-Authorization

Users click a link with a token that auto-authorizes them.

- **Pros**: Single-click onboarding, works well for web apps
- **Cons**: Requires web server endpoint, not native to chat platforms, adds complexity

## Decision

We will implement **Option 1** — Environment-Based Demo Mode with Authorization Interception.

The implementation consists of four components:

### 1. LLM Config Copy Function (`src/config.ts`)

```typescript
const LLM_COPY_KEYS: readonly ConfigKey[] = [
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
]

export function copyAdminLlmConfig(targetUserId: string, adminUserId: string): void
```

Copies specified LLM configuration keys from admin to target user, skipping keys that:

- Already exist on the target
- Are not set on the admin

### 2. Demo User Detection (`src/users.ts`)

```typescript
export function isDemoUser(userId: string): boolean {
  const row = db.select({ addedBy: users.addedBy }).from(users).where(eq(users.platformUserId, userId)).get()
  return row?.addedBy === 'demo-auto'
}
```

Demo users are identified by `addedBy: 'demo-auto'` in the database, distinguishing them from admin-added users.

### 3. Authorization Interception (`src/bot.ts`)

In `checkAuthorizationExtended()`, add demo mode auto-add before the existing authorization check:

```typescript
if (process.env['DEMO_MODE'] === 'true' && !isAuthorized(userId) && contextType === 'dm') {
  log.info({ userId, username }, 'Demo mode: auto-adding user')
  addUser(userId, 'demo-auto', username ?? undefined)
  return getGroupMemberAuth(userId, false) // Non-admin auth
}
```

For already-authorized users, check if they're demo users and return non-admin auth:

```typescript
if (isAuthorized(userId)) {
  if (contextType === 'dm' && isDemoUser(userId)) {
    return getGroupMemberAuth(userId, false) // Stay non-admin
  }
  return getBotAdminAuth(userId, contextId, contextType, isPlatformAdmin)
}
```

### 4. Command Handler Integration (`src/commands/start.ts`)

Commands bypass `checkAuthorizationExtended()`, so `/start` must also handle demo auto-add:

```typescript
if (process.env['DEMO_MODE'] === 'true' && msg.contextType === 'dm' && !isAuthorized(msg.user.id)) {
  addUser(msg.user.id, 'demo-auto', msg.user.username ?? undefined)
  log.info({ userId: msg.user.id }, 'Demo mode: auto-added user via /start')
  await maybeProvisionKaneo(reply, msg.user.id, msg.user.username)
  return
}
```

### 5. Kaneo Provisioning Integration (`src/providers/kaneo/provision.ts`)

After successful provisioning or when user is already provisioned, copy admin LLM config:

```typescript
if (process.env['DEMO_MODE'] === 'true') {
  const adminUserId = process.env['ADMIN_USER_ID']
  if (adminUserId !== undefined && adminUserId !== '') {
    copyAdminLlmConfig(contextId, adminUserId)
  }
}
```

### 6. Wizard Auto-Start Bypass (`src/bot.ts`)

Demo users skip the configuration wizard since they inherit config from admin:

```typescript
// Demo users get config from admin via maybeProvisionKaneo — skip wizard
if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false
```

## Rationale

1. **Minimal Invasion**: Changes are localized to authorization, provisioning, and command layers without affecting core LLM orchestration
2. **Security Boundaries**: Demo users get `isBotAdmin: false`, cannot access `/user` commands
3. **Platform Agnostic**: Implementation works for both Telegram and Mattermost via `contextType` check
4. **Zero Configuration**: Users message the bot and it's immediately usable
5. **Reversible**: Setting `DEMO_MODE=false` immediately disables auto-registration
6. **Testable**: Environment variable checks allow test isolation

Key technical decisions:

- **Inline `process.env` checks**: Module-level constants are evaluated at import time; inline checks allow tests to toggle mode dynamically
- **DM-only scope**: Group chats still require explicit authorization, preventing spam
- **Non-destructive config copy**: Existing target config is preserved, only missing keys are filled
- **'demo-auto' marker**: Distinct from manual 'admin' addedBy value for audit and privilege separation

## Consequences

### Positive

- **Immediate onboarding**: Users can evaluate the bot without any setup
- **Reduced support burden**: No manual provisioning or config guidance needed for demos
- **Security preserved**: Demo users are explicitly non-admin and cannot escalate privileges
- **Clean rollback**: Disabling `DEMO_MODE` reverts to strict authorization
- **Audit trail**: Demo users are tagged with `addedBy: 'demo-auto'` in database
- **Reuses existing infrastructure**: Leverages `provisionAndConfigure()` and wizard skip logic

### Negative

- **Admin API key exposure**: Admin's LLM API key is copied to demo users (acceptable for demo environments)
- **Environment variable dependency**: Tests must carefully manage `process.env` state
- **Two entry points**: Both message handler and `/start` command need demo mode checks
- **No rate limiting**: Auto-provisioning could be abused if `DEMO_MODE` is left enabled (mitigated by DM-only scope)

### Risks

- **Accidental production enable**: If `DEMO_MODE=true` in production, unknown users gain access
  - **Mitigation**: Clear documentation, explicit opt-in naming, warning in `.env.example`
- **Workspace proliferation**: Each demo user creates a new Kaneo workspace
  - **Mitigation**: Acceptable for demo use; admin can disable `DEMO_MODE` or clean up periodically
- **Credential inheritance bugs**: LLM config might not copy correctly
  - **Mitigation**: Comprehensive tests covering all copy scenarios

## Implementation Notes

### Environment Variables

```bash
# Demo mode: when true, any user who messages the bot is automatically
# added, Kaneo-provisioned, and pre-filled with the admin's LLM config.
# Intended for demo/evaluation use. Defaults to false.
# WARNING: Do not enable in production — admin's LLM_APIKEY is copied to all users.
DEMO_MODE=false
```

### Database Schema

No schema changes required. Uses existing `users` table with `addedBy` column already present.

### Test Coverage

- `copyAdminLlmConfig`: 4 test cases (copy all, skip unset, no-op, preserve existing)
- Demo auto-add: 6 test cases (auto-add, stay non-admin, no username, retain admin, no group, mode off)
- Wizard bypass: 1 test case (demo user skips wizard)

### Files Modified

| File                               | Changes                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `src/config.ts`                    | Add `copyAdminLlmConfig()` function                                         |
| `src/users.ts`                     | Add `isDemoUser()` function                                                 |
| `src/bot.ts`                       | Add demo mode interception in `checkAuthorizationExtended()`, wizard bypass |
| `src/commands/start.ts`            | Add demo auto-add before auth check                                         |
| `src/providers/kaneo/provision.ts` | Add `copyAdminLlmConfig` calls after provisioning                           |
| `tests/config.test.ts`             | Add `copyAdminLlmConfig` test suite                                         |
| `tests/commands/bot-auth.test.ts`  | Add demo mode auto-provision tests                                          |
| `tests/llm-orchestrator.test.ts`   | Add demo mode LLM config copy test                                          |
| `.env.example`                     | Add `DEMO_MODE` documentation                                               |

## Related Decisions

- ADR-0042: Bot Configuration Wizard UX — Demo mode bypasses wizard via `autoStartWizardIfNeeded()` check
- ADR-0009: Multi-Provider Task Tracker Support — Uses existing `maybeProvisionKaneo()` for Kaneo-only
- ADR-0014: Multi-Chat Provider Abstraction — Platform-agnostic via `contextType` discrimination

## References

- Implementation plan: `docs/plans/done/2026-04-01-demo-auto-provision-implementation.md`
- Config module: `src/config.ts`
- User management: `src/users.ts`
- Authorization logic: `src/bot.ts`
- Start command: `src/commands/start.ts`
- Kaneo provisioning: `src/providers/kaneo/provision.ts`
