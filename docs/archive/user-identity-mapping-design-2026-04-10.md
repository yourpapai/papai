<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User Identity Mapping Design

**Date:** 2026-04-10  
**Topic:** Provider-Agnostic User Identity Resolution for Group Chats  
**Status:** Approved

---

## 1. Problem Statement

In **group chats**, when multiple users interact with the bot and say things like "assign to me" or "show my tasks", the bot must resolve "me" to the correct task tracker user.

Currently, the bot doesn't know which user is calling it when using a shared API token. This causes issues:

- Commands like "show my tasks" incorrectly resolve to the token owner
- "Assign me" assigns tasks to the wrong person
- The bot has no way to distinguish between users in group contexts

This applies to all provider combinations:

- Telegram + Kaneo
- Telegram + YouTrack
- Mattermost + Kaneo
- Mattermost + YouTrack
- Future providers

---

## 2. Solution Overview

**Core Principle:** Map `chat_user_id` → `task_tracker_user_id` with provider-specific resolution strategies.

Users can establish and correct their identity mapping via **natural language**:

- "I'm jsmith" → Links to user "jsmith"
- "I'm not Alice" → Clears incorrect mapping
- "These aren't my tasks" → Prompts for correct identity

---

## 3. Data Model

### Database Schema

New table in `src/db/schema.ts`:

```typescript
export const userIdentityMappings = sqliteTable(
  'user_identity_mappings',
  {
    contextId: text('context_id').notNull(), // chat user ID (Telegram numeric or Mattermost ID)
    providerName: text('provider_name').notNull(), // 'kaneo', 'youtrack', etc.
    providerUserId: text('provider_user_id'), // task tracker user ID (null if unmatched)
    providerUserLogin: text('provider_user_login'), // task tracker login/username
    displayName: text('display_name'), // cached display name
    matchedAt: text('matched_at').notNull(),
    matchMethod: text('match_method'), // 'auto', 'manual_nl', 'unmatched'
    confidence: integer('confidence'), // 0-100
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.providerName] }),
    index('idx_identity_mappings_provider_user').on(table.providerName, table.providerUserId),
  ],
)
```

**Rationale:**

- Composite key `(contextId, providerName)` allows different mappings per provider (user might be "jsmith" in Kaneo but "john.smith" in YouTrack)
- Nullable `providerUserId` supports `unmatched` state (prevent repeated failed lookups)
- Caching `displayName` reduces API calls
- `matchMethod` tracks how mapping was established

---

## 4. Provider Interface Extension

### UserIdentityResolver Interface

```typescript
// src/providers/types.ts
export interface UserIdentityResolver {
  /** Search provider users by name/username/email */
  searchUsers(query: string, limit?: number): Promise<UserRef[]>

  /** Get specific user by login/username */
  getUserByLogin?(login: string): Promise<UserRef | null>
}

// Extended TaskProvider interface
export interface TaskProvider {
  // ... existing methods ...

  /** Optional: user identity resolution for "me" references */
  identityResolver?: UserIdentityResolver
}
```

### Provider-Specific Resolution Strategies

| Provider     | Strategy                                                                      |
| ------------ | ----------------------------------------------------------------------------- |
| **Kaneo**    | Uses `listUsers` API; matches by username, email, or display name             |
| **YouTrack** | Uses `/api/users` with `nameStartsWith`; matches by login, email, or fullName |

---

## 5. Auto-Link Flow (Group Chats Only)

**In DMs:** Skip auto-link (single user context is implicit)

**In group chats on first interaction:**

1. Check if mapping exists for `(contextId, providerName)` - if yes, skip
2. Get `ChatUser` info (username, display name) from the chat platform
3. Call `provider.identityResolver.searchUsers()` with chat username
4. Attempt matching with confidence scoring:
   - **Exact username/login match** (confidence: 100%)
   - **Display name match** (confidence: 90%)
   - **Email prefix match** (confidence: 80%)
5. If single match with confidence >= 80%: Store mapping with `matchMethod: 'auto'`
6. If multiple matches or low confidence: Store as `unmatched`, bot responds:
   > "I found multiple users named 'John'. Which one are you? Say 'I'm jsmith' or 'Link me to john.smith'"

---

## 6. Natural Language Identity Tools

### Tool: `set_my_identity`

**Description:** Allows users to establish their task tracker identity via natural language.

**Triggers:**

- "I'm jsmith"
- "My login is john.smith"
- "Link me to user jsmith"
- "I'm not Alice, I'm actually jsmith"
- "These aren't my tasks, I'm bob"

**Execution Flow:**

1. Extract claimed identity from user message
2. Call `provider.identityResolver.getUserByLogin()` or `searchUsers()`
3. Validate user exists in task tracker
4. Store mapping with `matchMethod: 'manual_nl'`
5. Return confirmation: "Linked you to jsmith (John Smith) in YouTrack"

### Tool: `clear_my_identity`

**Description:** Allows users to remove incorrect identity mappings.

**Triggers:**

- "I'm not Alice"
- "Unlink my account"
- "That's not me"
- "These aren't my tasks"

**Execution Flow:**

1. Check if mapping exists
2. If exists: Clear `providerUserId`, set `matchMethod: 'unmatched'`
3. Respond: "Okay, I've unlinked you. Tell me your correct login (e.g., 'I'm jsmith')"

---

## 7. Identity Resolution in Tools

### Resolution Helper

