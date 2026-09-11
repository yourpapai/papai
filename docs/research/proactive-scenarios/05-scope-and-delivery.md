<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Scope, Delivery, and Multi-Platform Behavior

> **Workstream:** WS-E — scope, delivery, and multi-platform behavior
> **Status:** Research artifact; not an implementation commitment
> **As of:** 2026-07-19
> **Scope:** Current deferred prompts, external notify, announcements, and chat adapters. This
> report defines the delivery constraints that any scenario in `01-scenario-catalogue.md` must
> satisfy; it does not choose the roadmap or the notification-control data model.

## 1. Verdict

papai has a coherent happy-path address model: a stored deferred target carries the exact live
conversation bucket, `resolveDeliveryPlatformInstanceId()` resolves an active platform instance,
`ChatRouter.sendMessage()` selects that instance, and the adapter uses native user/channel/thread
identifiers. The model correctly separates group-shared configuration from thread-scoped delivery
and history. It is adequate for best-effort, explicitly user-authored reminders.

It is not yet a trustworthy general proactive delivery layer. Four requested suspected gaps are
**verified current defects or gaps**, not inferences:

1. **Kontur Talk DM delivery is a false success.** `KonturTalkChatProvider.sendMessage()` logs and
   returns `void` without sending for a DM. `ChatRouter.sendMessage()` and then
   `sendProactiveMessage()` interpret every result other than literal `false` as success. A scheduled
   prompt is finalized, or an alert's cooldown/snapshots advance, even though no user saw a message
   (`src/chat/kontur-talk/index.ts`, `KonturTalkChatProvider.sendMessage`;
   `src/chat/router.ts`, `ChatRouter.sendMessage`; `src/deferred-prompts/proactive-delivery.ts`,
   `sendProactiveMessage`; `src/deferred-prompts/poller.ts`,
   `executeScheduledPromptsForGroup`/`executeSingleAlert`).
2. **The actual group actor is not durably represented and full-mode execution uses the group owner
   key as `chatUserId`.** Group prompt CRUD is intentionally keyed by the group config context, while
   the creator's real user ID exists only in the transient delivery input and mention list. The row
   has no separate actor-ID column. `rowToDeliveryTarget()` reconstructs `createdByUserId` from the
   group-scoped owner column, and the poller passes that same owner key into `buildFullToolSet()` as
   the actor (`src/tools/provider-independent-tools-builder.ts`, `getStorageOwnerId`;
   `src/tools/create-deferred-prompt.ts`, `makeCreateDeferredPromptTool`;
   `src/deferred-prompts/scheduled.ts`, `createScheduledPrompt`;
   `src/deferred-prompts/delivery-target.ts`, `rowToDeliveryTarget`;
   `src/deferred-prompts/poller.ts`, `promptToExecCtx`/`alertToExecCtx`;
   `src/deferred-prompts/proactive-llm-full.ts`, `buildFullToolSet`).
3. **No firing-time authorization, group membership, blocked-user, group authorization, or guest-role
   check occurs.** The reactive ingress calls `checkAuthorizationExtended()`. The pollers instead
   select active prompt rows, resolve provider/config and platform activity, generate, and send. They
   do not call `isAuthorizedGroup()`, `isGroupMember()`, `isBlocked()`, or the guest filter. Removing a
   member, blocking a DM user, revoking a group, or converting a former member into a guest does not
   cancel or restrict an existing prompt (`src/auth.ts`, `checkAuthorizationExtended` versus
   `src/deferred-prompts/poller.ts`; removal functions only delete their own auth rows in
   `src/groups.ts` and `src/authorized-groups.ts`).
4. **Normal deferred LLM output is persisted before confirmed delivery.** Lightweight, context, and
   full execution append SDK response messages before `dispatchExecution()` returns to the poller;
   send happens afterward. A failed send leaves an unseen assistant/tool turn in history. A verifier
   can also change the final text after the persisted raw response, so successful history need not
   equal the message delivered. Direct failure notices, `/api/notify`, and announcements use the
   safer send-then-record order (`src/deferred-prompts/proactive-llm.ts`, `invokeLightweight`,
   `invokeWithContext`, `runFullGeneration`; `src/deferred-prompts/proactive-llm-helpers.ts`,
   `persistLightweightResponse`/`persistContextResponse`/`persistProactiveResults`;
   `src/deferred-prompts/poller.ts`; `src/proactive-history.ts`, `recordProactiveInHistory`).

Consequences explicitly labeled **inference** below follow from these verified flows. Recommendations
are proposals and must not be read as shipped behavior.

## 2. Evidence labels and traced paths

- **Verified current** means the behavior is directly present in the cited source and symbol.
- **Verified gap/defect** means the absence or incorrect result is established by the complete
  current call path, not merely by roadmap text.
- **Inference** means a likely runtime/product consequence of verified code; it needs a focused
  reproduction before being reported as an incident.
- **Proposal** means new behavior or a new type seam.

The principal trace was:

```text
reactive authorized turn
  -> makeTools(... mode: normal, actorRole)
  -> create_deferred_prompt
  -> executeCreate(storage owner, input, real actor + storage context)
  -> buildDeliveryInput()
  -> scheduled_prompts / alert_prompts

scheduler interval
  -> pollScheduledOnce() / pollAlertsOnce()
  -> dispatchExecution(lightweight | context | full)
  -> [current: persist SDK response/history]
  -> sendProactiveMessage()
  -> resolveDeliveryPlatformInstanceId()
  -> ChatRouter.sendMessage(platformInstanceId, target, markdown)
  -> Telegram | Mattermost | Discord | Kontur Talk adapter
  -> [on reported success: finalize schedule / mark alert / advance snapshots]
```

The source search used the repository's codeindex protocol to resolve the symbols above and their
adapter implementations before individual files were read.

## 3. Scope-key glossary and invariants

### 3.1 Glossary

| Term | Exact meaning | Current source of truth |
| --- | --- | --- |
| **Native context ID** | The platform value an adapter sends to: Telegram chat ID, Mattermost channel/user ID, Discord channel/user ID, or Kontur room/user ID. It is `DeferredDeliveryTarget.contextId`. | `src/chat/deferred-target.ts`, `DeferredDeliveryTarget`; adapter `sendMessage()` methods. |
| **Platform instance ID** | DB-backed configured bot/client instance. It selects credentials and one active adapter instance. | `src/chat/router.ts`, `ChatRouter`; `src/instances/`. |
| **Scoped context ID** | Base64url-safe `pi:<instance>:ctx:<native>` address. It prevents native IDs on different platform instances from sharing state. | `src/chat/scoped-context.ts`, `toScopedContextId`/`parseScopedContextId`. |
| **Storage context ID** | Live conversation key. For Telegram/Mattermost/Kontur group threads it additionally carries `:thread:<thread>`; for a DM or group main context it is the scoped context ID. | `src/auth.ts`, `getThreadScopedStorageContextId`; `src/chat/context-scope.ts`. |
| **Config context ID** | Storage ID with the thread suffix removed. Durable group settings/assets and task/platform assignment use it. In a DM it equals the storage context ID. | `src/chat/scoped-context.ts`, `getConfigContextIdFromStorageContextId`; `ENTITY_SCOPES`. |
| **Native thread ID** | Platform thread/topic/root-post identifier. Stored separately as `target.threadId` while also encoded in a scoped storage ID where supported. | `src/chat/deferred-target.ts`; `src/deferred-prompts/delivery-target.ts`. |
| **Prompt storage owner** | The key in `scheduled_prompts.created_by_user_id` / `alert_prompts.created_by_user_id`. Despite the column name, it is group config scope for group prompts and the DM key for DMs. It controls list/get/update/cancel ownership. | `getStorageOwnerId`; `addDeferredPromptTools`; `createScheduledPrompt`/`createAlertPrompt`. |
| **Actor** | The real chat user who caused a reactive turn. Normal turns carry `chatUserId` and `actorRole`. Group deferred persistence does not currently retain a dedicated actor ID. | `src/tools/types.ts`, `MakeToolsOptions`; `src/chat/authorization-types.ts`, `ActorRole`. |
| **Delivery target** | Native context/type/thread plus audience, mention IDs, creator label fields, and optional authoritative storage address. | `src/chat/deferred-target.ts`, `DeferredDeliveryTarget`. |
| **Audience** | `personal` means group delivery with one or more mention targets; `shared` means group delivery without mentions. It does not mean DM vs group. | `src/deferred-prompts/delivery-input.ts`, `deliveryAudience`; adapter send helpers. |
| **Delivery group** | Due scheduled prompts with the same owner, native target, type, thread, audience, creator username, and sorted mention set. They are merged into one generation/send. | `src/deferred-prompts/poller-groups.ts`, `deliveryGroupKey`. |

