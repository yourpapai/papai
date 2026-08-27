# Tasks: protected-path-manual-fix-visibility

## 1. Loop summary carries needs-human content (R1)

- [x] 1.1 TDD red: `tests/review-loop/` summary test asserting `issuesBlock` renders `issue.suggestedFix` and `verifierDecision.reasoning` as indented content under a needs-human record's line, truncated at the bound with the `ledger.json` marker
- [x] 1.2 TDD red: summary tests for the two fallbacks — record with neither field (infra-forced needs-human) renders the ledger pointer instead of an empty block; over-GROUP_CAP records stay one-liners
- [x] 1.3 Implement in `review-loop/src/summary.ts` `issuesBlock` per design D1 (combined-content bound, explicit truncation marker)
- [x] 1.4 Ledger fidelity guard (design D2, amended during apply): `tests/review-loop/issue-ledger.test.ts` pins that `recordNeedsHuman` stores the fixer's reasoning **untruncated** in the ledger record while the `verify_complete` trace event keeps its 200-char bound — no production change, the invariant already holds

## 2. Push guard surfaces the reverted diff (R2)

- [x] 2.1 TDD red: `tests/opencode-agent/` test asserting the new `Git.diffSince(since, paths)` seam method shells `git diff <since> -- <paths>`
- [x] 2.2 Implement `diffSince` in the git module behind the `Git` interface
- [x] 2.3 TDD red: `review-push` tests — `dropUnpushable` captures the diff before `revertPaths`; `blocked()` returns path-keyed records with optional diff; a same-path re-revert overwrites with the newest diff; capture failure degrades to path-only and never throws
- [x] 2.4 Implement in `opencode-agent/src/phases/review-push.ts` per design D3
- [x] 2.5 TDD red: `phases/review` renderReport test — reverted-path note renders per-path fenced patch blocks with the by-hand instruction, per-path and total bounds with truncation markers and a `git show` recovery reference (design D4); then implement in `src/phases/review.ts`

## 3. Prompts and docs

- [x] 3.1 Add the self-contained-suggested-fix clause to the reviewer prompt's protected-path paragraph in `review-loop/src/prompt-templates.ts` (design D5); confirm `protected-paths-rule.test.ts` still passes (shared constant unchanged)
- [x] 3.2 Update `review-loop/AGENTS.md` (fix instruction contract: needs-human content now rides the summary) and `opencode-agent/CLAUDE.md` (push-guard doctrine: the guard reports the diff it reverted, paths-plus-patch)

## 4. Verification

- [ ] 4.1 `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint` and the `tests/opencode-agent/` suites touched above
- [ ] 4.2 `bun run test:affected --base=origin/master`, then a full `bun run test` before finishing
