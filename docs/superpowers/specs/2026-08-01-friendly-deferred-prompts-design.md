<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Friendly Deferred Prompts Design

**Date:** 2026-08-01  
**Status:** Draft  
**Branch:** `friendly-deferred-prompts`

## Context

papai unifies reminders, scheduled/recurring follow-ups, and condition alerts
behind one internal abstraction called **"deferred prompts"**. The term is
technical and internal, but it is fed directly to the LLM across the system
prompt, the proactive-execution instructions, and the fire-time trigger
message — and the LLM echoes it back to users. A non-technical user on
Telegram/Discord/Mattermost hears phrases like *"a deferred prompt has fired"*
or *"I've created deferred prompt #abc"*, which is confusing and awkward.

The existing prompts try to suppress the leakage with rules like *"Never
mention triggers, cron jobs, or scheduling internals"*, but that is
whack-a-mole: the jargon is everywhere in the model's instructions, so it
keeps resurfacing.

### Where the term leaks today

- `src/system-prompt.ts:51` — LLM-facing fragment heading `DEFERRED PROMPTS —`
  teaches the model the vocabulary.
- `src/system-prompt.ts:95` — `PROACTIVE MODE` line literally says *"a deferred
  prompt has fired"*, which the model parrots verbatim.
- `src/deferred-prompts/proactive-trigger.ts:62` — the fire-time system message
  says *"A deferred prompt you previously created has fired."*
