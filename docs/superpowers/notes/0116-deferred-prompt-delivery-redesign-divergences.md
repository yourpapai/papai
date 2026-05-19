# ADR-0116: Deferred Prompt Delivery Redesign — Divergence Notes

> Companion document to ADR-0116. Captures deviations between the original proactive group messaging design spec (2026-04-13), its implementation plan (2026-04-16), and the actual implementation. The spec and plan were superseded by a redesign (2026-04-19) before implementation began.

---

## Deviation 1: Original spec and plan were entirely abandoned

| Field        | Value                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan**     | `docs/superpowers/plans/2026-04-16-proactive-group-messaging.md`                                                                                                                                                                                                                                                                                                                      |
| **Spec**     | `docs/superpowers/specs/2026-04-13-proactive-group-messaging-design.md`                                                                                                                                                                                                                                                                                                               |
| **Expected** | Implementation of `DeliveryTarget` type with flat `contextId`/`contextType`/`createdByUserId` fields; migration #023 renaming `user_id`→`context_id` on all 3 tables; no mention/thread/audience features                                                                                                                                                                             |
| **Actual**   | The 2026-04-13 spec and 2026-04-16 plan were never executed. A redesigned spec (`2026-04-19-deferred-prompt-delivery-design.md`) was written 6 days later and implemented instead.                                                                                                                                                                                                    |
| **Why**      | The original approach was too simplistic. It did not address: thread-level delivery inside group topics, audience semantics (`personal` vs `shared`), deterministic `@mention` behavior, or the separation of creator identity vs delivery destination. The team realized these were non-negotiable for real group usage (Mattermost topics, Telegram forums) and rewrote the design. |
| **Impact**   | All code referenced in the 2026-04-16 plan (`src/db/migrations/023_...`, `tests/chat/delivery-target.test.ts`, etc.) does not exist. The migration number that was actually used is #025, with a different schema and different column set.                                                                                                                                           |
| **Correct?** | Intentional — the redesign addressed gaps the original spec papered over. The original spec is archived for historical reference only.                                                                                                                                                                                                                                                |

---

## Deviation 2: `task_snapshots` migration was never performed

| Field              | Value                                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 2 (migration) and Task 9 (snapshots module)                                                                                                                                                                                                                                               |
| **Spec reference** | §Database Migration: "`task_snapshots` — Rename `user_id` → `context_id`"                                                                                                                                                                                                                      |
| **Expected**       | `task_snapshots.user_id` column renamed to `context_id`; all snapshot functions use `contextId`                                                                                                                                                                                                |
| **Actual**         | Migration #025 touched only `scheduled_prompts` and `alert_prompts`. `task_snapshots` still uses `user_id` column. Functions `getSnapshotsForUser(userId)` and `updateSnapshots(userId, tasks)` retain the old signature.                                                                      |
| **Why**            | Snapshots are tied to the **creator's** task provider and credentials, not the delivery context. A group alert uses the creator's task tracker config to fetch tasks. Renaming would incorrectly suggest group-scoped snapshots, but the underlying provider identity is still creator-scoped. |
| **Impact**         | Snapshot isolation still works correctly in practice because alert polling groups by `createdByUserId` and fetches tasks once per creator. The `userId` parameter correctly represents the credential owner.                                                                                   |
| **Correct?**       | Acceptable — the semantic mismatch is managed by the poller grouping logic. If group-scoped credentials are introduced later, this column should be re-evaluated.                                                                                                                              |

---

## Deviation 3: Alert poller still groups by `createdByUserId`, not by delivery target

| Field              | Value                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan task**      | Task 11 (poller)                                                                                                                                                                                                                                                                                                                                       |
| **Spec reference** | §Poller Changes: "Same grouping by `DeliveryTarget`" for alerts                                                                                                                                                                                                                                                                                        |
| **Expected**       | `pollAlertsOnce` groups alerts by delivery target (`contextId` + `contextType`), builds provider from target config, and sends to target                                                                                                                                                                                                               |
| **Actual**         | `pollAlertsOnce` groups by `createdByUserId` (`byUser` Map). Task fetching and snapshots use the creator's user ID. Only `sendMessage` uses the alert's stored delivery target.                                                                                                                                                                        |
| **Why**            | Task provider credentials are owned by the creator, not the group. Multiple alerts in different groups but from the same creator should share a single task fetch to avoid redundant API calls. Grouping by delivery target would require credential lookup per group, which the system does not support (no group-scoped task provider config today). |
| **Impact**         | Alerts for the same creator in different groups share one task fetch, which is efficient. Each alert still fires to its correct delivery target. The only risk is if a creator has alerts targeting a group where the creator's credentials differ from the DM credentials, but this is not supported today.                                           |
| **Correct?**       | Acceptable for current architecture. Group-scoped credentials were explicitly out-of-scope per spec §Not In Scope. If added later, the poller grouping would need refactoring.                                                                                                                                                                         |

---

## Deviation 4: Tool CRUD (`list`, `get`, `update`, `cancel`) remains creator-scoped