```typescript
// src/identity/resolution.ts
export async function resolveMeReference(
  contextId: string,
  provider: TaskProvider,
): Promise<{ userId: string; login: string; displayName: string } | null> {
  const mapping = getCachedIdentity(contextId, provider.name)

  if (mapping === null) {
    // No mapping attempted yet - trigger auto-link
    return await attemptAutoLink(contextId, provider)
  }

  if (mapping.providerUserId === null) {
    // Previously failed to match - return null to trigger prompt
    return null
  }

  return {
    userId: mapping.providerUserId,
    login: mapping.providerUserLogin,
    displayName: mapping.displayName,
  }
}
```

### Modified Tools

Tools that accept "me" references must use resolution:

- `create_task` - `assignee: "me"` → resolved to provider user ID
- `update_task` - `assignee: "me"` → resolved to provider user ID
- `search_tasks` - Query "my tasks" → injects resolved user login into query
- `list_tasks` - Filter by assignee "me" → resolved user ID
- `add_watcher` - `userId: "me"` → resolved user ID
- `remove_watcher` - `userId: "me"` → resolved user ID

**Pattern:**

```typescript
// In tool execute function
if (params.assignee?.toLowerCase() === 'me') {
  const identity = await resolveMeReference(userId, provider)
  if (identity === null) {
    return {
      status: 'identity_required',
      message: 'I need to know who you are in the task tracker. Tell me your login (e.g., "I\'m jsmith")',
    }
  }
  resolvedAssignee = identity.userId
}
```

---

## 8. Error Handling & User Feedback

| Scenario                               | Response                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| No mapping exists                      | "I don't know which task tracker user you are. Tell me your login (e.g., 'I'm jsmith')." |
| Mapping marked `unmatched`             | "I couldn't automatically match you. What's your login in [Kaneo/YouTrack]?"             |
| User denies identity ("I'm not Alice") | "Got it. What's your actual login?"                                                      |
| Manual identity not found              | "I couldn't find 'jsmith' in [Kaneo/YouTrack]. Check the login and try again."           |
| Multiple similar users                 | "I found: jsmith (John Smith), j.smith (Jane Smith). Which one are you?"                 |

---

## 9. Implementation Components

### New Modules

| Module                           | Purpose                                               |
| -------------------------------- | ----------------------------------------------------- |
| `src/identity/mapping.ts`        | CRUD operations for identity mappings                 |
| `src/identity/resolver.ts`       | Generic resolution logic and caching                  |
| `src/identity/nl-detection.ts`   | Natural language pattern matching for identity claims |
| `src/identity/types.ts`          | Shared types for identity system                      |
| `src/tools/set-my-identity.ts`   | Tool for setting identity via NL                      |
| `src/tools/clear-my-identity.ts` | Tool for clearing identity via NL                     |

### Modified Modules

| Module                            | Changes                              |
| --------------------------------- | ------------------------------------ |
| `src/db/schema.ts`                | Add `userIdentityMappings` table     |
| `src/providers/types.ts`          | Add `UserIdentityResolver` interface |
| `src/providers/kaneo/index.ts`    | Implement `identityResolver`         |
| `src/providers/youtrack/index.ts` | Implement `identityResolver`         |
| `src/tools/index.ts`              | Add identity tools for group chats   |
| `src/tools/create-task.ts`        | Use identity resolution for assignee |
| `src/tools/update-task.ts`        | Use identity resolution for assignee |
| `src/tools/search-tasks.ts`       | Use identity for "my tasks" queries  |
| `src/tools/list-tasks.ts`         | Use identity for assignee filter     |
| `src/tools/add-watcher.ts`        | Use identity for userId              |
| `src/tools/remove-watcher.ts`     | Use identity for userId              |

---

## 10. Testing Strategy

### Unit Tests

| Test                                       | Location                              |
| ------------------------------------------ | ------------------------------------- |
| Matching algorithm (exact, display, email) | `tests/identity/resolver.test.ts`     |
| NL pattern detection                       | `tests/identity/nl-detection.test.ts` |
| CRUD operations                            | `tests/identity/mapping.test.ts`      |
| Identity tools                             | `tests/tools/set-my-identity.test.ts` |

### Integration Tests

| Test                       | Location                                    |
| -------------------------- | ------------------------------------------- |
| Kaneo identity resolver    | `tests/providers/kaneo/identity.test.ts`    |
| YouTrack identity resolver | `tests/providers/youtrack/identity.test.ts` |
| Tool integration           | `tests/tools/identity-integration.test.ts`  |

### E2E Tests

| Test                                              | Location                                |
| ------------------------------------------------- | --------------------------------------- |
| Full flow: first message → auto-link → "my tasks" | `tests/e2e/identity-flow.test.ts`       |
| Correction flow: wrong match → clear → manual set | `tests/e2e/identity-correction.test.ts` |

---

## 11. Future Considerations

### Optional Enhancements (Out of Scope)

1. **Admin Commands:** `/admin link-user @telegram-user jsmith` for manual admin linking
2. **Bulk Import:** CSV import of username mappings
3. **LDAP/SSO Integration:** Automatic sync with directory services
4. **Identity Persistence Across Providers:** Option to share mappings between Kaneo and YouTrack

### Security Considerations

- Identity mappings are per-context; no cross-user access
- No sensitive data in mappings (only public usernames/display names)
- Manual NL resolution requires user confirmation

---

## 12. Acceptance Criteria

- [ ] User can say "show my tasks" in a group chat and see their own tasks
- [ ] User can say "assign to me" and task is assigned to them
- [ ] User can correct wrong identity with "I'm not Alice, I'm jsmith"
- [ ] Auto-link works for exact username matches
- [ ] Manual linking works via natural language
- [ ] Identity is provider-specific (user can be different in Kaneo vs YouTrack)
- [ ] DMs skip identity resolution (implicit single user)
- [ ] All existing tests continue to pass