### 3.2 Effective entity scopes

`ENTITY_SCOPES` is the declarative invariant, not the historical shape of a column
(`src/chat/context-scope.ts`):

- **Thread:** conversation history, summary/facts, task snapshots, message metadata, attachment write
  context, usage events, scheduled-prompt delivery, and alert-prompt delivery.
- **Group:** memos, recurring tasks, prompt CRUD owner, context settings, user config including
  `tool_prefs`, authorized group/member state, and most plugin state.
- **User:** provider identity mapping and web quota.
- **Group with thread override:** user instructions.

The central invariant is therefore:

> Read configuration and authorization at config scope; execute and record conversational state at
> storage scope; send using native target fields through the platform instance bound to that scope.

Current deferred delivery follows the storage/config/native split for addressing, but does not follow
the authorization half of that invariant at fire time.

### 3.3 Exact config-context → storage-context → native-target flow

#### Creation in a DM

1. `checkAuthorizationExtended()` returns a platform-scoped DM storage/config ID keyed to the user.
2. `getStorageOwnerId()` returns that same ID.
3. `buildDeliveryInput()` creates `dmTarget(realActorId)` and attaches the scoped storage ID.
4. The prompt owner, delivery storage, and actor all refer to the same person, although one is scoped
   and one is native.
5. On reload, `rowToDeliveryTarget()` decodes the native actor/user correctly.

#### Creation in a group or group thread

1. Authorization returns a thread-scoped storage ID and a thread-stripped config ID.
2. `getStorageOwnerId()` deliberately chooses the config ID, so prompt CRUD is shared among the
   group's authorized members and sibling threads.
3. `buildDeliveryInput()` parses the storage ID back into native group ID and native thread ID. The
   target retains the exact storage ID for future history/snapshot delivery.
4. Mention policy is the single audience input:
   - omitted delivery or omitted `mention_user_ids` → mention the current actor;
   - `mention_user_ids: []` → shared group message, no mention;
   - a nonempty list → personal group message mentioning exactly those IDs.
5. The row stores config owner, storage delivery ID, native thread separately, audience, mentions,
   and creator username. It does **not** store the real actor ID separately.
6. On reload, `rowToDeliveryTarget()` derives `target.createdByUserId` from the config owner. For a
   group this is the native group ID, not the creator's native user ID. This is the actor-loss defect.

#### Firing and provider resolution

1. Scheduled rows are selected by due time; alerts are selected by active/cooldown state.
2. Alert task-provider resolution strips delivery storage to config scope before
   `buildProviderFn(configContextId)`; snapshots remain in the delivery storage bucket.
3. `resolveDeliveryPlatformInstanceId()` looks for `context_settings` at config scope first, then
   legacy/storage scope, then falls back to the platform instance encoded in the scoped storage ID.
4. `resolveProactivePlatformInstanceId()` also requires the routed instance to exist and be active
   when the chat object exposes router lookups.
5. `ChatRouter.sendMessage()` repeats the active/known check and invokes only that instance's adapter.
6. The adapter uses native `contextId`/`threadId`, not the scoped storage key.

This dual representation is necessary: passing a scoped ID as Mattermost `channel_id`, Telegram
`chat_id`, or Discord channel ID would be invalid. It is also hazardous if the two halves can drift;
§10 enumerates those cases.

### 3.4 Scope invariants a candidate must preserve

1. A candidate owns one canonical, validated scoped storage ID; native fields must be derived from or
   validated against it, never accepted as unrelated strings.
2. Thread stripping is allowed only for config lookup, provider assignment, and group-shared policy.
   It must never silently redirect delivery/history to the main group.
3. Platform-instance selection and native target type must remain compatible from candidate creation
   through delivery.
4. DM candidates are personal by construction. `audience` and mention lists have no DM meaning.
5. A group personal candidate without at least one valid mention is not equivalent to a shared
   candidate and must not silently degrade to one.
6. Creator/owner/audience are three different concepts and require different fields.
7. A broadcast is a set of independently receipted single targets, not a special context scope.

## 4. Actor, owner, guest, membership, and tool permissions

### 4.1 Prompt ownership is group-shared

**Verified current:** group prompt CRUD uses the config-context storage owner. Any normal member or
admin whose turn receives the deferred tools operates on the same owner key and can list, get, update,
or cancel prompts created by another member. This is consistent with group-shared durable assets, but
it is a product rule that must be visible in settings and audit UI; it is not individual ownership
(`getStorageOwnerId`, `addDeferredPromptTools`, and the CRUD `createdByUserId` predicates).

Guests receive the fixed read-risk tool set. `list_deferred_prompts` and `get_deferred_prompt` are read
risk, so guests can inspect group-shared prompt definitions; create/update/cancel are write or
destructive and are removed. This follows the current broad guest read-only contract
(`src/tools/index.ts`, `applyGuestReadOnlyFilter`; `src/tools/tool-metadata.ts`, `TOOL_METADATA`).

**Product implication:** do not store private personal/calendar details in group-owned prompt text if
guest mode can be enabled. A future per-user proactive subscription should use a separate personal
owner and DM target, not overload the group-owned prompt table.

### 4.2 Full-mode actor identity defect

For a normal reactive group turn, `storageContextId` is the group/thread and `chatUserId` is the real
person. For a proactive full run, `prompt.createdByUserId` is the config owner and is passed as
`chatUserId` to `makeTools()` and plugin runtime. In a group this is a group address, not a person.

Verified direct effects are:

- per-user identity-sensitive tool construction receives the wrong ID;
- plugin tool runtime receives the wrong `chatUserId`;
- the reconstructed target cannot reliably label “the creator” from ID equality;
- no persisted field can support firing-time creator membership/block checks.

**Inference:** provider identity resolution, “me”, collaboration operations, user quotas, or plugin
guardrails may resolve incorrectly or operate as a shared pseudo-actor in a group full run. Each tool
needs a reproduction before claiming a specific unauthorized provider mutation, but the input
identity itself is provably wrong.

Required conceptual fields are:

