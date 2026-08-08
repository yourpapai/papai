<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: User profile memory

## 1. Storage + module

- [ ] 1.1 Failing migration test, then migration `076_user_profile.ts`
      (user_profile: platform user id, markdown blob, updated_at).
      Verify: `bun test tests/db*` (focused)
- [ ] 1.2 Failing `tests/profile.test.ts` for load/save/clear + cache slot,
      then `src/profile.ts` skeleton mirroring `memory_summary`.
      Verify: `bun test tests/profile.test.ts`

## 2. Extraction + edits

- [ ] 2.1 Failing tests for `extractProfile` (happy path + validation
      failures keep old blob), `applyRemember`, `applyForget`; then
      implement in `src/profile.ts`.
      Verify: `bun test tests/profile.test.ts`

## 3. Prompt injection (DM only)

- [ ] 3.1 Failing tests: profile context message renders
      `=== User profile ===` only when `contextType === 'dm'`; memory
      context builder accepts an optional profile; `USER_PROFILE_RULES`
      appears in the DM system prompt. Then implement.
      Verify: focused memory/system-prompt suites

## 4. Background runner

- [ ] 4.1 Failing test: trim trigger fires `runProfileExtractionInBackground`
      for DMs and never for groups; then implement the runner + wiring.
      Verify: focused conversation/trim suite

## 5. Tools + commands

- [ ] 5.1 Failing tests for `remember_about_user` / `forget_user_profile`
      (DM-only availability, tool_prefs deny/ask behavior); then
      `src/tools/profile.ts` + `makeTools` wiring.
      Verify: `bun test tests/tools*`
- [ ] 5.2 Failing tests for `/profile` + `/profile clear` (DM only),
      `/help` lines, `/context` export inclusion; then
      `src/commands/profile.ts` + registration.
      Verify: `bun test tests/commands*`

## 6. Gate

- [ ] 6.1 Full `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run format:check`; update `docs/architecture/behaviors.md`.
      Verify: all pass
