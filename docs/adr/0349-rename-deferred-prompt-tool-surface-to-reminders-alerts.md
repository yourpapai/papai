<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0349: Rename the Deferred-Prompt Tool Surface to Reminders & Alerts

## Status

Accepted

## Date

2026-08-01

## Context

The deferred-prompt feature schedules future actions: time-based follow-ups ("remind me at 5pm") and condition-based watches ("tell me when the task status changes"). Internally everything is called a "deferred prompt" — the module (`src/deferred-prompts/`), the DB table, the log scopes, and the analytics feature label. The problem: the internal term leaked into every user- and LLM-facing surface:

- The LLM tool surface was `create_deferred_prompt` / `list_deferred_prompts` / `get_deferred_prompt` / `update_deferred_prompt` / `cancel_deferred_prompt`, and the single create tool conflated two distinct concepts (schedule-based vs condition-based) in one schema.
- Tool descriptions, system-prompt fragments (`DEFERRED`, `PROVIDERLESS_DEFERRED`, `PROACTIVE`), and the fire-time trigger message (`===DEFERRED_TASK===` markers, "Trigger type", "fired") taught the model to think — and therefore speak — in internal vocabulary.
- Live-status fallback labels rendered "create deferred prompt…" to users; the admin panel was titled accordingly.

Users should hear "I'll remind you at 5pm", never "I created a deferred prompt that fired." The rename also had one backward-compatibility wrinkle: existing per-context `tool_prefs` JSON can carry overrides keyed by the old tool names, and a naive rename would silently drop those customizations back to `allow`.

The design (`docs/superpowers/specs/2026-08-01-friendly-deferred-prompts-design.md`) and plan (`docs/superpowers/plans/2026-08-01-friendly-deferred-prompts.md`) scoped the change to presentation only: backend module, DB tables, log scopes (`deferred:*`), and the analytics feature label `'deferred'` stay internal and unchanged.

## Decision Drivers

- **Split the create tool by intent.** `create_deferred_prompt` becomes `create_reminder` (schedule-based: `fire_at` or `rrule`) and `create_alert` (condition-based: task-field filters + cooldown), so the model picks the right abstraction instead of filling a union schema.
- **Rename management tools to plain words.** `list_reminders` / `get_reminder` / `update_reminder` / `cancel_reminder` cover both reminders and alerts; one set of management tools, not two.
- **Rewrite every user/LLM-facing string.** System-prompt fragments, the fire-time trigger (`===REMINDER===` markers), tool descriptions, live-status labels, and admin UI labels drop "deferred prompt", "fired", "trigger", "cron".
- **Keep internals internal.** Module path, DB schema, `deferred:*` log scopes, `handler` signatures (`executeCreate`/`executeList`/`executeGet`/`executeUpdate`/`executeCancel`), and the analytics feature label `'deferred'` are deliberately untouched — no migration, no observability break.
- **Backward-compatible `tool_prefs`.** A read-time old→new alias map carries legacy per-context permission overrides onto the renamed tools.
- **Gate `create_alert` on task-provider presence.** Alerts are condition-based and conditions are task-dependent, so `create_alert` registers only when `allowTaskConditions` is true.

## Considered Options

### Option 1 — Split the create tool, rename the management surface, and rewrite all user/LLM-facing strings while keeping internals unchanged (chosen)

Six new tool files under `src/tools/`; system-prompt fragments replaced (`REMINDERS & ALERTS`, `PROVIDERLESS` reminders fragment, new `USER_FACING_WORDS` always-on fragment); fire-time trigger rebuilt around `===REMINDER===` markers; capabilities/metadata/classifier/live-status/admin registries remapped; a `RENAMED_TOOL_ALIASES` map preserves legacy `tool_prefs` overrides; mutation baseline/overrides remapped to the new file paths.

- **Pros:** the LLM sees two intent-shaped create tools instead of one union schema, so it stops emitting schedule+condition hybrids; every surface the user or model reads speaks plain words; zero DB migration and zero observability churn because internals stay; legacy permission customizations survive the rename.
- **Cons:** a rename commit touches many files at once (registration, capabilities, metadata, classifier, system prompt, trigger, tests, benchmark scripts, mutation config) and the tree is not green at intermediate sub-steps; old tool names permanently remain in the alias map and its tests as intentional legacy surface.

### Option 2 — Rename only the tool keys; keep a single union create tool (rejected)

Mechanically rename the five tools but leave `create_reminder` accepting both `schedule` and `condition`.

- **Pros:** smaller diff; fewer registration and capability changes.
- **Cons:** keeps the exact confusion that made the model blend scheduling meta-instructions into prompts — one tool advertising two trigger kinds invites malformed hybrid inputs; does not let `create_alert` be gated independently on task-provider presence.

