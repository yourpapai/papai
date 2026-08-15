<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Carry the minimality ladder to every agent that writes production code

## 1. One definition, pinned across workspaces

- [x] 1.1 Export `MINIMALITY_LADDER` from `review-loop/src/prompt-templates.ts` (it is
      module-private today) and add a case to `tests/review-loop/prompt-templates.test.ts`
      asserting each of the three fix prompts `toContain` the exported constant. This is
      additive to the existing obligation-shaped assertions — do not replace them; they
      cover a different failure (see `design.md` D4).
      Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [x] 1.2 Write a failing case in a new `tests/opencode-agent/minimality-rule.test.ts`
      asserting that `opencode-agent`'s `MINIMALITY_RULE` equals `review-loop`'s
      `MINIMALITY_LADDER`, then add the constant to `opencode-agent/src/prompts.ts` to
      make it pass. Both texts imported directly; no copy in the test.
      Verify: `bun test tests/opencode-agent/minimality-rule.test.ts`
- [x] 1.3 Extend that suite with a failing case that the constant contains the clause
      naming what is never cut — validation, error handling, security, tests — and that
      it does not advise minimising file count, then confirm the constant satisfies both.
      Verify: `bun test tests/opencode-agent/minimality-rule.test.ts`

## 2. New carriers

- [x] 2.1 Add failing cases to `tests/opencode-agent/instructions.test.ts` asserting that
      `IMPLEMENT_INSTRUCTIONS` and `CI_FIX_INSTRUCTIONS` each `toContain(MINIMALITY_RULE)`,
      following the `PROTECTED_PATHS_RULE` cases already in that file, then carry the
      constant in both blocks.
      Verify: `bun test tests/opencode-agent/instructions.test.ts`
- [x] 2.2 Add a failing case asserting that `PROPOSE_INSTRUCTIONS` and
      `PROPOSE_FILES_INSTRUCTIONS` do **not** contain the rule, so that a later edit
      adding it to a drafting block fails rather than passing quietly (`design.md` D3).
      Verify: `bun test tests/opencode-agent/instructions.test.ts`
- [x] 2.3 Confirm the implement and CI-fix phases still assemble a prompt end to end with
      the longer instruction block, and that no prompt-budget cap now truncates it.
      (`prompt-budget.ts` has no suite of its own; `adapters.test.ts` is what covers it.)
      Verify: `bun test tests/opencode-agent/phases.test.ts tests/opencode-agent/adapters.test.ts`

## 3. Main-agent conventions

- [x] 3.1 Add one Key Conventions paragraph to `CLAUDE.md`, placed adjacent to the
      existing `max-lines` bullet so the two are read together: the ladder, the clause
      naming what is never cut, and no file-count guidance. Mirror it into `AGENTS.md`.
      Verify: `bun run format:check`
- [x] 3.2 Record the rule and its carriers in `review-loop/CLAUDE.md` (which already
      documents the fix instruction contract) and `opencode-agent/CLAUDE.md` (beside the
      `PROTECTED_PATHS_RULE` note), naming the equality test as the drift pin.
      Verify: `bun run format:check`

## 4. Full gate

- [ ] 4.1 Run the full gate and fix anything it surfaces.
      Verify: `bun run test && bun run typecheck && bun run lint && bun run review-loop:test && bun run opencode-agent:typecheck`
