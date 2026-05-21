<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Authorized User Ownership Refactor Note

## Current State

- `users` currently represents authorized bot users.
- `group_members` can contain group-only members who are not authorized bot users.
- Several tables use `user_id` as a storage or context key rather than a guaranteed foreign key to `users.platform_user_id`.

## Why This Matters

- We can safely add foreign keys for recurring-task ownership today because recurring templates are created for real chat user IDs.
- We cannot safely add the same `users` foreign key to group membership, history, memory, config, memo, or deferred-prompt tables without breaking current behavior.

## Required Follow-up Refactor

We need a clearer ownership model that distinguishes:

- authorized bot users
- group-only members
- storage and configuration contexts

## Target Outcome

- `removeUser` should be able to remove all data that truly belongs to an authorized user.
- Group-only membership records should remain independent from authorization.
- Context-scoped data should reference an explicit context owner model instead of overloading `user_id`.

## Guidance For Future Work

- Introduce separate parent concepts for authorization, membership, and storage ownership.
- Migrate tables away from ambiguous `user_id` semantics before adding broader foreign keys.
- Revisit full authorized-user data deletion only after those ownership boundaries are explicit.
