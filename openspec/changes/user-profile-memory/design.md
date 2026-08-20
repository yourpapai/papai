<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: User profile memory

## Decisions

### D1: Single markdown blob per user, `memory_summary` mechanics (from legacy plan)

One row per user in `user_profile` (platform user id → markdown blob +
updated_at). Background extraction rewrites the whole blob via a
small-model call (same runner shape as the smart-trim/summary path in
`src/conversation.ts`); explicit edits go through `applyRemember` /
`applyForget`. Whole-blob injection keeps the hot path dumb and cheap —
no retrieval step. Blob contains no credentials; stored plaintext in the
per-user SQLite DB exactly like `memory_summary` (no new secrecy class).

### D2: Drift resolutions against the archived plan

- **Task 9 (`contextType` threading) is already shipped** —
  `ContextType = 'dm' | 'group'` flows through `llm-orchestrator.ts:83`;
  the change consumes it, no refactor.
- **Migration renumbering:** slot 019 was taken; use the next free slot
  (076 at writing). No backfill — new table.
- **Missing authoritative design doc:** the plan deferred final decisions
  to a doc that never existed; this design.md is the authoritative source.
- **Tool/command wiring follows current shape:** tools register in
  `makeTools` under the `memory`-adjacent capability with `tool_prefs`
  three-state handling; commands follow `src/commands/CLAUDE.md` rules
  (user-data inspection/clear, not configuration).

### D3: DM-only everywhere

Profile loading, system-prompt section, extraction trigger, tools, and
commands activate only when `contextType === 'dm'`. Rationale: profiles are
per-person; injecting them into group threads leaks personal context to
other members and adds noise. Group contexts get no profile section, no
profile tools (filtered like other capability-gated tools), and no
extraction trigger.

### D4: Extraction safety

`extractProfile` output is validated (schema + length cap) before saving;
on validation failure or model error the previous blob is kept and the
failure is logged (warn). Extraction input is the same conversation slice
the summary runner uses; no extra provider calls on the hot path.

### D5: DB, scope, hooks

Drizzle migration 076 creates `user_profile`; no existing rows to
backfill. State is per-user (platform user id), outside the
storage-context/config-context model — documented as such. TDD order:
migration + module skeleton → extraction/apply functions → context
injection → tools → commands → wiring; every new `src/` file is
hook-gated, tests first.
