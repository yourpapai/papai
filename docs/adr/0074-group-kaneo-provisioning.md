<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0074: Group Kaneo Provisioning with Explicit Authorization

## Status

Accepted

## Date

2026-04-17

## Context

The papai bot supports group chats through Telegram, Mattermost, and Discord. Groups can be configured to use task trackers (Kaneo or YouTrack) for collaborative task management. Prior to this decision, group usage was controlled through a simple member-override list (`group_members` table) and implicit provisioning could occur from group messages.

Several issues emerged with the existing approach:

1. **No bot-level group authorization**: Any group could technically use papai if members were added to the override list, without explicit bot-admin approval
2. **Implicit provisioning from group messages**: The bot could auto-provision Kaneo accounts during normal group message processing, which was unpredictable and created a poor admin experience
3. **Thread-scoped configuration confusion**: Group configuration could inadvertently become thread-scoped in platforms like Telegram that support threads, causing configuration fragmentation
4. **No clear separation between bot admin and group admin concerns**: Group authorization and per-group member management were conflated

The team needed to establish clear authorization layers, explicit provisioning triggers, and group-scoped configuration persistence.

## Decision Drivers

- **Must allow bot-level group authorization** before any group can use papai
- **Must distinguish platform group admin access** from general member access
- **Should gate non-admin members** through explicit member overrides
- **Must prevent implicit provisioning** from ordinary group messages
- **Should DM provisioned credentials** only to the initiating group admin
- **Must keep group config group-scoped**, not thread-scoped
- **Should preserve existing `/group adduser` behavior** for member management

## Considered Options

### Option 1: Implicit Group Authorization via Usage

- **Pros**: Simplest implementation — just observe groups and track them
- **Cons**: No bot-admin control, no way to deny groups, security risk

### Option 2: Explicit Group Allowlist with Setup-Time Provisioning (Selected)

- **Pros**: Clear bot-admin control, explicit provisioning trigger, DM-only credential delivery, preserves existing member management
- **Cons**: Requires new `/group add` admin command, additional table and migration

### Option 3: Service Account Model for Groups

- **Pros**: Centralized credentials, no per-group account sprawl
- **Cons**: Complex permission model, significant Kaneo API changes, out of scope for current capabilities

### Option 4: Per-Member Account Creation for Groups

- **Pros**: Each user has their own Kaneo account within the shared workspace
- **Cons**: Significant complexity, out of scope, would delay delivery

## Decision

We will implement **Option 2: Explicit Group Allowlist with Setup-Time Provisioning**.

The solution adds three distinct authorization layers:

1. **User allowlist** for DM usage (existing)
2. **Group allowlist** (`authorized_groups` table) for whether papai may be used in a group at all
3. **Group member overrides** (`group_members` table) for non-admin users inside an allowed group

For Kaneo-backed groups, provisioning only occurs from explicit DM `/setup` triggered by a group admin for an allowlisted group. On first-time setup, the bot provisions a Kaneo account/workspace for the group, stores credentials against the group config context (not thread context), and DMs credentials only to the initiating admin.

## Rationale

This approach provides:

1. **Clear separation of concerns**: Bot admins control which groups may use papai; group admins control which non-admin members may use papai within their group
2. **Explicit provisioning trigger**: No surprises — provisioning only happens when an admin explicitly requests setup
3. **Secure credential handling**: Credentials are never posted to group chats; they go only to the requesting admin via DM
4. **Configuration scope clarity**: Group Kaneo configuration is bound to the group context, not thread contexts, preventing configuration fragmentation
5. **Backward compatibility**: Existing `/group adduser` member management continues to work unchanged within allowlisted groups

The trade-off is additional complexity in the `/group` command handler (branching between DM admin commands and in-group member commands) and a new database table with migration.

## Consequences

### Positive

- Bot admins have explicit control over group authorization
- Group provisioning is predictable and admin-initiated
- Credentials are securely delivered via DM only
- Group configuration remains stable across threads
- Platform group admins get default access without explicit member list management

### Negative

- New `/group add <group-id>` command surface for bot admins
- Additional database table and migration
- Command handler branching complexity (`/group` means different things in DM vs group context)
- Slightly more complex setup flow for first-time group configuration

### Risks

- Command name collision (`/group` for admin DM vs in-group member management)
  - **Mitigation**: Clear command handling based on `contextType`, documented behavior
- Stale admin observations in group selector
  - **Mitigation**: Re-verify authorization at setup execution time, not just discovery time

## Implementation Notes

### New Database Table

```sql
CREATE TABLE authorized_groups (
  group_id  TEXT PRIMARY KEY,
  added_by  TEXT NOT NULL,
  added_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_authorized_groups_added_by ON authorized_groups(added_by);
```

### Command Surface

**DM (bot-admin only):**

- `/group add <group-id>` — Authorize a group
- `/group remove <group-id>` — Revoke group authorization
- `/groups` — List authorized groups

**In-group (group-admin only):**

- `/group adduser <@username>` — Add non-admin member
- `/group deluser <@username>` — Remove non-admin member
- `/group users` — List authorized non-admin members

### Authorization Flow

```
Group message received
    ↓
Is group allowlisted? ──No──→ Reject with bot-admin hint
    ↓ Yes
Is user platform group admin? ──Yes──→ Allow
    ↓ No
Is user in group_members? ──Yes──→ Allow
    ↓ No
Reject with group-admin hint
```

### Provisioning Flow

```
DM /setup → Select group
    ↓
Is group allowlisted? ──No──→ Block, suggest /group add
    ↓ Yes
Is first-time Kaneo setup? ──No──→ Normal wizard
    ↓ Yes
Provision Kaneo account/workspace
Store credentials against group config context
DM credentials to initiating admin
Stop (auto-provisioning) or Continue (explicit wizard)
```

## Related Decisions

- ADR-0018: Group Chat Support — Foundation for group context handling
- ADR-0041: Unique Kaneo Email and Slug Generation — Provisioning email generation
- ADR-0042: Bot Configuration Wizard UX — Setup wizard foundation
- ADR-0046: Demo Mode Auto-Provisioning — Prior art for auto-provisioning patterns
- ADR-0066: Wire Auto-Link Flow on First Group Interaction — Related group onboarding flow

## References

- Implementation Plan: `docs/archive/2026-04-17-group-kaneo-provisioning-implementation.md`
- Design Spec: `docs/archive/2026-04-17-group-kaneo-provisioning-design.md`
- Schema: `src/db/schema.ts` (authorizedGroups table)
- Module: `src/authorized-groups.ts` (CRUD helpers)
- Migration: `src/db/migrations/024_authorized_groups.ts`
