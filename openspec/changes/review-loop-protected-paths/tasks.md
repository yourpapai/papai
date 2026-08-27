# Tasks: review-loop-protected-paths

## 1. Review-loop prompts carry the protected-paths rule

- [x] 1.1 In `tests/review-loop/prompt-templates.test.ts`, add failing assertions: the fix,
      build-retry and inspector-retry prompts carry the protected-paths rule verbatim (constant
      exported from `prompt-templates.ts`), the rule names `.github/workflows/` and the
      by-hand alternative, the fixer mapping line routes a workflow-requiring fix to
      `needs_human` with the change in `reasoning`, and `buildReviewPrompt` carries the
      manual-application line for workflow-fix findings.
- [x] 1.2 In `tests/opencode-agent/protected-paths-rule.test.ts` (new, beside
      `minimality-rule.test.ts`), add the failing cross-workspace pin: the review-loop
      constant contains `opencode-agent`'s `PROTECTED_PATHS_RULE` text verbatim.
- [x] 1.3 Add `PROTECTED_PATHS_RULE` to `review-loop/src/prompt-templates.ts` — the agent-side
      text verbatim plus the one schema-mapping line (design D1) — and wire it into
      `buildFixPrompt`, `buildRetryFixPrompt`, `buildRetryFixWithInspectorFeedbackPrompt`, and
      the reviewer line into `buildReviewPrompt` (design D2). Both suites green.

## 2. The push guard records the head it actually pushed

- [x] 2.1 In `tests/opencode-agent/phases.test.ts`, add a failing case after a guarded push
      (one that reverted a protected path): a second push's `dropUnpushable` pass must see no
      protected change since the recorded push point — i.e. `changedSince` is called with the
      post-revert head, and `revertPaths` is never asked to restore the guard's own revert.
- [x] 2.2 In `opencode-agent/src/phases/review-push.ts`, set `pushedAt` from a fresh
      `readHead(input)` after `deps.git.push(branch)` instead of the head captured before
      reconcile/revert (design D3). Suite green.

## 3. Documentation

- [ ] 3.1 `review-loop/AGENTS.md`: the fix instruction contract gains the protected-paths rule
      as a carried instruction (fourth rule, beside minimality/check-behind/no-prose), noting
      the duplication pin.
- [ ] 3.2 `opencode-agent/CLAUDE.md`: the review-push doctrine records the push-point rule —
      the recorded head is the one the remote accepted, post-revert — with run 32992114904 as
      the incident.

## 4. Verification

- [ ] 4.1 `bun run test:affected` over the touched paths in the loop; one full
      `bun run test` plus `bun check:full` before finishing; `openspec validate
      review-loop-protected-paths --strict` passes.