- `ownerScopeId`: who can administer the automation (group or user);
- `actorUserId`: the real principal whose authority/identity tools use;
- `deliveryStorageContextId`: where the message and live context belong;
- `audiencePrincipalIds`: who the content is for.

### 4.3 No execution-time authority revalidation

The creation turn is authorized. The later firing turn is not. Current pollers verify only prompt
state/cooldown, provider availability, and platform instance availability. Consequently:

| State change after creation | Verified current behavior | Required rule |
| --- | --- | --- |
| DM user becomes blocked | Deferred prompt remains active and delivery is attempted. | Suppress/cancel before generation; do not DM a blocked principal. |
| Group member is removed | Group prompt remains and can execute full tools because actual actor is not checked. | Revalidate actor membership/admin role for actor-authorized runs. |
| Former member becomes an unrecognized guest while guest mode is on | Proactive full run still uses normal group `tool_prefs`, not guest read-only filtering. | Either cancel actor-owned work or apply guest role; never elevate a guest. |
| Guest mode toggles | Existing prompt execution is unchanged. | Guest mode alone must not broaden or narrow group-owned service automation accidentally; actor policy must be explicit. |
| Group authorization is revoked | Prompt rows are not cascaded or cancelled; send is still attempted if routing remains. | Suppress and quarantine all group candidates before provider/LLM calls. |
| Mentioned member is removed | Message can still send with stale mention ID, platform-dependent. | Revalidate audience or require explicit shared fallback policy. |
| Creator loses provider workspace access | Core still builds the group task provider; per-user authority is not rechecked. | Bind execution to an explicit service principal or verified actor principal. |

These are release blockers for product-authored full-mode scenarios, particularly any mutating
scenario. Pure fixed-text reminders are lower risk but still must respect blocked/revoked targets.

### 4.4 `tool_prefs` at creation and firing

`tool_prefs` are group/config-scoped, even when the storage context is a group thread.
`applyToolPreferences()` strips the thread before loading preferences and applies precedence:
tool override → domain default → risk default → allow.

- **Creation turn:** deny removes `create_deferred_prompt`; ask invokes the interactive permission
  flow; allow exposes it normally. Guests bypass preferences and cannot create because the tool is
  write risk.
- **Firing full run:** preferences are re-read at fire time. Denied tools are absent. Allowed tools can
  run. Ask tools are present but `buildFullToolSet()` supplies no `askPermission` function, so every
  invocation returns structured `permission_denied`: “no chat surface is available.” The system
  prompt is built with `askPermissionAvailable: false` (`applyToolPreferences`, `gatedExecute`,
  `buildFullSystemPrompt`).
- **Security conclusion:** current full execution does not bypass deny/ask. Ask fails closed.
- **Product conclusion:** changing a tool from allow to ask can make a previously valid automation
  fail at fire time; there is no preflight warning. Changing it to allow can newly permit an old
  stored prompt to perform a write. Tool permissions are necessary but not a substitute for actor
  revalidation or candidate-level authority.
- **Guest conclusion:** guest filtering is never applied to proactive firing, because there is no
  `actorRole` in `DeferredExecutionContext`. This is safe only if every firing is treated as an
  explicitly authorized group service principal; current data and UI do not establish that model.

## 5. Per-platform delivery matrix

“Actions” below distinguishes adapter capability from the current proactive path. All current
`ChatProvider.sendMessage()` calls carry markdown only. Even on platforms with buttons, no proactive
candidate ID or buttons are sent, and `routeInteraction()` handles only `perm:a:`/`perm:d:`; all other
callback prefixes are a safe-sink no-op (`src/chat/interaction-router.ts`, `routeInteraction`).

| Dimension | Telegram | Mattermost | Discord | Kontur Talk |
| --- | --- | --- | --- | --- |
| **Observed group input** | All group messages are observed; bot logic still applies mention/reply gating. | All group messages observed; normal group mention gate applies. | Adapter observes DMs and bot mentions/replies only (`mentions_only`). | All group messages observed; normal mention gate applies. |
| **DM target** | Numeric native user/chat ID passed to Bot API. Bot must be able to message the user. | Opens/gets direct channel from bot user + target user, then posts. | Fetches user, creates DM, sends sequential chunks. | **Unsupported but falsely reported successful:** warns and returns `void`. |
| **Group target** | Native chat ID. | Native channel ID. | Native channel ID; must resolve to a sendable channel. | Native room ID. |
| **Thread model** | `supportsThreads`; native message/forum thread ID in `message_thread_id`. Config is group-shared, storage/history thread-scoped. | `supportsThreads`; root post ID in `root_id`. Same config/storage split. | `supportsThreads:false`; no `threadId`. Every observed Discord channel ID (including a thread channel) is a standalone group context, not a child scope sharing parent-channel config. | `supportsThreads`; native message thread in `thread_id`. Same config/storage split. |
| **Personal group audience** | Builds `text_mention` entities for numeric IDs. Invalid IDs are silently omitted. Creator label equality is affected by group actor-loss. | Resolves IDs to usernames; failed lookups are dropped. If none resolve, falls back to `createdByUsername`, even when an explicit different target list was requested. | Prepends literal `<@id>` tokens. IDs are not prevalidated. | Ignores target audience and always sends `mentions: []`. |
| **Shared group audience** | No mention prefix. | No mention prefix. | No mention prefix. | No mention prefix (same as every send). |
| **Declared max length** | 4,096. | 16,383. | 2,000. | 4,096. |
| **Current proactive chunking** | None; one formatted Bot API send. Mention prefix also consumes length. | None; one post after mention construction. | Yes; fence-aware sequential chunks. Mention prefix is included before chunking. | None; one API send. |
| **Markdown/rendering** | Markdown converted to text + Telegram entities; tables flattened. | Markdown posted as Mattermost message. | Markdown content posted directly. | `format:'markdown'`. |
| **Adapter callbacks/buttons** | Callbacks/buttons/ephemeral supported; callback data max 64. | Callbacks/buttons/ephemeral supported; max five buttons and callback URL requires settings public URL. | Callbacks/buttons/ephemeral supported; callback data max 100. | No callbacks/buttons/ephemeral capability. |
| **Current proactive actions** | None. | None. | None. | None. |
| **Reactive live status** | Implemented through `ReplyFn.createStatus`. | Implemented. | Implemented. | Not implemented; no edit/delete surface. |
| **Proactive live status** | None: proactive generation has no `ReplyFn`. | None. | None. | None. |
| **Reported success** | Adapter resolves `void` after Bot API accepts its one send; router converts to `true`. | Resolves after all required API calls; router converts `void` to `true`. | Resolves only after every chunk sends; router converts `void` to `true`. | Group resolves after response schema parses. DM returns `void` without a call and is converted to `true`. |
| **Failure shape** | API/format/invalid target throws. | DM channel/post, mention-independent group post, or API parse throws; mention lookup failures alone are swallowed. | Missing client, user/DM failure, unsendable channel, or any chunk failure throws. | Group API/schema error throws; DM does not expose failure. |
| **Partial visibility risk** | One call: none from chunking. | DM channel creation may succeed before post fails, but no message is visible. | Earlier chunks remain visible if a later chunk throws; retry currently regenerates/resends from the beginning. | One group call. |

Evidence: platform metadata in `src/chat/{telegram,mattermost,discord,kontur-talk}/metadata.ts`;
thread capabilities and provider sends in each adapter's `index.ts`; Telegram mention/render helpers in
`src/chat/telegram/reply-helpers.ts` and `format.ts`; Mattermost target send in
`src/chat/mattermost/reply-helpers.ts` plus mention lookup in `file-helpers.ts`; Discord send/chunking
in `src/chat/discord/send-message.ts` and `format-chunking.ts`; Kontur send in
`src/chat/kontur-talk/index.ts`.

