<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

> **Story verification command.** `bunfig.toml` excludes `tests/stories/**` from default
> discovery, so `bun test <path>` matches nothing there and the Write/Edit TDD hook cannot
> gate these files. Every task below that names `STORY <file>` means:
>
> ```
> bun test --path-ignore-patterns '' --preload ./tests/setup.ts --preload ./tests/mock-reset.ts <file>
> ```

## 1. Fixture capability: scenario-configurable user labels

- [x] 1.1 Add a failing contract test to `tests/stories/harness/chat.test.ts`: a fresh
      `ScenarioChat` returns `null` from `resolveUserLabel` for an unseeded id, returns
      the seeded label after `setUserLabel(userId, label)`, and rejects for an id seeded
      to throw. Verify: `STORY tests/stories/harness/chat.test.ts` (expect red).
- [x] 1.2 Implement `setUserLabel` and `resolveUserLabel` on `createScenarioChat`
      (`tests/stories/harness/chat.ts`), mirroring the `addGroupAdmin` shape. `resolveUserLabel`
      is optional on `ChatProvider`, so no type change is needed. Verify:
      `STORY tests/stories/harness/chat.test.ts` (expect green).
- [x] 1.3 Add `given.seedChatUserLabel(...)` to `tests/stories/harness/fixtures.ts`,
      mirroring `seedGroupAdmin` — including the "requires a chat instance" throw — and
      cover it in `tests/stories/harness/fixtures.test.ts`. Verify:
      `STORY tests/stories/harness/fixtures.test.ts`.

## 2. Catalogs

- [x] 2.1 Add `'chat.participants.resolve': 'resolve_chat_participant'` to
      `CORE_TOOL_CAPABILITIES` (`src/tools/core-capabilities.ts`), without which the
      scripted model cannot address the tool and group 3 cannot be written. Pin it first
      in `tests/tools/core-capabilities.test.ts` — both the exhaustive ordered map and a
      conditional-registration case mirroring `web.fetch`. Verify:
      `bun test tests/tools/core-capabilities.test.ts` (red, then green).
- [ ] 2.2 Add four ids to `tests/stories/catalog/coverage.ts` with tier `'0'` and their
      story ids: `SCN-chat-participant-ranking`, `SCN-chat-participant-label-fallback`,
      `SCN-chat-participant-dm-absent`, `SCN-chat-participant-no-resolver`. The catalog is
      bidirectional — these must land in the same commit as the stories, not after.
      Verify: `bun test:stories:contracts`.

## 3. Close `primary`

- [ ] 3.1 Write `SCN-chat-participant-ranking` in `tests/stories/chat/participant-resolution.story.test.ts`:
      a group turn where the model calls `resolve_chat_participant`, candidates come from
      `group_members` ∪ same-context `message_metadata` senders, and the returned list is
      ordered exact > prefix > substring. Seed the sender in the **same storage context id**
      the resolver later queries — `message_metadata` is thread-local by design.
      Verify: `STORY tests/stories/chat/participant-resolution.story.test.ts`.
- [ ] 3.2 Extend the same story with the resolved id reaching `delivery.mention_user_ids`
      on a scheduled prompt, which is what the behavior says the tool exists for.
      Verify: same command.
- [ ] 3.3 Write `SCN-chat-participant-label-fallback`: one candidate with a seeded label,
      one with none (falls back to username), one with neither (falls back to userId), and
      one whose label lookup throws (falls back, does not fail the turn — `roster.ts` has an
      explicit `catch` for this). Verify: same command.

## 4. Close `authorization-routing` — one scenario per denial surface

- [ ] 4.1 Write `SCN-chat-participant-dm-absent`: in a DM context the tool is absent from
      the offered tool set, so the model cannot call it. Asserts the
      `contextType === 'group'` conjunct at `src/tools/tools-builder.ts:270` alone.
      Verify: same command.
- [ ] 4.2 Write `SCN-chat-participant-no-resolver`: in a group context with no
      `chatParticipantResolver` injected, the tool is absent. Asserts the
      `chatParticipantResolver !== undefined` conjunct alone. Do not merge 4.1 and 4.2 —
      a single combined negative passes when either conjunct holds. Verify: same command.

## 5. Flip the ledger

- [ ] 5.1 In `tests/stories/catalog/behaviors.ts`, set `chat-participant-resolution` to
      `state: 'implemented'`, `proven` carrying both dimensions at tier `'0'` with their
      scenario ids, `missing: {}`. Rewrite the rationale to state what each dimension now
      proves **and the residue it does not** — the roadmap requires the residue to survive
      the close. Verify: `STORY tests/stories/harness/behavior-coverage.test.ts`.

## 6. Verify and re-record

- [ ] 6.1 Run the full story lane and its contracts: `bun test:stories:contracts` then
      `bun test:stories`.
- [ ] 6.2 Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`.
      Re-run any load-induced failure file-by-file before calling it a regression.
- [ ] 6.3 Confirm the T0 story coverage floor still holds: `bun test:stories:coverage`.
      Raise it from a green run with `bun coverage:ratchet:stories` only if it improved.
- [ ] 6.4 After merge to master, re-record the qualification baseline: run the five
      verification commands and update `## Foundation baseline` in
      `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`
      with the new `baselineSha`, `treeHash`, frozen-input count and manifest scenario
      count, keeping `d17459ee5` in the supersession chain. Update the open-dimension count
      in `## What closes a dimension` from 14 to 12.