### Option 3 — Rename internals too (module, DB table, log scopes, analytics label) (rejected)

Full end-to-end rename of `deferred-prompts` → `reminders` everywhere including storage and observability.

- **Pros:** no internal/external vocabulary split; no alias map needed for code navigation.
- **Cons:** requires a DB migration, breaks every dashboard/log query and analytics row keyed on `'deferred'`, and buys nothing user-visible — the leak was in presentation surfaces, not storage. Cost far exceeds benefit.

## Decision

Option 1 shipped as a single atomic rename (plus a backward-compat alias commit and label commits), enumerated as what changed:

1. **Two new create tools.** `src/tools/create-reminder.ts` (`makeCreateReminderTool`, schedule-only schema) and `src/tools/create-alert.ts` (`makeCreateAlertTool`, condition-only schema with `cooldown_minutes`); both delegate to the unchanged `executeCreate` handler.
2. **Four renamed management tools.** `list-reminders.ts`, `get-reminder.ts`, `update-reminder.ts`, `cancel-reminder.ts` replace their `*-deferred-prompt*` predecessors; the five old files are deleted.
3. **Registration rewired.** `src/deferred-prompts/tools.ts` re-exports the six factories; `src/tools/deferred-tools-builder.ts` registers `create_reminder`/`list_reminders`/`get_reminder`/`update_reminder`/`cancel_reminder` unconditionally and `create_alert` only when `allowTaskConditions` is true.
4. **Registries remapped.** `core-capabilities.ts` (`deferred.create` → `create_reminder`, new `deferred.create_alert` → `create_alert`), `tool-metadata.ts` (domain `'deferred'` preserved), the intent classifier's `deferred.manage` list, and the generated analytics tool-slugs all carry the new names.
5. **System prompt rewritten.** `DEFERRED` → a `REMINDERS & ALERTS` fragment with rrule teaching examples; `PROVIDERLESS_DEFERRED` → a reminders-only fragment; `PROACTIVE` rewritten around `===REMINDER===` markers with an explicit "never use internal terms" rule; a new always-on `USER_FACING_WORDS` fragment bans "deferred prompt"/"fired"/"trigger"/"cron" in user-facing replies; `requiredTools` gating updated to the new keys.
6. **Fire-time trigger rewritten.** `buildProactiveTrigger` in `src/deferred-prompts/proactive-trigger.ts` emits `[PROACTIVE EXECUTION]` with `===REMINDER===` / `===END_REMINDER===` delimiters and conversational delivery rules.
7. **Legacy `tool_prefs` aliased.** An old→new alias map (shipped as `src/tools/tool-aliases.ts`, consumed by `resolveToolPermission`) lets overrides keyed by `create_deferred_prompt`/`list_deferred_prompts`/etc. carry over to the renamed tools; a direct new-name override wins.
8. **Friendly live-status + admin labels.** `tool-status-labels.ts` gains explicit `REGISTRY` entries (⏰ reminder, 🔔 alert, etc. with the `prompt` arg); the admin panel reads "Reminders & alerts" / "No reminders or alerts yet"; the overview stat label is `reminders`.
9. **Mutation config remapped.** `scripts/mutation/baseline.json` and `overrides.json` keys moved to the new file paths (split files re-seeded).

## Consequences

### Positive

- Users and the LLM now share a plain-words vocabulary ("reminder", "alert"); the model is instructed to describe intent, never the mechanism, and the fire-time trigger no longer primes internal jargon.
- The split create tools make malformed hybrid inputs (schedule + condition) schema-impossible, and `create_alert` appears only where a task provider exists.
- Zero migration: internals (module, DB, logs, analytics label, handler signatures) are untouched; legacy `tool_prefs` overrides keep working through the alias map.
- The internal/external vocabulary boundary is now an explicit, documented convention: `deferred` is the internal domain name; `reminder`/`alert` is every surface a user or model reads.

### Negative

- The rename commit is wide by construction — tool files, builder, capabilities, metadata, classifier, system prompt, trigger, tests, benchmark scripts, and mutation config all change together; intermediate sub-steps are red.
- Old tool names persist forever in the alias map and its tests as intentional legacy surface; a future rename must extend that map rather than delete it.
- Two vocabularies now coexist by design (`deferred` internal vs `reminder`/`alert` external); contributors must know which side of the boundary a string lives on.

### Risks