### 5.1 Platform-specific conclusions

#### Telegram

- Exact thread return is available and should be mandatory when a candidate originated in a forum
  topic.
- A “personal” audience can become visually unaddressed if every mention ID is nonnumeric or stale;
  the adapter still reports success. Delivery receipt needs a mention-resolution result.
- No long-content product (briefing, weekly review, digest) may rely on the declared 4,096 trait
  without proactive chunking. Formatting can change the final text length.

#### Mattermost

- DM delivery is two network operations and group personal delivery adds per-mention user lookups.
- The fallback to creator username after all requested target lookups fail can mention the wrong
  person. Personal delivery must fail or explicitly downgrade per policy, never substitute a
  different audience.
- Thread delivery is exact through `root_id`; a deleted/inaccessible root must not fall back to the
  channel main context.

#### Discord

- Output chunking is the strongest current large-message behavior, but it has no resumable receipt.
  A later-chunk failure makes a whole-send retry duplicate earlier visible chunks.
- No separate `threadId` exists. A Discord thread channel is its own context ID; features that expect
  group-shared settings across parent/sibling Discord threads do not receive that behavior.
- An explicit notify payload with parent channel + `threadId` cannot force Discord thread delivery;
  the adapter ignores `threadId`. The caller must target the actual Discord thread channel ID.

#### Kontur Talk

- DM proactivity is unavailable today and must be capability-rejected before execution.
- Group personal delivery is also unavailable because mentions are always empty. A candidate
  addressed to one person would become a shared room message, which is a privacy failure, not a
  graceful fallback.
- Thread group delivery works. Buttons, callback actions, and live status do not.

## 6. Group and DM product rules

### 6.1 DM rules

1. A DM candidate has exactly one audience principal whose native user ID matches the target.
2. Firing requires current DM authorization and nonblocked state, unless a separately documented
   operator emergency path intentionally bypasses user access. Deferred prompts have no such bypass.
3. If a platform cannot DM, suppress as `unsupported`; never redirect private content to a group.
4. Personal quiet hours/mute/features belong to the user/config context. Group admin policy cannot
   override them for a DM.
5. Calendar content and inferred personal planning should default to DM.

### 6.2 Group and thread rules

1. A prompt created in a group remains in that native group and exact originating thread. Current
   `deliveryPolicySchema` explicitly says group reminders never redirect to DM.
2. Default group audience is the requester mention, not the whole room. Shared delivery requires an
   explicit empty mention list or a product-owned group-broadcast configuration.
3. Personal group content must have a verified mention-capable platform and at least one current,
   eligible audience member. Otherwise hold/fail; do not silently send shared.
4. Group-owned prompt CRUD is collaborative. The UI must show creator/audit information and make
   cross-member cancellation intentional.
5. On Telegram, Mattermost, and Kontur, group config and task-provider assignment are shared across
   sibling native threads; conversation history, snapshots, and delivery are not. Discord has no
   parent-thread normalization, so each observed thread channel is an independent group/config
   context. In every case, a group-level product candidate must choose a deliberate exact target
   rather than using config scope as a send address.
6. User-private calendar events, personal workload, or individual performance data must not be put in
   a group candidate without explicit scope and redaction policy.
7. If the original thread is gone, delivery fails. No automatic main-channel fallback.
8. Mentioned users do not become automation owners. Owners, actors, and audiences remain separate.

### 6.3 Broadcast rules

1. Expand a broadcast into per-target candidates before delivery.
2. Apply opt-in and authorization independently per recipient.
3. Store one receipt/idempotency key per `(broadcast, canonical target)`.
4. Bound concurrency and isolate failures; a single target cannot fail the entire fan-out.
5. Shared broadcast copy must not use one recipient's context/history or tool identity.

## 7. Delivery and history lifecycle

### 7.1 Current normal-success order

For all LLM modes the effective order is:

1. generate, including any full-mode tool side effects;
2. persist SDK response messages, facts, and possibly start background trim/memory extraction;
3. optionally run completion verification and choose final delivery text;
4. adapter send;
5. on reported success, finalize scheduled row or mark alert triggered/advance snapshots.

This ordering creates three verified inconsistencies:

- **ghost history:** adapter failure after step 2 leaves content the user never saw;
- **nonfaithful history:** verifier output at step 3 can differ from persisted raw messages;
- **retry amplification:** a later poll regenerates, appends another response, and may repeat full-mode
  side effects before attempting delivery again.

### 7.2 Current failure/direct-send order

- If generation throws, the poller builds a fixed error message, sends it, then calls
  `recordProactiveInHistory()` and finalizes/marks only after reported success.
- `/api/notify`, release announcement sends, manual broadcasts, and release-review notices also record
  their final markdown after reported success.
- `recordProactiveInHistory()` itself documents send-first use and best-effort persistence.

Therefore the safer primitive already exists; normal LLM execution simply bypasses it by persisting
inside the generation helpers.

### 7.3 Required lifecycle

**Proposal:** separate records and order them explicitly:

```text
candidate pending
  -> authority/policy checked
  -> atomically claimed for execution
  -> generated artifact stored (not conversation history)
  -> delivery attempted
  -> typed receipt stored
  -> if fully delivered: append exactly delivered assistant content to history
  -> finalize source prompt/event and release claim
```

Tool traces needed for audit may be stored separately from conversational history. If conversation
continuity needs tool results, append them together with the final delivered assistant message only
after a full receipt, or represent an explicit failed/partial delivery event that the next model can
understand without pretending the user saw it.

## 8. Failure, retry, and idempotency

### 8.1 Current semantics

| Failure point | Scheduled prompt | Alert | User-visible/idempotency consequence |
| --- | --- | --- | --- |
| Platform instance missing/inactive before generation | Returns without generation or finalization. | Matched state is not evaluated/advanced for that context. | Regular poll retries indefinitely after recovery; no backoff/expiry. |
| Provider unavailable for alerts | No task evaluation/snapshot update. | Same. | Five-minute retry; no user notice. |
| Generation throws | Fixed error is sent; on success prompt is finalized/advanced or alert marked. | Same. | User sees failure once per firing/cooldown; raw exception text can leak detail. |
| Adapter returns `false` | Not finalized. | Not marked; snapshots not advanced for a matched alert. | Retry on next regular poll. Built-in adapters normally throw or return void; router emits false mainly for inactive/unknown. |
| Adapter throws | Per-group/alert promise is rejected and logged through `allSettled`. | Same. | Poll top-level usually resolves, so scheduler retry machinery does not run; next regular poll retries. |
| Process crashes after send, before finalization | Row remains due. | Cooldown/snapshot edge remains old. | Duplicate message and potentially duplicate tool effects after restart. |
| Process crashes after generation/history, before send | Row remains due; ghost history exists. | Same. | Retry adds another generation/history entry. |
| Kontur DM no-op | Finalized as success. | Marked and snapshots advance. | Permanent silent loss. |
| Discord later chunk throws | Row remains due. | Remains eligible. | Earlier chunks are visible but unreceipted; retry duplicates them. |

### 8.2 Scheduler retry is not delivery retry

