## 1. Baseline and command vocabulary (test-first)

- [x] 1.1 Pin the baseline the command sits on: a plain comment (no slash command) on a delivered PR starts no run, posts no reply, and performs no PR lookup — assert the current no-op behavior in the trigger/pr-door tests (no production change expected; test passes before and after)
- [x] 1.2 Write failing tests for `acceptedCommands`: `/follow-up` offered exactly in `COMPLETE`/`PR_DELIVERY` with a pull request named (including the issue-surface state), offered nowhere else, and absent on a cancelled `COMPLETE` that names no PR — run `bun test tests/opencode-agent/`
- [x] 1.3 Implement: add `/follow-up` to `SLASH_COMMANDS`, add the `COMMAND_APPLIES` predicate (`COMPLETE`/`PR_DELIVERY` with `prNumber`), deliberately no `COMMAND_SIGNALS` entry — verify with `bun test tests/opencode-agent/commands.test.ts`
- [x] 1.4 Write failing tests for the refusal and dispatch paths: undelivered `/follow-up` gets the `refuseUnknown` wording naming delivered pull requests (with the accepted-commands list), `sideOperation` returns the `followUp` flag only on the predicate, argument-less `/follow-up` is refused with usage and buys no turn, fork look-alike still refused with no turn — run `bun test tests/opencode-agent/` (red)
- [x] 1.5 Implement: `refuseUnknown` `/follow-up` wording, `sideOperation` `/follow-up` branch (usage refusal for an empty argument), `followUp?: boolean` on `TriggerOutcome` and `MachineInput` — verify with `bun test tests/opencode-agent/` and `bun run typecheck`

## 2. Surface exception

- [x] 2.1 Write failing tests: `/follow-up` accepted on the originating issue while a PR is open (exception), every other command still refused with the pointer to the PR, `/follow-up` on the issue before any PR gets the ordinary wrong-command refusal, reply posted on the surface typed — run `bun test tests/opencode-agent/` (red)
- [x] 2.2 Implement: extend `commandSurface` in `feedback-target.ts` to take the command and return 'accepted' for `/follow-up` on the issue once a PR exists; `applyTrigger` unchanged — verify with `bun test tests/opencode-agent/`

## 3. Workflow arm (forced red-first)

- [x] 3.1 Run `bun test tests/opencode-agent/workflow.test.ts` and confirm it now fails: the PR-comment arm's `contains` list in `.github/workflows/agent-pipeline.yml` lacks `/follow-up` while `SLASH_COMMANDS` carries it
- [x] 3.2 Add `/follow-up` to the arm's `contains` list (single-line edit; no other workflow change) — verify with `bun test tests/opencode-agent/workflow.test.ts` and `bun workflows:lint`

## 4. Follow-up handler, size gate, and notices

- [x] 4.1 Write failing handler tests: size gate fires before any git operation with a zod verdict `{size, reason}` stated on both paths; too-big outcome → zero commits, zero pushes, remote branch head unchanged, reply carries reason plus a ready-to-paste issue draft (title + description referencing the PR); small outcome → follow-up commit(s) on `agent/issue-<n>`, reconcile-merge before push (never rebase/force), reply names files/checks/sha; protected-path drop reported; review loop never entered and `reviewAttempts` unchanged; run `bun test tests/opencode-agent/` (red)
- [x] 4.2 Write failing tests for the pre-turn gates: token ceiling asked before the assessment turn (over budget → notice only, no turn); checks-red → nothing pushed, branch left as found, failure reported with what ran; state byte-identical in phase/attempts/resumeFrom/per-PR budgets after every outcome, spend rewritten in place, reply carries no state block — run `bun test tests/opencode-agent/` (red)
- [x] 4.3 Write failing framing pins: request enveloped under the maintainer-note framing with the handler nonce; apply instructions carry `PROTECTED_PATHS_RULE` and `MINIMALITY_RULE` verbatim plus the forbidden-git rule — assert against the constants in the `instructions.test.ts` style — run `bun test tests/opencode-agent/instructions.test.ts` (red)
- [ ] 4.4 Implement `follow-up-notices.ts`: renderers for usage refusal, over-budget notice, applied report (decision + reason, files, checks, sha), too-big decline with issue draft, checks-red failure, hard failure — verify with `bun run typecheck`
- [ ] 4.5 Implement `phases/follow-up.ts` (`runFollowUp`, `runSync`/`answer.ts` shape): `ensureBranch` (standard drift guard), token-ceiling check, one `plan`-profile `promptForJson` assessment turn over the enveloped request + change-folder digest + branch diff stat, one `build`-profile apply turn with the pinned instructions, pipeline re-runs the model-named test commands plus `AGENT_CHECK_COMMAND` via the `check-loop.ts` runner seam, `commitAll` under commit-repair, `git-reconcile` merge, push, single exit via `postAnswer` with spend folded into the carried state — verify with `bun test tests/opencode-agent/`
- [ ] 4.6 Wire the dispatch: `driveMachine` calls `runFollowUp` beside `runSync`, ahead of both budget stops — verify with `bun test tests/opencode-agent/` (the 4.1–4.2 tests go green end to end)
- [ ] 4.7 Confirm the mutation ratchet is satisfied on the new module: run `bun run test:mutate:changed` and check the verdict-branch and zero-commit-guarantee mutants are killed (persisted-state assertions are the killers)

## 5. Docs

- [ ] 5.1 `opencode-agent/README.md`: add the `/follow-up` row to the command table and a `### /follow-up` section (acceptance, size gate, both outcomes, the issue-surface exception) — verify with `bun run format:check` on the file
- [ ] 5.2 `opencode-agent/CLAUDE.md`: note the surface exception as the one carve-out in `commandSurface` and the side-operation dispatch — verify with `bun run lint`

## 6. Full verification

- [ ] 6.1 Run the full suite and checks: `bun test`, `bun run typecheck`, `bun run lint`, `bun check:full`, `bun workflows:lint`
- [ ] 6.2 Update affected `docs/architecture/*.md` pages (coding-sessions.md command mentions, if any) — verify with `bun run lint` and `bun run format:check`