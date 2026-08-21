<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## 1. Vocabulary and dispatch

- [x] 1.1 Add `/sync` to `SLASH_COMMANDS` and the `COMMAND_APPLIES` row (`state.prNumber !== null`); test `acceptedCommands` offers it exactly when a PR exists and the wrong-command refusal lists it otherwise. Verify: `bun test tests/opencode-agent/commands.test.ts`
- [x] 1.2 Branch `/sync` beside `/ask` in `applyCommand` (`triggers.ts`): non-moving side-op dispatch, no `COMMAND_SIGNALS` entry, no transition consulted; test refusal without PR and dispatch with one. Verify: `bun test tests/opencode-agent/triggers.test.ts`
- [x] 1.3 Add the `contains(..., '/sync')` clause to the workflow's pull-request arm; `workflow.test.ts` is written first and fails until the YAML matches `SLASH_COMMANDS`. Verify: `bun test tests/opencode-agent/workflow.test.ts`

## 2. Git merge operations

- [x] 2.1 Test-first: `mergeBase(base)` returning `clean | up-to-date | conflicted(paths)` against fixture repositories (clean merge, fast-forward/current, conflict with `--diff-filter=U` path list); then implement in `git.ts` beside `ensureBranch`. Verify: `bun test tests/opencode-agent/git.test.ts`
- [x] 2.2 Test-first: `completeMerge()` (author per `commit-identity.ts`, no `stageAllowed`/diff-guard on the path) and `abortMerge()` (clean tree after); then implement. Verify: `bun test tests/opencode-agent/git.test.ts`

## 3. Sync handler

- [x] 3.1 Test-first: `src/phases/sync.ts` clean path — `ensureBranch` → `mergeBase` clean → push, reply reports commits merged and branch, zero model turns, persisted state byte-identical (the workspace rule: assert the persisted state, not the returned status). Verify: `bun test tests/opencode-agent/phases.test.ts`
- [x] 3.2 Test-first: up-to-date path — nothing pushed, up-to-date reply, no model turn; and refusal translation when the push is rejected with the workflows-permission sentence (remedy names update-branch), matcher in `errors.ts` beside `pullRequestForbiddenError`. Verify: `bun test tests/opencode-agent/phases.test.ts`
- [x] 3.3 Test-first: conflict path — repair rounds bounded by `AGENT_SYNC_REPAIR_MAX_ROUNDS` (`boundedInt`, default 3, `ROUND_RANGE`); token ceiling asked before each round (over budget → no turn, ceiling named); exhausted → `abortMerge`, clean tree, failure reply with remedy; resolved → `completeMerge` + push. Model never runs git: the repair prompt's forbidden-git rule is a pinned constant. Verify: `bun test tests/opencode-agent/phases.test.ts tests/opencode-agent/config.test.ts`
- [x] 3.4 Test-first: reply is `postAnswer`'s write (plain comment on the trigger surface, no block); repair-turn spend rewritten in place via `state-persist.ts` (state otherwise unchanged). Verify: `bun test tests/opencode-agent/phases.test.ts`

## 4. Steering notes

- [x] 4.1 Test-first: note-render helper — enveloped section with fixed guidance framing (plan/folder truth, `/changes` re-plans); framing constant pinned `instructions.test.ts`-style. Verify: `bun test tests/opencode-agent/instructions.test.ts`
- [x] 4.2 Test-first: resumed handlers read `/retry`/`/continue` arguments — implement-from-`resumeFrom` and continuation-from-`INCOMPLETE` prompts carry the note; argument-less commands byte-identical to today; note never persisted (no new block, no handoff change). Verify: `bun test tests/opencode-agent/phases.test.ts`

## 5. Full verification and docs

- [ ] 5.1 Run full `bun test`, `bun run typecheck`, `bun run lint`; update `opencode-agent/README.md` (command table, `/sync` section) and `opencode-agent/CLAUDE.md` (vocabulary, side-op rule); `openspec validate --strict` passes. Verify: `bun test && bun run typecheck && bun run lint && openspec validate --strict`