The central scheduler has three retries with exponential backoff by default. However, both pollers
wrap per-target work in `Promise.allSettled()` and only log rejected children. Their top-level handler
therefore normally resolves successfully even when every adapter send failed. The scheduler sees a
successful poll and does not invoke its retry path. Delivery retry is the next 60-second scheduled
poll or five-minute alert poll (`src/utils/scheduler.internal.ts`, `handleTaskFailure` versus
`src/deferred-prompts/poller.ts`, `pollScheduledOnce`/`pollAlertsOnce`).

### 8.3 Current idempotency boundaries

- `inFlightPrompts` prevents one scheduled prompt from being selected twice by overlapping polls in
  one process. It is process-local and not durable.
- Scheduled prompt finalization and alert cooldown/snapshot writes occur only after reported success,
  giving an at-least-once retry shape.
- There is no firing-instance ID, delivery claim, generated-output ID, adapter message ID, or atomic
  send/finalize transaction.
- Full-mode tool side effects and chat send do not share an idempotency key.
- Multiple papai processes can claim the same due row.
- Release broadcasts have a useful specialized precedent: per-recipient `(version, context)` sent or
  failed records, bounded fan-out, and later calls skip `sent`. The check and send are not an atomic
  claim, so concurrent broadcasts can still race; failures have no automatic retry.

**Conclusion:** current deferred delivery is at-least-once in intent but can be at-most-once silent on
Kontur DM, duplicate after crash, and partially delivered on Discord. No generic exactly-once claim is
possible over external chat APIs, but durable idempotency and resumable receipts can make retries
predictable.

## 9. Concurrency and burst behavior

### 9.1 Scheduled prompts

- Up to 100 due rows are selected by oldest `fireAt` per poll.
- Rows with compatible delivery keys are merged. Their prompts and briefs/snapshots are concatenated,
  and the highest execution mode wins. One full prompt therefore elevates the whole merged group.
- One poll has a shared `p-limit(5)` across delivery groups.
- `inFlightPrompts` blocks overlapping same-process polls from reusing selected IDs, but separate
  processes have independent sets.
- A backlog over 100 is delayed by at least another poll interval; slow generations can extend it.
- A quiet-hours release/digest could create a severe burst unless candidates are separately ranked
  and rate-limited; current merger is address-based, not relevance/digest based.

### 9.2 Alerts

- All active cooldown-eligible alerts are loaded without a row cap and grouped by delivery storage
  context.
- Up to ten delivery contexts execute concurrently.
- Each context creates its own `p-limit(5)` for alert LLM calls. Across ten contexts, roughly 50 LLM
  calls can run concurrently, plus provider fetch fan-out.
- Provider task fetch happens once per delivery context, not once per shared config/task instance;
  sibling threads can independently fetch the same workspace and retain different snapshots.
- Alerts have no in-flight guard. The interval scheduler uses `setInterval` and does not suppress an
  execution whose previous poll is still running. A poll exceeding five minutes can overlap and
  evaluate/deliver the same alert twice before cooldown/snapshots update.

### 9.3 Cross-path concurrency

- Proactive generation does not enter the message queue or `RunRegistry`. Multiple scheduled/alert
  runs and a normal reactive run can operate on the same storage context concurrently.
- Concurrent history appends can observe stale cached history and interleave.
- Concurrent full runs can mutate the same task provider without per-context serialization.
- Platform adapters expose no shared outbound rate limiter. Poller and announcement `p-limit`s limit
  their own sources only; simultaneous paths can exceed platform/API limits.
- Release and manual announcement fan-out use a separate concurrency limit of five.

## 10. Wrong-context and wrong-audience edge cases

The following are distinct failure classes, not one generic “send failed” bucket.

| Edge | Current behavior | Classification / required behavior |
| --- | --- | --- |
| Config assignment points to a new platform instance while stored native target came from the old one | Routing prefers current config assignment; adapter receives old native ID. | **Inference:** may fail or reach an ID collision. Validate instance/native binding; never silently migrate. |
| Scoped storage ID has no settings row | Platform instance is recovered from the encoded ID. | Correct fallback; preserve it. |
| Config row exists but is stale/wrong | Fallback is not consulted. | Treat assignment/target mismatch as unroutable and require repair. |
| `/api/notify` omits `contextType` for a non-thread group | Bare/scoped non-thread IDs are DM-shaped unless recognized as an authorized group; caller can be misrouted. | Require typed canonical target or explicit group type. |
| Notify passes a bare native context | Delivery may lack an instance assignment; if it sends, history is recorded under the caller's raw `contextId`, not normalized target storage. | Normalize once and record with canonical storage ID. |
| Notify passes DM plus `threadId` | Thread is ignored by target builder. | Reject contradictory payload instead of ignoring it. |
| Notify passes Discord parent channel plus `threadId` | Discord adapter ignores thread ID and posts to parent. | Target actual thread channel ID; reject unsupported thread field. |
| Group prompt fires after thread deletion/archive | Adapter throws and row retries indefinitely. | Retry boundedly, then mark permanent/unroutable; never main-channel fallback. |
| Group revoked after prompt creation | No auth check; delivery may continue. | Release blocker: suppress before generation. |
| DM user blocked after creation | No blocked check; delivery may continue. | Release blocker: suppress/cancel. |
| Creator removed but prompt audience is shared | Full run retains group prefs/service authority. | Require explicit group-owned service principal or cancel actor-owned run. |
| Mention user removed/unresolvable | Telegram may omit entity; Mattermost may fall back to creator; Discord emits stale mention; Kontur sends shared. | Personal audience must not count as delivered without verified mentions. |
| `audience:'personal'` with empty mention list (legacy/corrupt row) | Adapters generally send without mention; success reported. | Validate persisted target before execution. |
| Target type says DM but context ID is a group/channel | Mattermost/Discord attempt user-DM operations; Telegram sends without group/thread semantics; Kontur false-success. | Reject type/address inconsistency at candidate creation. |
| Native ID contains `:` in legacy unscoped context | Legacy parsers split at the first colon as group/thread. | Migrate to scoped/base64url IDs; reject ambiguous legacy creation. |
| Two platform instances use the same native ID | Scoped storage prevents collision only while preserved. | Candidate key must include platform instance. |
| Group main candidate is accidentally keyed by a sibling thread's storage | History and snapshots become thread-specific even though visible message is main-group if native thread is null. | Validate storage thread and native thread agree. |
| Thread target has main config but wrong native thread | Provider/prefs are valid, delivery is wrong thread. | Native target must derive from canonical storage ID. |
| Long body on Telegram/Mattermost/Kontur | Adapter throws; generation already in history. | Preflight render/chunk before attempt. |
| Discord partial chunks | Some content visible, whole send reported failed. | Receipt records sent chunk IDs and resumes/compensates. |
| Telegram formatting changes rendered text | History stores SDK markdown, platform sees converted text/entities. | Receipt/history should preserve canonical delivered markdown plus optional rendered metadata. |
| Merged prompt group contains one expired/cancelled row after selection | Selection snapshot executes all rows; no second status check before send. | Claim/revalidate rows atomically before execution. |

Wrong-context delivery involving private/task/calendar content is a privacy defect and a release
blocker, even if the platform API reports success.

## 11. Run-control and live-status implications

### 11.1 Verified current behavior

- Normal turns register one active run per storage context and support steering, graceful `/stop`,
  force abort, and honest partial-effect summaries.
- Proactive modes call `generateText()` directly with up to 25 steps and a 20-minute timeout. They do
  not create a `RunRegistry` entry or consume the normal message queue.
