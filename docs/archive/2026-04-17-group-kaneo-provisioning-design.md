<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Group Kaneo Provisioning Design

**Date:** 2026-04-17
**Status:** Approved
**Approach:** Explicit Group Allowlist With Setup-Time Provisioning

## Summary

Add an explicit bot-level group allowlist managed from the existing admin DM command surface. Allowlisted groups may use papai, with platform group admins allowed by default and non-admin members still gated through the existing per-group member override list.

For Kaneo-backed setups, add explicit group-scoped provisioning during DM `/setup` for a selected group. Group provisioning never triggers from normal group messages. On first setup for an allowlisted group, papai may provision the group's Kaneo account internally, DM credentials only to the initiating group admin, and then either stop or continue into the normal setup wizard depending on the auto-provisioning setting. Subsequent `/setup` runs always use the regular wizard.

## Requirements

- Add admin DM commands: `/group add <group-id>`, `/group remove <group-id>`, `/groups`
- Keep existing in-group `/group adduser`, `/group deluser`, `/group users`
- Distinguish bot-level group authorization from per-group member overrides
- Allow platform group admins to use papai by default in allowlisted groups
- Require non-admin group members to be explicitly added with `/group adduser`
- Require groups to be allowlisted before group `/setup` may succeed
- Provision Kaneo for groups only from explicit admin-triggered DM `/setup`, never from normal group messages
- On first-time group setup with auto-provisioning enabled: provision, DM credentials to the initiating admin, and do not continue into the normal setup wizard
- On first-time group setup with auto-provisioning disabled: provision, DM credentials to the initiating admin, then continue into the normal setup wizard in the same flow
- On second or later group `/setup`: always skip provisioning and run the normal setup wizard
- Bind group Kaneo config and workspace state to the group config context, not thread-scoped storage contexts

## Assumptions

- Public Kaneo self-registration is disabled, but papai can still provision accounts internally through Kaneo auth endpoints
- Group provisioning creates one Kaneo account and workspace for the group config context today
- Credentials for provisioned group Kaneo accounts are only sent to the group admin who initiated `/setup`
- The new admin group commands live on the existing DM admin surface, even though `/group` already exists for in-group member management

## Non-Goals

- No Kaneo service-account model is introduced
- No provisioning from ordinary group messages
- No expansion of `/groups` into a rich inspection dashboard in chat
- No implementation yet of per-member Kaneo account creation for group members

## Future Note

Keep a future path in mind where papai creates one Kaneo account per group member and connects all of them to the shared group Kaneo workspace. That model is explicitly out of scope for this implementation and should not distort the current design toward premature multi-account complexity.

## Section 1: Authorization Model

Three authorization layers remain distinct:

1. User allowlist for DM usage
2. Group allowlist for whether papai may be used in a group at all
3. Group member overrides for non-admin users inside an allowed group

Runtime behavior for groups becomes:

- If the group is not allowlisted, usage is rejected before existing group member checks
- If the group is allowlisted and the current chat user is a platform group admin, usage is allowed
- If the group is allowlisted and the current chat user is not a platform group admin, usage falls back to the existing `group_members` check

This keeps bot-level authorization separate from local group delegation.

## Section 2: Command Surface

### Admin DM commands

Extend the existing admin DM command surface with:

- `/group add <group-id>`
- `/group remove <group-id>`
- `/groups`

These commands are:

- DM-only
- bot-admin-only
- responsible only for bot-level group authorization state

### Existing in-group commands

Preserve the current in-group `/group` behavior:

- `/group adduser <@username>`
- `/group deluser <@username>`
- `/group users`

These continue to manage non-admin member overrides within an already-allowed group. They do not authorize the group itself.

### Command routing rule

The `/group` command name is shared across two contexts:

- in DMs, bot-admin-only group allowlist management
- in groups, group-admin member override management

This is acceptable because command handling already branches on `contextType`, and it avoids inventing a second admin-only command namespace.

## Section 3: Data Model

Add a new group allowlist table separate from `group_members`.

Suggested table: `authorized_groups`

| Column     | Type    | Description                        |
| ---------- | ------- | ---------------------------------- |
| `group_id` | TEXT PK | Chat-platform group context ID     |
| `added_by` | TEXT    | Bot admin who authorized the group |
| `added_at` | TEXT    | ISO timestamp                      |

This table is the source of truth for whether a group can use papai.

Existing tables remain responsible for their current concerns:

- `group_members`: non-admin group member overrides
- `known_group_contexts`: observed group metadata for setup targeting and discovery
- `group_admin_observations`: observed admin status for manageable-group selection
- `user_config`: per-context configuration values, including group Kaneo credentials keyed by group config context
- `users`: DM user allowlist

## Section 4: Setup Targeting And Provisioning State

Group `/setup` remains DM-driven and continues to use the current manageable-group selector fed by observed adminable groups.

