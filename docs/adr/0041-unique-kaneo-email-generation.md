<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0041: Unique Kaneo Email and Slug Generation

## Status

Accepted

## Context

When a user is removed via `/user remove` and then re-added via `/user add`, the following sequence occurs:

1. `/user remove` deletes the user from papai's `users` table
2. The user's Kaneo account still exists (Kaneo doesn't support user deletion by default)
3. On re-add, `provisionKaneoUser()` tries to sign up with the same deterministic email address
4. Kaneo rejects this with "email already exists" error
5. Auto-provisioning fails, and the user must manually configure via `/setup`

This creates a poor user experience for administrators who need to re-add users after removal.

### Decision Drivers

- **Must prevent email conflicts** on user re-add operations
- **Should require no changes** to Kaneo's default configuration
- **Should maintain simplicity** in the provisioning flow
- **Must handle workspace slug uniqueness** (same underlying issue applies to slugs)
- **Should not require** Kaneo user deletion capabilities

## Considered Options

### Option 1: Unique Email per Registration (Selected)

Generate a unique email address for each Kaneo registration by appending a random suffix:

- **Old format**: `123456@pap.ai` → always the same, causes conflict
- **New format**: `123456-a1b2c3d4@pap.ai` → unique per registration, no conflict

**Pros**:

- Simple implementation (4 lines changed)
- No external dependencies
- Works with Kaneo's existing signup flow
- Same suffix approach works for both emails and workspace slugs
- 8 hex characters = 4.3 billion combinations (negligible collision probability)

**Cons**:

- Re-adding a user creates a NEW workspace, not restoring the old one
- Old workspaces accumulate over time (requires manual cleanup)
- User must use new credentials for the new workspace

### Option 2: Kaneo User Deletion API

Attempt to delete the Kaneo user account when removing from papai.

**Pros**:

- Clean separation, no orphaned accounts
- User can be truly "re-added" to same workspace

**Cons**:

- Kaneo doesn't support user deletion by default (requires custom implementation)
- Adds complexity to Kaneo deployment
- Still leaves workspace/data cleanup questions

### Option 3: Email-based Lookup and Reuse

Store Kaneo user credentials and attempt to sign in instead of sign up on re-add.

**Pros**:

- Could potentially reuse existing workspace
- No orphaned accounts

**Cons**:

- Requires storing Kaneo passwords (security risk)
- Complex state management between papai and Kaneo
- Breaks if Kaneo password is changed externally
- Doesn't solve slug uniqueness issues

### Option 4: Timestamp-based Uniqueness

Append timestamp instead of random suffix.

**Pros**:

- Predictable format
- Chronologically sortable

**Cons**:

- Longer and less readable
- Doesn't provide better uniqueness guarantees
- Reveals registration timing (minor privacy concern)

## Decision

We will use **Option 1: Unique Email per Registration** with an 8-character hexadecimal suffix derived from `crypto.randomUUID()`.

The suffix is applied to:

- Email addresses: `{userId}-{suffix}@pap.ai` or `{username}-{suffix}@pap.ai`
- Workspace slugs: `papai-{userId}-{suffix}`

## Rationale

This approach provides the best balance of:

1. **Simplicity**: Minimal code changes, no external dependencies
2. **Reliability**: Leverages cryptographically secure randomness from native `crypto.randomUUID()`
3. **Compatibility**: Works with Kaneo's default configuration
4. **Maintainability**: Easy to understand and debug

The trade-off of creating new workspaces on re-add is acceptable because:

- Kaneo doesn't support user deletion by default
- It's safer than attempting workspace restoration/merging
- Users can manually migrate data if needed
- Workspace cleanup can be handled administratively

## Consequences

### Positive

- Users can be removed and re-added without manual intervention
- Each registration creates a fresh, isolated workspace
- No changes required to Kaneo deployment configuration
- Minimal code footprint (4 lines in production code)
- Comprehensive test coverage added

### Negative

- Re-adding a user creates a **new** Kaneo workspace, not restoring the old one
- Old tasks/projects remain in the old workspace (data isolation)
- No automatic data migration between workspaces
- Workspaces accumulate over time (operational consideration)

### Mitigations

- Document the behavior for administrators
- Consider periodic manual cleanup of unused workspaces via Kaneo admin UI
- Users can manually export/import data between workspaces if needed

## Implementation Notes

### Code Changes

**`src/providers/kaneo/provision.ts:119-123`**:

```typescript
const uniqueSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
const email = username === null ? `${platformUserId}-${uniqueSuffix}@pap.ai` : `${username}-${uniqueSuffix}@pap.ai`
const password = generatePassword()
const name = username === null ? `User ${platformUserId}` : `@${username}`
const slug = `papai-${platformUserId}-${uniqueSuffix}`
```

### Test Coverage

- **New test file**: `tests/providers/kaneo/provision.test.ts` (3 tests)
  - Unique email generation with random suffix
  - Username-based email format
  - Successful provisioning returns correct credentials
- **Updated tests**: `tests/commands/admin.test.ts`
  - Updated assertions for new email format

### Edge Cases Handled

1. **Same user ID re-added multiple times** → Each gets unique email and slug, no conflicts
2. **User with username** → `alice-a1b2c3d4@pap.ai` format
3. **User without username** → `123456-a1b2c3d4@pap.ai` format
4. **Collision probability** → 8 hex chars = 4.3 billion combinations, extremely unlikely

## Related Decisions

- ADR-0009: Multi-Provider Task Tracker Support (Kaneo provider architecture)
- ADR-0018: Group Chat Support (user management patterns)

## References

- [Kaneo Documentation](https://github.com/kaneo-app/kaneo)
- Implementation Plan: `docs/plans/done/2025-04-04-unique-kaneo-email-generation.md`
- Pull Request: (to be added when merged)

## Date

2025-04-04