- A user cannot steer or stop a proactive run. `/stop` can only see a normal registered run.
- Proactive code has no `ReplyFn`, so it sends no typing heartbeat or live status on any platform.
  Telegram/Mattermost/Discord reactive status capability does not change that; Kontur lacks it anyway.

Evidence: `src/deferred-prompts/proactive-llm.ts`, all three invoke functions; compare
`src/llm-orchestrator.ts`, `processMessage`/`runTurn`, and `src/run-control/`; status surface in
`src/chat/CLAUDE.md` and each reply builder.

### 11.2 Implications

- **Inference:** a user can start a reactive turn while a proactive full run is still executing; both
  can read/write tasks and history concurrently.
- Long silent generation is poor UX even where reactive live status exists: there is no incoming user
  gesture to anchor a “thinking” status, and a 20-minute unsolicited operation is surprising.
- Product-authored proactive messages should be generation-only or read-only by default. A proactive
  candidate that proposes a write should deliver a short suggestion and wait for a normal,
  controllable user turn.
- Existing explicit user-authored full automations need a bounded background-run cancellation/admin
  surface independent of `/stop`, or a much lower step/time budget plus durable job state.
- Mutating full-mode autonomous product scenarios are blocked until actor authority, idempotency, and
  cancellation are defined.

## 12. Announcements as a contrasting broadcast path

Release announcements demonstrate several reusable delivery properties absent from deferred prompts:

- subscription is default-off for both DMs and authorized groups;
- one human-reviewed body is generated once, not once per recipient;
- fan-out is bounded to five sends;
- failures are caught per recipient;
- `(version, context)` delivery rows distinguish sent and failed, and later calls skip sent targets;
- direct history is recorded after reported send success;
- group broadcast targets are shared, main-context, no-mention messages.

The contrast also exposes limits:

- `isDelivered()` then send is not an atomic claim, so concurrent broadcasters can duplicate;
- `broadcastAt` is marked after the fan-out even when some recipients failed;
- there is no automatic retry schedule;
- the same boolean/void adapter contract and Kontur DM false success apply;
- group sends do not recheck a current platform-native audience beyond the subscribed authorized row.

Manual admin Announce is intentionally weaker: it sends to every non-placeholder authorized DM user
on one platform instance, has no opt-in, group target, or per-recipient durable idempotency record. It
does filter current user rows and counts settled failures. These paths should remain policy-distinct
from user/product candidates (`src/announcements/broadcast.ts`, `broadcastAnnouncement`;
`src/announcements/store.ts`; `src/commands/announce-broadcast.ts`, `broadcastMessage`).

## 13. Recommended typed seams

### 13.1 Candidate gateway

**Proposal:** every native proactive feature should submit a durable candidate before LLM execution or
chat send:

```typescript
type ProactiveCandidate = Readonly<{
  candidateId: string
  idempotencyKey: string
  source: 'deferred' | 'task-event' | 'calendar' | 'external' | 'announcement'
  featureId: string
  ownerScopeId: string
  actor: { platformInstanceId: string; userId: string; authority: 'user' | 'group-service' | 'operator' } | null
  configContextId: string
  storageContextId: string
  target: DeferredDeliveryTarget
  urgency: 'urgent' | 'normal'
  notBefore: string
  expiresAt: string | null
  execution: { mode: 'direct' | 'lightweight' | 'context' | 'full'; brief: string }
  lifecycle: 'pending' | 'held' | 'claimed' | 'generated' | 'delivered' | 'failed' | 'expired' | 'dismissed'
}>
```

The candidate gateway owns:

1. canonical scope/target validation;
2. current group/user/guest/blocked authorization and actor revalidation;
3. notification controls and dedup;
4. an atomic claim with lease/recovery;
5. tool-permission preflight;
6. generation artifact storage;
7. delivery through the typed receipt seam;
8. delivered-history persistence and source finalization.

External `/api/notify` can remain a trusted direct operational path, but a new typed candidate ingress
is required if external task/calendar signals should participate in quiet hours, feature toggles,
dedup, expiry, or audience validation.

### 13.2 Typed delivery receipt

Replace `Promise<boolean> | Promise<void>` with a discriminated result. One possible minimum:

```typescript
type DeliveryReceipt =
  | {
      status: 'delivered'
      platformInstanceId: string
      storageContextId: string
      nativeMessageIds: readonly string[]
      deliveredAt: string
      mentionsDelivered: readonly string[]
    }
  | {
      status: 'unsupported'
      capability: 'dm' | 'thread' | 'personal-mention' | 'actions' | 'message-length'
      reason: string
    }
  | { status: 'unroutable'; reason: 'unknown-instance' | 'inactive-instance' | 'invalid-target' | 'stale-scope' }
  | {
      status: 'retryable-failure'
      reason: string
      retryAfterMs?: number
      partialMessageIds: readonly string[]
    }
  | { status: 'permanent-failure'; reason: string; partialMessageIds: readonly string[] }
```

Requirements:

- adapters return native message IDs where available;
- a void return is impossible;
- capability checks happen before generation for unsupported DM/thread/personal delivery;
- chunk sends retain per-chunk receipts and resume only missing chunks;
- mention resolution is part of personal-delivery success;
- router distinguishes inactive/unroutable from adapter rejection;
- history/finalization requires `delivered`, not truthiness;
- logs contain typed codes and IDs, never message content/secrets.

### 13.3 Authority seam

```typescript
type AuthorityVerdict =
  | { allowed: true; actorRole: 'member' | 'group-service' | 'operator'; toolContextUserId: string }
  | { allowed: false; reason: 'blocked' | 'group-revoked' | 'member-removed' | 'guest-read-only' | 'actor-missing' }
```

The verdict must be evaluated at claim time and again immediately before any mutating full tool step
if claims can run for minutes. A group-service automation must be explicitly created/configured as
such; it cannot be inferred from the current group owner column.

## 14. Graceful degradation rules

1. **Unsupported DM:** hold/fail as unsupported and expose it in settings. Never mark delivered and
   never fall back to a group.
2. **Unsupported personal mention:** do not send shared. Offer an alternate DM only when the user
   explicitly configured it and that platform supports DM.
3. **Unsupported/deleted thread:** do not send to group main. Mark target repair required.
4. **No buttons/callbacks:** render a stable candidate reference plus concise mention-aware text
   instructions. The receiving normal turn must resolve the reference and authorize the actor.
5. **Callback-capable platform:** actions still require new callback routes and signed/bounded
   candidate IDs; do not reuse the permission-only prefix.
6. **Length overflow:** render and chunk before send. Preserve markdown fences/entities; attach action
   controls and candidate identity to a defined chunk. Record every chunk receipt.
7. **Partial chunk failure:** resume unsent chunks or present a clearly marked continuation. Never
   resend already receipted chunks blindly.
8. **Mention resolution failure:** hold personal content. A visible shared message is not success.
9. **Inactive instance/transient API failure:** bounded exponential retry with expiry and jitter;
   respect platform `retry-after` where available.
10. **Permanent target failure or blocked/revoked principal:** suppress/cancel and stop retrying.
11. **Ask-gated tool in proactive mode:** preflight as unavailable and generate a request-for-
    permission message; never attempt the tool repeatedly.
12. **No live status:** keep unsolicited generation short. Prefer direct/lightweight/read-only work;
    move writes to a reactive confirmation turn.
13. **History persistence failure after confirmed send:** do not resend the user message. Record a
    separate reconciliation job keyed by receipt.