| Field              | Value                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan task**      | Task 10 (tool handlers) and Task 14 (tool wrappers)                                                                                                                                                                                                      |
| **Spec reference** | §Tool Handler Changes: "executeList", "executeGet", "executeUpdate", "executeCancel" receiving context parameters                                                                                                                                        |
| **Expected**       | All deferred prompt tools accept `contextId`, `contextType`, `createdByUserId` from the message pipeline                                                                                                                                                 |
| **Actual**         | Only `create_deferred_prompt` receives delivery context. `list_deferred_prompts`, `get_deferred_prompt`, `update_deferred_prompt`, and `cancel_deferred_prompt` still take only `userId` (the creator).                                                  |
| **Why**            | List/get/update/cancel are owner-scoped operations today — a user can only manage their own prompts. If a user creates a group prompt, only they can see/cancel it. This is the intended behavior; group-shared prompt management was not a requirement. |
| **Impact**         | Low — the spec's "context-aware CRUD" was over-designed for the actual use case. Creator-scoped ownership is sufficient.                                                                                                                                 |
| **Correct?**       | Yes — aligns with "Permissions: Any authorized user can create/manage prompts in a group" from spec. Each user manages their own prompts regardless of where they were created.                                                                          |

---

## Deviation 5: Domain types use nested `deliveryTarget` instead of flat fields

| Field              | Value                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan task**      | Task 6 (domain types)                                                                                                                                                                                                                                  |
| **Spec reference** | §Deferred Prompt Domain Types: flat `contextId`, `contextType`, `createdByUserId` on `ScheduledPrompt`/`AlertPrompt`                                                                                                                                   |
| **Actual**         | Domain types have `createdByUserId` (flat) and `deliveryTarget: DeferredPromptDelivery` (nested object containing `contextId`, `contextType`, `threadId`, `audience`, `mentionUserIds`, etc.).                                                         |
| **Why**            | The nested structure prevents field-name collision (`createdByUserId` vs `deliveryTarget.contextId`) and keeps the delivery contract reusable (`DeferredPromptDelivery` is shared between DB row mappers, tool handlers, pollers, and chat providers). |
| **Impact**         | Positive — cleaner API. The `deliveryTarget` object is passed directly to `chat.sendMessage()`, avoiding parameter list bloat.                                                                                                                         |
| **Correct?**       | Yes — an improvement over the spec.                                                                                                                                                                                                                    |

---

## Deviation 6: Migration added 7 new columns, not just 2

| Field              | Value                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plan task**      | Task 2 (migration)                                                                                                                                                                                                 |
| **Spec reference** | §Database Migration: add `context_type` and `created_by_user_id`                                                                                                                                                   |
| **Actual**         | Migration #025 renamed `user_id`→`created_by_user_id` and added `created_by_username`, `delivery_context_id`, `delivery_context_type`, `delivery_thread_id`, `audience`, and `mention_user_ids` (7 columns total). |
| **Why**            | Thread targeting, audience control, and mention targeting were added during redesign as first-class features. Storing them as columns rather than JSON blobs keeps them queryable and indexable.                   |
| **Impact**         | More database schema surface, but enables deterministic per-provider rendering of mentions and thread routing at fire time without re-computing audience classification.                                           |
| **Correct?**       | Yes — the additional columns are actively used by all three chat providers.                                                                                                                                        |

---

## Deviation 7: Spec file paths in ADR-0116 references do not match archive locations

| Field        | Value                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Location** | ADR-0116 §References                                                                                                                                                          |
| **Expected** | References point to `docs/superpowers/specs/2026-04-19-deferred-prompt-delivery-design.md` and `docs/superpowers/plans/2026-04-19-deferred-prompt-delivery-implementation.md` |
| **Actual**   | Files were archived to `docs/archive/` during a post-implementation cleanup.                                                                                                  |
| **Why**      | Standard archive procedure after acceptance.                                                                                                                                  |
| **Impact**   | Broken references in the ADR until corrected.                                                                                                                                 |
| **Correct?** | To be fixed in ADR-0116 update.                                                                                                                                               |

---

## Summary

| Area                  | Spec (2026-04-13)                                | Plan (2026-04-16)        | Actual Implementation                                                                              |
| --------------------- | ------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `DeliveryTarget`      | 2 fields (`contextId`, `contextType`)            | Flat type                | 7 fields (`DeferredDeliveryTarget`)                                                                |
| Domain types          | Flat `contextId`/`contextType`/`createdByUserId` | Flat fields              | Nested `deliveryTarget` + flat `createdByUserId`                                                   |
| Migration             | Rename `user_id`→`context_id` on 3 tables        | Migration #023           | Rename to `created_by_user_id`, add 5 delivery columns; migration #025; `task_snapshots` untouched |
| Thread targeting      | Explicitly "not in scope"                        | Not mentioned            | First-class feature via `deliveryThreadId`                                                         |
| Audience/mentions     | "No system-level mentions"                       | Not mentioned            | Full `audience` + `mentionUserIds` system                                                          |
| Alert poller grouping | By `DeliveryTarget`                              | By `DeliveryTarget`      | By `createdByUserId` (efficient credential sharing)                                                |
| Tool CRUD             | Context-aware parameters                         | Context-aware parameters | Creator-scoped (only `create` gets delivery context)                                               |