- **A missed surface reintroduces the leak.** Any new tool description, system-prompt fragment, or UI label written against the internal term re-exposes it. Mitigation: the `USER_FACING_WORDS` fragment instructs the model directly, and the final regression greps (`rg "deferred prompt" src/ client/`, `rg "===DEFERRED_TASK==="`) pin the no-leak invariant.
- **Alias-map drift.** If a renamed tool is renamed again without updating the alias map, legacy overrides silently fall back to `allow`. Mitigation: the alias behavior is covered by dedicated tests (`tests/tools/tool-preferences.test.ts`, `tests/tools/tool-aliases.test.ts`).
- **Benchmark/scripts skew.** The tool-surface benchmark hardcodes tool names; a missed update makes scenarios assert on nonexistent tools. Mitigation: the plan's sweep step explicitly remaps `create_deferred_prompt` → `create_reminder` in the benchmark union, discovery array, schema key, and handler map.

## Related Decisions

- [ADR-0030](README.md) — Deferred Prompts System: the original internal abstraction whose module, DB table, and log scopes this ADR deliberately leaves unchanged. (Source file pruned with the 0001-0100 batch; referenced via the index.)
- [ADR-0116](0116-deferred-prompt-delivery-redesign.md) — Deferred Prompt Delivery Redesign: the fire-time delivery path whose trigger message this ADR rewrites from `===DEFERRED_TASK===` to `===REMINDER===`.
- [ADR-0302](0302-remove-deferred-prompt-modes.md) — Remove Deferred-Prompt Execution Modes: the prior deferred-prompt change that unified the proactive firing path; this ADR renames the surface over that unified path without altering its execution semantics.
- [ADR-0203](0203-tool-permission-presets.md) / [ADR-0247](0247-plugin-and-mcp-tool-permissions.md) — tool-permission decisions whose `tool_prefs` override keys this ADR keeps working across the rename via the legacy alias map.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`:

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/create-reminder.ts` / `create-alert.ts` | Split create tools; descriptions contain no "deferred prompt". | `glob` + `read` confirm. |
| `src/tools/list-reminders.ts`, `get-reminder.ts`, `update-reminder.ts`, `cancel-reminder.ts` | Renamed management tools; old `*-deferred-prompt.ts` files absent. | `glob` confirms. |
| `src/deferred-prompts/tools.ts` | Re-exports the six new factories. | `read` confirms. |
| `src/tools/deferred-tools-builder.ts:40-46` | Registers five tools unconditionally; `create_alert` gated on `allowTaskConditions`. | `read` confirms. |
| `src/tools/core-capabilities.ts:92-96`, `src/tools/tool-metadata.ts:162-166` | Capability + metadata maps carry new keys; domain stays `'deferred'`. | `grep` confirms. |
| `src/system-prompt.ts:51-96,157-159` | `REMINDERS & ALERTS` / providerless / `PROACTIVE` fragments rewritten; `USER_FACING_WORDS` added and always-on; `requiredTools` uses new keys. | `grep` confirms. |
| `src/analytics/intent/classifier.ts:152-157`, `src/analytics/generated/tool-slugs.ts:24-28` | Classifier `deferred.manage` list and generated slugs carry new names only. | `grep` confirms. |
| `src/tools/tool-aliases.ts:8-13` | Old→new alias map (shipped as its own module instead of inline in `tool-preferences.ts` as the plan sketched; consumed by `resolveToolPermission`). | `grep` confirms. |
| `src/live-status/tool-status-labels.ts:77-82` | Explicit `REGISTRY` entries for all six tools with emojis and `prompt` arg. | `grep` confirms. |
| `client/admin/sections/RemindersSection.svelte:108,111`, `OverviewSection.svelte:101` | Panel title "Reminders & alerts", empty state, and stat label `reminders`. | `grep` confirms. |
| `scripts/mutation/baseline.json:269-288`, `overrides.json:185-188` | Floors/overrides remapped to renamed file paths. | `grep` confirms. |

Plan-vs-implementation notes:

- **The alias map shipped as `src/tools/tool-aliases.ts`, not inline in `tool-preferences.ts`.** The plan's Task 2 placed `RENAMED_TOOL_ALIASES` directly above `resolveToolPermission`. Shipped, the map lives in a dedicated module with its own test file (`tests/tools/tool-aliases.test.ts`); the carry-over behavior and precedence (direct override wins) are exactly as planned.
- **Old tool names remain only in the intentional legacy surface.** The post-rename sweep (`rg "create_deferred_prompt|list_deferred_prompts|…"` across `src/`, `tests/`, `scripts/`, `client/`) returns hits solely in `tool-aliases.ts` and its two test files — the backward-compat alias map the design mandates.

The source plan `docs/superpowers/plans/2026-08-01-friendly-deferred-prompts.md` and design `docs/superpowers/specs/2026-08-01-friendly-deferred-prompts-design.md` remain in place alongside this ADR.
