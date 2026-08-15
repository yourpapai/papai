<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Ask whether a piece of scope needs to exist

## 1. Pin the delivery contract before relying on it

- [x] 1.1 `tests/sdd-runner/draft.test.ts:129` already asserts rules reach the drafter
      prompt. Read it and confirm it covers `rules.proposal` specifically; extend it only
      if it does not. Do not duplicate an assertion that already holds.
      Verify: `bun test tests/sdd-runner/draft.test.ts`
- [x] 1.2 `tests/opencode-agent/phases.test.ts` stubs the driver with `rules: []`, so the
      forwarding in `plan-draft.ts:159` is never exercised. Write a failing case with a
      non-empty rules array asserting each entry reaches the drafted artifact brief
      verbatim, then confirm the existing implementation satisfies it.
      Verify: `bun test tests/opencode-agent/phases.test.ts`

## 2. The rules

- [x] 2.1 Add two entries to `rules.proposal` in `openspec/config.yaml`: state the concrete
      consequence of not building each declared capability, and name the existing
      capability or module that already covers it where one does. Route scope rejected on
      those grounds into the `Non-goals` section the rules already require.
      Verify: `bun run format:check`
- [x] 2.2 Add the reuse rung to `rules.design`, beside the existing new-dependency rule it
      generalises. Do not restate the dependency rule — the two are one question at two
      levels and the existing wording stays.
      Verify: `bun run format:check`
- [x] 2.3 Confirm `rules.tasks` is untouched, and that `openspec instructions tasks` for an
      existing change returns exactly the rules it returned before.
      Verify: `openspec instructions tasks --change agent-minimality-ladder --json`

## 3. The boundary, written down

- [ ] 3.1 Add a short section to `docs/architecture/sdd-pipeline.md` stating that scope
      minimality governs what a change admits and task atomicity governs how admitted work
      is divided, naming `rules.proposal` and `decompose.ts`'s atomicity checker as the two
      sides. This ships in the same commit as task 2, not as a follow-up
      (`design.md` D3, Risks).
      Verify: `bun run format:check`
- [ ] 3.2 Cross-reference the boundary from `CLAUDE.md`'s Pi Workflow routing table entry
      for `/opsx:propose`, one line, so a reader arriving from the routing table finds it.
      Verify: `bun run format:check`

## 4. Validate against a real change

- [ ] 4.1 Run `openspec validate --strict` across every change in `openspec/changes/` to
      confirm the added rules break no existing artifact — rules shape drafting, but a
      malformed entry surfaces at validation.
      Verify: `openspec list --json` then `openspec validate <name> --strict` per change
- [ ] 4.2 Run the full gate and fix anything it surfaces.
      Verify: `bun run test && bun run typecheck && bun run lint && bun run sdd-runner:typecheck`