14. **Receipt uncertainty after network timeout:** query platform message state when possible or mark
    uncertain/manual; do not assume failure and duplicate.

## 15. Release blockers

### RB-1 — Fix the Kontur DM false-success contract

Return typed `unsupported:dm` (or at minimum literal `false`) and prevent generation/finalization for
an unsupported target. Add router/poller regression tests. This blocks any scenario that can create a
Kontur DM target.

### RB-2 — Persist and revalidate the real actor/authority

Add a dedicated actor principal or explicit group-service authority. Migrate/disable ambiguous group
rows. Full proactive runs must not use a group address as `chatUserId`. This blocks all mutating or
identity-sensitive group full-mode product scenarios.

### RB-3 — Revalidate user/group/guest state at firing

Blocked DM users, revoked groups, removed members, guests, and stale audience members must be handled
before provider calls or LLM spend. This blocks expanded proactive delivery in groups and personal
DM nudges.

### RB-4 — Move conversation history behind confirmed typed delivery

Persist generated artifacts separately, append exactly delivered content after a full receipt, and
reconcile history failures without resending. This blocks relying on proactive history for dedup,
snooze/dismiss resolution, or conversation coherence.

### RB-5 — Add durable claim/idempotency and side-effect policy

Prevent multi-process duplicate claims, crash-after-send duplicates, retry duplication, and repeated
full tool effects. This blocks autonomous mutating full-mode scenarios and high-volume event sources.

### RB-6 — Validate canonical target/scope binding

Ensure platform instance, native context/type/thread, config context, and storage context agree.
Reject ambiguous notify payloads and stale platform reassignment. Wrong-context delivery of private
content is release-blocking.

### RB-7 — Support long output on every enabled target used by briefings/digests

Telegram, Mattermost, and Kontur proactive sends need preflight/chunking or strict generation caps;
Discord needs resumable partial receipts. This blocks daily/weekly digests that can exceed limits.

### RB-8 — Build end-to-end action routing before promising snooze/dismiss

Adapter capabilities alone are insufficient. Candidate IDs, authorization, callback routes, expiry,
and text fallback are required. Kontur needs a no-button flow.

### RB-9 — Constrain uncancellable proactive full runs

Until a background-job cancellation model exists, product-owned proactive work must not run long,
multi-write tool plans. Use read-only generation plus a normal confirmation turn.

## 16. Exhaustive edge-case and test matrix

The following is the minimum regression matrix for a candidate/delivery refactor. “Unit” includes
pure target/policy tests; “integration” exercises DB/router/adapters with fakes; “system” spans poll,
generation, delivery, receipt, finalization, and history.

### 16.1 Scope and target construction

| ID | Case | Expected assertion | Level |
| --- | --- | --- | --- |
| S-01 | Scoped DM creation | Owner/config/storage preserve instance; native target is actor user. | Unit + integration |
| S-02 | Telegram group main creation | Config=storage main; thread null; native chat ID decoded. | Unit |
| S-03 | Telegram forum thread creation | Config strips thread; storage and native thread preserved. | Unit + adapter |
| S-04 | Mattermost root-thread creation | Same split; adapter sends exact `root_id`. | Adapter |
| S-05 | Kontur message-thread creation | Same split; adapter sends exact `thread_id`. | Adapter |
| S-06 | Discord channel | No thread field; config=storage channel ID. | Unit |
| S-07 | Discord actual thread channel | Thread channel ID is canonical standalone context; no parent fallback. | Integration |
| S-08 | Default group delivery policy | Personal audience and actor mention. | Unit |
| S-09 | Explicit empty mention policy | Shared audience and no mentions. | Unit |
| S-10 | Explicit multiple mentions | Personal audience, stable set, native IDs round-trip. | Unit |
| S-11 | Corrupt personal+empty target | Validation rejects before generation. | Integration |
| S-12 | Storage/native thread mismatch | Validation rejects as stale/invalid target. | Unit |
| S-13 | Scoped ID fallback without context settings | Encoded platform instance routes successfully. | Integration |
| S-14 | Config row takes precedence | Same-instance valid assignment routes; mismatch is rejected. | Integration |
| S-15 | Platform reassigned after creation | Candidate becomes repair-required, never sends old native ID through new adapter. | System |
| S-16 | Duplicate native IDs on two instances | Histories, config, and receipts remain isolated. | Integration |
| S-17 | Legacy unscoped group:thread | Explicit migration behavior; colon-bearing native IDs not misparsed. | Migration + unit |
| S-18 | Group config read from sibling thread | Same prefs/provider; delivery/history remain original thread. | System |

### 16.2 Actor, ownership, authorization, guest, and tools

| ID | Case | Expected assertion | Level |
| --- | --- | --- | --- |
| A-01 | DM creator persisted | Actor native ID round-trips and is used by full tools. | Integration |
| A-02 | Group creator persisted | Dedicated actor ID round-trips; never becomes group ID. | Integration |
| A-03 | Group member lists another member's prompt | Allowed only under explicit collaborative-owner policy; creator is visible. | Product integration |
| A-04 | Group member cancels another's prompt | Audited and authorized by group-shared rule. | Integration |
| A-05 | Guest lists/gets prompt | Decision is explicit; if retained, private fields are redacted as required. | Integration |
| A-06 | Guest attempts create/update/cancel | Tools absent regardless of `tool_prefs`. | Integration |
| A-07 | Creator removed before fire | Candidate suppressed; no provider/LLM/send. | System |
| A-08 | Creator becomes guest before fire | No normal full tool set; suppress or apply guest read-only per declared policy. | System |
| A-09 | Group revoked before fire | Candidate suppressed/quarantined; no send. | System |
| A-10 | DM user blocked before fire | Candidate cancelled/suppressed. | System |
| A-11 | Mentioned user removed | Personal candidate is held/retargeted by explicit policy, never shared silently. | System |
| A-12 | Group-service automation | Explicit service authority survives member turnover and has bounded tool policy. | System |
| A-13 | `tool_prefs` allow→deny before fire | Denied tool absent; candidate produces truthful no-action result. | Integration |
| A-14 | `tool_prefs` allow→ask before fire | Preflight/request-for-permission path; no unavailable interactive wait. | Integration |
| A-15 | `tool_prefs` deny→allow for old prompt | Actor/candidate authority still revalidated before newly allowed write. | System |
| A-16 | Identity-sensitive full tool | Receives actual user ID, not config/storage/group ID. | Integration |
| A-17 | Plugin tool full run | Plugin runtime actor is actual/declared service principal. | Integration |
| A-18 | Actor blocked during long run | Recheck before mutating step prevents new writes. | System |

### 16.3 Platform addressing, mentions, limits, and actions