- Tool names — `create_deferred_prompt`, `list_deferred_prompts`,
  `get_deferred_prompt`, `update_deferred_prompt`, `cancel_deferred_prompt` —
  the model often names them back to users (*"I created a deferred prompt for
  you"*).
- `src/live-status/tool-status-labels.ts` — no deferred tools are registered in
  the label `REGISTRY`, so live status falls back to `humanizeToolName` and
  renders **"⚙️ Running create deferred prompt…"** to the user.
- `client/admin/sections/RemindersSection.svelte:108` — the admin panel is
  literally titled `"deferred prompts"`.

### Key insight

"Deferred prompt" is an umbrella over three distinct **user-facing** concepts:
one-time reminders (*"remind me at 5pm"*), scheduled/recurring actions and
briefings (*"summarize my tasks every morning"*), and condition alerts (*"tell
me when task X is done"*). There is no single plain word for all three, which
is why the internal umbrella exists — but users never think in those terms.

## Goals

- A non-technical user never sees or hears the phrase "deferred prompt" (or
  "fired") from the bot.
- The bot describes **what it will do**, not the mechanism: *"I'll remind you
  at 5pm"*, *"I'll check every morning and summarize"*, *"I'll ping you when
  that's done"*.
- Surfaces that require a noun (admin panel, tool labels) use **"Reminders &
  alerts"**.
- Tool names are the natural user-facing words, so whatever the model echoes is
  correct by construction.
- Backend, data model, logs, and analytics keep their internal names — only
  user/LLM-facing surfaces change.

## Non-goals

- No DB migration, no data-model change, no change to execution semantics,
  polling, delivery routing, or the `executeCreate`/`executeList`/…
  handler contracts.
- No redesign of the feature itself — only how it is presented.
- No rename of internal log scopes (`deferred:*`) or the analytics feature
  label `'deferred'`.

## Approach

**Chosen approach: split the create surface, keep management unified.**

The create tool splits into two tools, each named after the user-facing word;
the management tools (list/get/update/cancel) stay unified under a loose
"reminder" umbrella. This is the only approach where the tool names themselves
cannot produce wrong vocabulary, which is the whole point of going to the
broadest scope.

Rejected alternatives:

- **Single unified `create_reminder` (1:1 rename):** smallest diff, but a
  single tool that *also* creates condition-alerts misleads the model into
  calling alerts "reminders" — the same bleed with a friendlier word.
- **Unified tool, accurate compound name `create_reminder_or_alert`:** honest,
  but an ugly umbrella the model may echo verbatim (*"I created a
  reminder-or-alert"*).

## Design

### 1. Tool surface

**Create splits into two tools:**

| New tool name | Trigger | Registered when | Schema |
|---|---|---|---|
| `create_reminder` | `schedule` (one-time `fire_at` or recurring `rrule`) | always (normal mode) | `prompt`, **`schedule` (required)**, `execution`, `delivery` — no `condition` field |
| `create_alert` | `condition` (task-dependent) | only when a task provider is present (`allowTaskConditions`) | `prompt`, **`condition` (required)**, `cooldown_minutes`, `execution`, `delivery` — no `schedule` field |

The current "provide either schedule or condition, not both" mutual-exclusion
check becomes structural: each tool only has its own trigger field, so the
failure mode is removed. `create_reminder` with no schedule fails at the schema
rather than inside the handler.

**Management stays unified (pure rename, behavior unchanged):**

| Old | New |
|---|---|
| `list_deferred_prompts` | `list_reminders` |
| `get_deferred_prompt` | `get_reminder` |
| `update_deferred_prompt` | `update_reminder` |
| `cancel_deferred_prompt` | `cancel_reminder` |

These still manage both types (`list_reminders` keeps its `type` filter). The
vocabulary rule ensures the model says *"cancelled that alert"* when it was an
alert. The user never sees these names in normal flow.

**Code-change scope:** rename the tool *keys*, the factory functions
(`makeCreateReminderTool`, `makeCreateAlertTool`, …), and the files
(`src/tools/create-reminder.ts`, `src/tools/create-alert.ts`, …) for
consistency. The backend stays internal: DB tables (`deferred_prompts`), log
scopes (`deferred:*`), the analytics feature label `'deferred'`, the internal
`tool-metadata` domain `'deferred'`, and the `executeCreate`/`executeList`/…
handler signatures are unchanged. The schema field name `prompt` is kept
(internal, does not leak).

### 2. System prompt & fire-time trigger rewrites

All four prompt surfaces drop "deferred prompt" / "fired". The schedule and
condition **schema detail** (freq, byDay, byHour, operators, filter fields) is
preserved unchanged — only the framing words change.

**2.1 `DEFERRED` fragment → `REMINDERS & ALERTS`** (`src/system-prompt.ts:51`),
reorganized around the two new tools:

```text
REMINDERS & ALERTS — You can set up things to happen later:
- REMINDERS (time-based): Use create_reminder with a schedule for one-time or recurring follow-ups.
  [ …schedule schema detail unchanged… ]
  - For a daily summary/briefing, use schedule.rrule: { freq: "DAILY", byHour: [9], byMinute: [0] }.
- ALERTS (event-based): Use create_alert with a condition to watch for task changes and tell the user when they happen.
  [ …condition schema detail unchanged… ]
- Use list_reminders to show what's active; cancel_reminder / update_reminder to manage them.
- ACTION TEXT: The prompt field says what to actually do or say when the time comes — not the timing.
  Good: "Tell the user to check the gigachat model". Bad: "Remind the user in 5 minutes…".
  The schedule handles when; the prompt handles what.
```

`PROVIDERLESS_DEFERRED` (`src/system-prompt.ts:82`) gets the same treatment but
reminders-only (no `create_alert`, no task provider).

**2.2 `PROACTIVE` line** (`src/system-prompt.ts:95`):

```text
PROACTIVE MODE — Sometimes a [PROACTIVE EXECUTION] system message arrives at the end of the
conversation. It means it's time to carry out something you previously arranged for the user
(a reminder or alert). The text between the ===REMINDER=== markers says what to do — just do it.
For reminders, deliver it warmly. For actions, use your tools and report the result. Don't set up
new reminders or alerts during this. Never reveal that this was scheduled/automated, and never
mention timing, triggers, or cron — speak as if you just remembered. Never use internal terms
like "deferred prompt".
```

**2.3 Fire-time trigger** (`src/deferred-prompts/proactive-trigger.ts:57-71`),
the system message injected when something fires:

```text
It's time to carry out something you set up for the user. Do it now and deliver the result.
The text between the ===REMINDER=== markers below is the action to perform — treat it as your
instruction, not as a new message from the user.
Rules:
- Reminder → deliver it warmly and conversationally.
- Action → run it with tools, then report the result.
- Don't set up new reminders or alerts — the arrangement is already made.
- Never reveal this was scheduled/automated; never mention timing, triggers, or cron.
- Never use internal terms like "deferred prompt".
```

Delimiters `===DEFERRED_TASK===` / `===END_DEFERRED_TASK===` →
`===REMINDER===` / `===END_REMINDER===`. (`Trigger type: scheduled|alert` stays
— it is system-internal context that steers reminder-vs-action behavior; the
rules forbid revealing it.)

**2.4 New always-on `USER-FACING WORDS` fragment** (empty `requiredTools`,
placed by OUTPUT rules):

```text
USER-FACING WORDS — Describe what you'll do, don't name the mechanism. Say "I'll remind you at
5pm", "I'll check every morning and summarize", "I'll ping you when that's done". Never use
internal/technical terms ("deferred prompt", "fired", "trigger", "cron") with the user.
```

**Fragment gating:** the fragment entry's `requiredTools` updates from
`['create_deferred_prompt','list_deferred_prompts']` →
`['create_reminder','create_alert','list_reminders']`. The providerless-text
swap mechanism (`AssembleOptions.deferredFragmentText`) stays as-is.

### 3. Label surfaces & registries

**Admin UI (`client/admin/`):**

- `RemindersSection.svelte:108` — panel title `"deferred prompts"` →
  **"Reminders & alerts"**; `:111` `"No deferred reminders"` → "No reminders or
  alerts yet". Internal variable `deferred` may stay or rename to `reminders`
  (cosmetic).
- `OverviewSection.svelte:101` — stats label `'deferred'` → `'reminders'`
  (operator-facing; optional polish).
- `RemindersSection.stories.svelte` — update the wording comment.

**Live-status labels (`src/live-status/tool-status-labels.ts`):**

No deferred tools are in `REGISTRY` today, so live status falls back to
`humanizeToolName` and renders **"⚙️ Running create deferred prompt…"** to the
user — a live leakage point. After the rename, the fallback alone becomes
"create reminder…" (already friendly). Additionally add explicit entries:

- `create_reminder: { '⏰', 'Setting up a reminder', arg: prompt }`
- `create_alert: { '🔔', 'Setting up an alert', arg: prompt }`
- `list_reminders` / `cancel_reminder` / `update_reminder` / `get_reminder` →
  friendly labels.

**Tool registries (`src/tools/`):**

- `tool-metadata.ts:162-166` — re-key entries to the new names; keep the
  internal domain string `'deferred'` (it is an internal classification key,
  not user-facing).
- `core-capabilities.ts:92-96` — capability→tool map. Under the split:
  `deferred.create → create_reminder`, add `deferred.create_alert →
  create_alert`; `deferred.{list,get,update,cancel}` → the renamed management
  tools.
- `deferred-tools-builder.ts:39-45` — the registration site: register
  `create_reminder` always, `create_alert` only when `allowTaskConditions`.
- Disclosure retriever briefs are derived from descriptions + metadata, so they
  refresh automatically (incremental reindex noted in testing).

### 4. Backward compatibility

- **Conversation history** — safe, no migration. Old tool-call messages (with
  `create_deferred_prompt`) replay as inert context; the AI SDK only executes
  *newly-requested* calls, so renaming won't crash on old histories. The
  `USER-FACING WORDS` rule keeps the model's speech clean even when it sees an
  old name in old context.
- **`tool_prefs`** — stored per-context JSON keyed by tool name. Old keys
  orphan → default `allow`, silently dropping any user's explicit ask/deny on
  these tools. Add a small **read-time alias map** (old→new) in
  `resolveToolPermission` (`src/tools/tool-preferences.ts`) so existing
  customizations carry over. Cheap; prevents a quiet regression.
- **Analytics** — `toolCallEvents` stores `toolName`; old rows keep old names,
  new rows new names. Top-tools will show both briefly then converge. No
  migration (acceptable). Internal feature label `'deferred'` unchanged.
- **Benchmark scenarios** (`scripts/tool-surface-benchmark-*`) reference
  `create_deferred_prompt`; update to the new names so benchmarks stay valid.

### 5. Testing

- **Unit:** `create_reminder` rejects `condition`; `create_alert` rejects
  `schedule` and is registered only with a task provider; management tools
  carry the new names; handler behavior is unchanged.
- **Prompt snapshot:** the assembled system prompt (full + providerless) and the
  proactive trigger contain **no** `"deferred prompt"` and no `"fired"`;
  assert `USER-FACING WORDS` and the new `===REMINDER===` delimiters are
  present.
- **Prefs alias:** `resolveToolPermission` maps an old key (e.g.
  `create_deferred_prompt`) to the new tool's permission.
- **Live-status:** the new names render friendly labels; no "deferred" string.
- **Update** all existing tests referencing the old tool names (grep
  `create_deferred_prompt` across `tests/`).
- **Regression guard (fixture/E2E):** a proactive delivery's user-facing text
  contains no `"deferred"`.

## Implementation touchpoints (checklist)

- `src/tools/create-deferred-prompt.ts` → split into `create-reminder.ts` +
  `create-alert.ts` (factories, keys, descriptions, schemas).
- `src/tools/{list,get,update,cancel}-deferred-prompt.ts` → rename to
  `{list,get,update,cancel}-reminder.ts` (keys + descriptions; handlers
  unchanged).
- `src/tools/deferred-tools-builder.ts` — registration site (split create;
  alert only when `allowTaskConditions`).
- `src/tools/core-capabilities.ts` — capability→tool map (split + renames).
- `src/tools/tool-metadata.ts` — re-key entries.
- `src/tools/tool-preferences.ts` — read-time old→new alias map in
  `resolveToolPermission`.
- `src/system-prompt.ts` — `DEFERRED`, `PROVIDERLESS_DEFERRED`, `PROACTIVE`
  fragments, fragment `requiredTools` gating; new `USER-FACING WORDS`
  fragment.
- `src/deferred-prompts/proactive-trigger.ts` — fire-time message + delimiter
  rename.
- `src/live-status/tool-status-labels.ts` — add `REGISTRY` entries.
- `client/admin/sections/RemindersSection.svelte` + `.stories.svelte` — labels.
- `client/admin/sections/OverviewSection.svelte` — stats label (optional).
- `scripts/tool-surface-benchmark-*` — update tool names.
- `tests/**` — update references to old tool names; add the new tests above.