After a user selects a target group in DM:

1. Verify the caller is still authorized to manage that group
2. Verify the selected group is present in `authorized_groups`
3. Resolve whether the group already has Kaneo credentials and workspace bound to its group config context

For Kaneo groups, first-time setup is defined as:

- no stored group Kaneo credential for the group config context, or
- no stored group Kaneo workspace for the group config context

Subsequent setup means both required Kaneo values already exist for that group config context.

## Section 5: Provisioning Flow

### First-time setup, auto-provisioning enabled

When the initiating group admin runs DM `/setup` for an allowlisted group for the first time:

1. papai provisions a Kaneo user/workspace for the group config context
2. papai stores the resulting Kaneo credential and workspace against the group config context
3. papai DMs the Kaneo credentials only to the initiating group admin
4. papai does not continue into the normal setup wizard on that run

This gives the admin the new credentials immediately and keeps the first interaction narrowly focused.

### First-time setup, auto-provisioning disabled

When the initiating group admin runs DM `/setup` for an allowlisted group for the first time and auto-provisioning is disabled:

1. papai provisions a Kaneo user/workspace for the group config context through the internal bot provisioning path
2. papai stores the resulting Kaneo credential and workspace against the group config context
3. papai DMs the Kaneo credentials only to the initiating group admin
4. papai continues directly into the regular setup wizard in the same flow

This preserves the explicit setup path while still unblocking Kaneo account creation for the group.

### Second and later setup runs

If the group already has Kaneo credential and workspace state:

- skip provisioning entirely
- run the regular setup wizard

This applies regardless of the auto-provisioning setting.

## Section 6: Context Rules

The implementation must use the group config context for stored group config and provisioning state. Thread-scoped storage contexts must not create separate Kaneo configuration or workspace state.

Key rule:

- conversation history may remain thread-scoped where supported
- group Kaneo configuration must remain group-scoped

In practice, group provisioning and group `/setup` should resolve through `configContextId` rather than thread-derived `storageContextId` whenever config or workspace state is read or written.

## Section 7: Runtime Message Behavior

Normal message processing in groups must no longer be a provisioning trigger.

Behavior for group messages:

- if group is not allowlisted, reject usage
- if group is allowlisted, apply group-admin default access plus `group_members` overrides
- if the group lacks required Kaneo configuration, tell the user to use DM `/setup` for that group
- do not attempt to provision a group Kaneo account from the message orchestrator

User-focused provisioning behavior for DMs may remain unchanged.

## Section 8: Error Handling

### Group not allowlisted

If a user selects or targets a group that is known and manageable but not allowlisted:

- block setup
- reply with a clear message that the bot admin must first run `/group add <group-id>` in DM

### Provisioning failure

If Kaneo provisioning fails during first-time group setup:

- reply only in DM to the initiating admin
- do not leak partial credentials into group contexts
- do not claim the group is configured
- do not continue into the normal setup wizard unless provisioning succeeded in the branch that requires it

### Existing configuration

If Kaneo credential and workspace already exist for the group config context:

- treat setup as an ordinary subsequent setup run
- do not provision again

### Stale admin observation

Manageable-group discovery is observational and may be stale. Setup authorization must check the current authorization outcome at execution time and not rely solely on the cached discovery list.

## Section 9: Testing

Add coverage for:

- admin DM `/group add`, `/group remove`, `/groups`
- DM-only and admin-only enforcement for those commands
- non-allowlisted group rejection in auth
- allowlisted group admin default access
- allowlisted non-admin fallback to `group_members`
- group `/setup` blocked when group is not allowlisted
- first-time allowlisted group `/setup` with auto-provisioning enabled: provision, DM credentials, stop before wizard
- first-time allowlisted group `/setup` with auto-provisioning disabled: provision, DM credentials, continue into wizard
- second and later `/setup`: no provisioning, regular wizard only
- credentials delivered only to the initiating group admin
- config and workspace writes bound to group config context rather than thread context
- regression coverage for existing `/group adduser` flows
- regression coverage for existing `/user add` provisioning flows
- regression coverage proving ordinary group messages no longer trigger group provisioning

## Section 10: Implementation Notes

- Prefer a new dedicated authorization module for allowlisted groups rather than overloading `groups.ts`
- Keep `known_group_contexts` and `group_admin_observations` as discovery metadata only
- Split provisioning decision logic from low-level Kaneo provisioning mechanics so setup can own the group-specific branch rules cleanly
- Keep user-facing messaging concise and explicit about whether the admin should expect credentials, the wizard, or both

## Open Decisions Resolved In This Design

- `/group add <group-id>` lives under the existing admin DM surface
- only the initiating group admin receives provisioned credentials
- allowlisted groups admit platform group admins by default
- non-admin group members still require `/group adduser`
- admin DM surface ships with `/group add`, `/group remove`, and `/groups`