| ID | Case | Expected assertion | Level |
| --- | --- | --- | --- |
| P-01 | Telegram DM accepted | Delivered receipt contains native message ID; history follows. | Adapter |
| P-02 | Telegram user cannot be messaged | Typed permanent/retryable failure; prompt not finalized. | Adapter + system |
| P-03 | Telegram thread delivery | Exact `message_thread_id`; no main-chat fallback. | Adapter |
| P-04 | Telegram invalid personal mention ID | Personal delivery not reported complete. | Adapter |
| P-05 | Telegram 4,096 boundary plus mention | Rendered/chunked messages all within limit. | Unit + adapter |
| P-06 | Telegram formatting expansion/contraction | Preflight uses rendered length/entity offsets. | Unit |
| P-07 | Mattermost DM | Direct channel and post receipt; bot-not-started is typed failure. | Adapter |
| P-08 | Mattermost thread | Exact root ID. | Adapter |
| P-09 | Mattermost explicit audience lookup fails | No fallback mention of creator; personal candidate held/fails. | Adapter |
| P-10 | Mattermost 16,383 boundary | Chunk or reject before API; no ghost history. | Adapter + system |
| P-11 | Discord DM >2,000 | Ordered chunks, per-chunk IDs, one logical receipt. | Adapter |
| P-12 | Discord group personal >2,000 | Mention appears according to defined chunk policy and remains within budget. | Adapter |
| P-13 | Discord unsendable channel | Typed permanent failure; no finalization. | Adapter |
| P-14 | Discord later chunk fails | Partial IDs stored; retry resumes without duplicating earlier chunks. | System |
| P-15 | Discord parent+thread contradiction | Rejected before send. | Unit |
| P-16 | Kontur group thread | Delivered receipt after response parse. | Adapter |
| P-17 | Kontur DM | `unsupported:dm`; zero API calls; no finalization/snapshot advance/history. | Adapter + system |
| P-18 | Kontur personal group candidate | `unsupported:personal-mention`; no shared send. | System |
| P-19 | Kontur long markdown | Preflight chunk/cap policy; no API oversize retry loop. | Adapter |
| P-20 | Buttons on Telegram/Mattermost/Discord | Signed candidate action resolves only in same authorized context and before expiry. | System |
| P-21 | Buttons on Kontur | Text fallback contains stable candidate reference and mention-aware instructions. | System |
| P-22 | Unknown/stale callback | Safe no-op/expired response; candidate unchanged. | Integration |
| P-23 | Action by nonaudience group member | Denied even if member can see the message. | System |
| P-24 | Action after task state changed | Revalidate candidate/task and avoid stale mutation. | System |

### 16.4 Delivery lifecycle, retry, idempotency, and history

| ID | Case | Expected assertion | Level |
| --- | --- | --- | --- |
| D-01 | Generation succeeds, send succeeds | One receipt, exact delivered text appended once, source finalized. | System |
| D-02 | Generation succeeds, send returns false | Artifact retained; no assistant history/finalization. | System |
| D-03 | Generation succeeds, send throws | Same as D-02; bounded retry scheduled. | System |
| D-04 | Verifier changes output | History stores verifier-delivered text, not raw preamble. | System |
| D-05 | Generation throws, error send succeeds | Error text recorded once after send and source lifecycle is explicit. | System |
| D-06 | Generation throws, error send fails | No history/finalization; bounded retry/failed state. | System |
| D-07 | Full tool writes, send fails | Retry does not repeat effect; same idempotency key/artifact reused. | System |
| D-08 | Crash after claim before generation | Lease expires and another worker resumes once. | System |
| D-09 | Crash after generation before send | Stored artifact reused; no regeneration/tool replay. | System |
| D-10 | Crash after send receipt before history | Reconciliation appends history; no resend. | System |
| D-11 | Crash after external API accepted but before receipt | Uncertain state is reconciled/manual; blind duplicate prevented where possible. | System |
| D-12 | Two processes claim same candidate | Exactly one valid lease executes. | Concurrency |
| D-13 | Two overlapping scheduled polls | Same firing instance delivered once. | Concurrency |
| D-14 | Two overlapping alert polls >5 min | Same observed edge/candidate delivered once. | Concurrency |
| D-15 | Alert send fails | Cooldown/snapshot edge retained without duplicate generation effects. | System |
| D-16 | Alert send succeeds | Cooldown and snapshot advance only after receipt. | System |
| D-17 | 101 scheduled prompts due | Oldest ordering, bounded batch, observable backlog. | Load |
| D-18 | 10 alert contexts × many matches | Global LLM/provider limits are enforced, not 5 per context. | Load |
| D-19 | Quiet-hours release burst | Ranking/rate limit/digest prevent unbounded simultaneous sends. | Load |
| D-20 | Platform rate-limit response | Retry-after honored with expiry and no regeneration. | Adapter + system |
| D-21 | History persistence fails after send | Receipt remains delivered; reconciliation retries history only. | System |
| D-22 | History already contains receipt ID | Reconciliation is idempotent. | Integration |
| D-23 | Cancelled/expired while claimed | Worker revalidates before send and does not deliver. | Concurrency |
| D-24 | Merged scheduled prompts mixed modes | Merge policy is deterministic; candidate IDs/finalization remain per source row. | Integration |

### 16.5 Notify and broadcast

| ID | Case | Expected assertion | Level |
| --- | --- | --- | --- |
| N-01 | Notify scoped DM | Canonical instance/native target; send then canonical history. | Integration |
| N-02 | Notify scoped thread group, omitted type | Correct group/thread inference. | Integration |
| N-03 | Notify non-thread group, omitted type | Request rejected as ambiguous, not treated as DM. | Integration |
| N-04 | Notify explicit group | Canonical group target and history storage ID. | Integration |
| N-05 | Notify explicit DM with thread | Validation rejects contradiction. | Unit |
| N-06 | Notify idempotency-key retry | One candidate/message/receipt. | System |
| N-07 | Notify wrong/stale instance | Unroutable; no adapter call/history. | Integration |
| N-08 | Release broadcast two recipients, one failure | Success isolated; sent skipped later; failed remains retryable. | Integration |
| N-09 | Concurrent same-version broadcasts | Per-recipient atomic claim prevents duplicates. | Concurrency |
| N-10 | Broadcast Kontur DM | Unsupported counted failed, never sent/recorded as success. | System |
| N-11 | Group unsubscribed/revoked during broadcast | Revalidated before send. | System |
| N-12 | Manual announce blocked/placeholder users | Excluded as policy specifies; failures counted. | Integration |

### 16.6 Run control and reactive races

| ID | Case | Expected assertion | Level |
| --- | --- | --- | --- |
| R-01 | User messages during proactive read-only generation | Defined ordering; no stale history corruption. | System |
| R-02 | User updates same task during proactive read | Candidate revalidates before delivery/action. | System |
| R-03 | Reactive and proactive writes collide | Serialized or conflict-detected; no silent overwrite. | System |
| R-04 | `/stop` during normal run while proactive job exists | UI distinguishes targets; no false claim that proactive job stopped. | System |
| R-05 | Cancel proactive job | Durable cancellation prevents later send and future mutating steps. | System |
| R-06 | Proactive 20-minute timeout | Candidate records timeout; no ghost history; retry policy bounded. | System |
| R-07 | Platform with reactive live status | Proactive path does not leave orphan status messages. | Integration |
| R-08 | Kontur without status | Same candidate semantics; no capability assumption. | Integration |

## 17. Final WS-E conclusion

papai's scope registry and dual address representation are strong foundations: group configuration can
remain shared while delivery, snapshots, and history stay in the exact originating thread. The
weakness is lifecycle authority and acknowledgment, not the basic ability to call four chat APIs.

The first safe shared increment is a candidate/receipt gateway that preserves the existing scope
model, persists a real actor or explicit service authority, revalidates authorization, rejects
unsupported audiences before generation, and moves history behind a typed delivered receipt. Until
then, new scenarios should be limited to short, read-only, explicit-intent sends on verified targets.
Kontur DMs, autonomous group full-mode work, long cross-platform digests, and any promised
snooze/dismiss buttons remain blocked.
