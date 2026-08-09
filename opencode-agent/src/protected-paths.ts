// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Paths a commit by this pipeline may not carry, because a push carrying them
 * is refused by the remote rather than by anything here.
 *
 * GitHub rejects a push from a GitHub App or an Actions token that creates or
 * updates a file under `.github/workflows/`, unless the App holds the
 * `workflows` permission — and the `permissions:` block a workflow may grant
 * its own `GITHUB_TOKEN` has no `workflows` key at all, so the default token
 * can never do it. The rejection is not per file: `git push` is atomic, so one
 * refused workflow file discards the entire commit. Issue #240 lost two runs of
 * finished, unrelated work that way, several hundred thousand tokens each,
 * because the plan's last step edited `agent-pipeline.yml`.
 *
 * So this is a **guardrail, not a policy**: the pipeline is not deciding that
 * the agent should be denied its own workflow, it is refusing to build a commit
 * the remote has already announced it will not take. Grant the App
 * `workflows: write` and this list is what should shrink.
 *
 * There is a second reason to keep it even then, and it is the stronger one: an
 * agent that can rewrite `agent-pipeline.yml` can rewrite the permissions,
 * concurrency group, guardrails and secret wiring that bound it, in a job that
 * job itself defines. Widening this list is a privilege decision, not a
 * convenience.
 *
 * Enforced in `git-commit.ts`, where the model has no say — the prompts state
 * the rule so a well-behaved turn never writes such a file, but a rule the
 * model has to remember is not a guardrail.
 */

/** Prefixes, matched against forward-slash repo-relative paths. */
export const PROTECTED_PREFIXES: readonly string[] = ['.github/workflows/']

/** Whether one staged path is one a push by this pipeline cannot carry. */
export const isProtectedPath = (path: string): boolean => PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))

/**
 * The protected paths among a staged set, in the order they were staged.
 *
 * Takes plain strings rather than `StagedFile`s so this module knows nothing
 * about the diff guard: the two answer different questions — that one judges
 * what a change set *contains*, this one what a remote will *accept* — and a
 * shared type would be the first step to sharing a verdict.
 */
export const protectedAmong = (paths: readonly string[]): string[] => paths.filter(isProtectedPath)

/** What the log and the model are told when a staged change set carried some. */
export const protectedPathsNotice = (dropped: readonly string[]): string =>
  `Dropped ${dropped.length} file(s) this pipeline's token cannot push: ${dropped.join(', ')}. ` +
  'A push touching .github/workflows/ is refused by GitHub unless the App holds the `workflows` permission, ' +
  'and the refusal discards the whole commit — so these are excluded and everything else is kept. ' +
  'Apply them by hand, or grant the permission.'
