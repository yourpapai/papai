<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: User profile memory

## Why

papai remembers tasks and conversation summaries, but nothing about the
user themselves (role, preferences, working style). A per-user profile
blob — built by background extraction and explicit edits — lets the agent
personalize replies in DMs, mirroring the proven `memory_summary` pattern.
ADR-0313 archived the April plan as "not now, not this way"; this change
re-enters the same feature through OpenSpec, which is the ADR's stated
trigger.

## What Changes

- New `user_profile` table (migration 076) holding one markdown blob per
  user; profile module (`src/profile.ts`) with load/save/clear plus a cache
  slot, mirroring `memory_summary`.
- Background `runProfileExtractionInBackground` fired from the existing
  trim trigger in DM contexts only: a small-model extraction rewrites the
  blob; validation failure keeps the previous blob.
- Two DM-only LLM tools, `remember_about_user` and `forget_user_profile`,
  for hot-path explicit edits (`applyRemember`/`applyForget`).
- `=== User profile ===` section in the system prompt in DM contexts only,
  plus a DM-only `USER_PROFILE_RULES` system-prompt rule.
- `/profile` and `/profile clear` chat commands (DM only), `/help` lines,
  and profile inclusion in the `/context` admin export.

## Capabilities

### New Capabilities

- `user-profile-memory` — per-user markdown profile extracted in the
  background and injected into DM system prompts, with explicit-edit tools.

### Modified Capabilities

None. `openspec/specs/` has no entries for memory or profile surfaces.

## Non-goals

- No group-context profiles, extraction, or tools — groups get strictly
  fewer capabilities by design (privacy + noise).
- No per-platform-instance variation; behavior is identical across
  Telegram/Mattermost/Discord/Kontur Talk DMs.
- No `contextType` threading refactor — `ContextType` already flows through
  the orchestrator (drift-check, design.md D2).
- No semantic/embedding profile search; the blob is injected whole.
- No settings-UI surface in this change.

## Impact

- **Code:** new `src/profile.ts`, `src/tools/profile.ts`,
  `src/commands/profile.ts`, migration `076_user_profile.ts`; edits to the
  memory context builder, system prompt, trim trigger, `makeTools`,
  `bot.ts`, `/help`, `/context` export; tests throughout.
- **DB:** new table, no backfill (new object); per-user rows keyed by
  platform user id — no storage/config context keying.
- **Tool gating:** two new tools join `tool_prefs` (default allow, DM-only
  availability); no new capability flags.
- **Scope model:** per-user asset; thread isolation unaffected; group
  contexts never read or write profiles.
- **Docs:** `docs/architecture/behaviors.md` (memory section),
  `docs/architecture/environment.md` if a small-model override is added.
- **Legacy:** re-proposes archived
  `docs/archive/2026-04-08-user-profile-memory.md` per ADR-0313; no legacy
  file deletion needed (already archived).
