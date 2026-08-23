<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Letting the agent change its own workflow

Research only. Nothing here is implemented; `src/protected-paths.ts` still drops
every `.github/workflows/` path out of the index, and should keep doing so until
one of the options below is chosen deliberately.

The question this answers: the guardrail is right about the remote, but when the
agent is working *on itself* the blocked file is often the whole task, and "say
what a maintainer should apply by hand" is a dead end that costs a round.

## 1. What is actually refused, and by whom

- The `permissions:` block a workflow grants its own `GITHUB_TOKEN` **has no
  `workflows` key**. The default token can therefore never create or update a
  file under `.github/workflows/`, at any permission level, on any event.
- A GitHub App installation token can, but only if the App holds the
  `workflows: write` permission and has been re-installed since.
- A **classic** PAT can, with the `workflow` scope. A **fine-grained** PAT can,
  with the repository permission named **Workflows** — confirmed present in
  GitHub's fine-grained permission table, which lists it against exactly
  `PUT /repos/{owner}/{repo}/contents/{path}`, `DELETE …/contents/{path}`,
  `POST …/git/refs` and `PATCH …/git/refs/{ref}`.
- That endpoint list is the important part: **the REST API is not a bypass.**
  Committing through the Contents API or moving a ref through the Git API is
  gated by the same permission as `git push`. There is no "write it another way"
  option; there is only "hold the permission" or "do not carry the file".
- The refusal is per **push**, not per file, and a push is atomic — which is why
  the current guardrail drops rather than refuses. Issue #240 lost two runs of
  finished, unrelated work to the atomicity alone.

Only `.github/workflows/` is protected. `.github/actions/`, `scripts/`,
`package.json` and the Dockerfile are ordinary files the agent already commits —
see option E, which is built on that.

## 2. What granting the permission actually opens

The README says an agent that can rewrite `agent-pipeline.yml` can rewrite the
permissions and secret wiring that bound it. That is true but understates the
timing, and the timing is the whole risk assessment:

- `issues`, `issue_comment` and `workflow_run` **always run the default-branch
  copy** of the workflow file. So an edit to `agent-pipeline.yml` on
  `agent/issue-<n>` changes nothing about the job that made it. It takes effect
  only after a human merges. That door has a human in it already.
- `pull_request` runs the workflow **from the head of the pull request**, and a
  same-repo branch is not a fork, so the full `secrets` context is available to
  it. `ci.yml` triggers on `pull_request` against master. **An agent that can
  push `ci.yml` can read every repository-level secret on its own branch, with
  no merge and no human.** `LLM_API_KEY`, `AGENT_LOG_KEY` and
  `AGENT_GITHUB_TOKEN` itself are all repository secrets here.

So the two workflow files are not the same risk, and a blanket grant is priced
by the more permissive one.

Two things bound the blast radius and are worth stating precisely, because they
change what the marginal risk is:

- `ci.yml` today declares `permissions: contents: read` and references **no**
  secrets. The delta a workflow edit buys an attacker is the ability to *name*
  `secrets.*` in an expression and to raise that `permissions:` block — not the
  ability to run branch-controlled code, which CI already does (`bun run test`,
  the Docker build, everything under `scripts/`). The containment story was
  never "the agent cannot execute code in CI"; it is "the job it executes in
  holds nothing".
- `deploy.yml` runs under `environment: production`. If its secrets are
  environment secrets and the environment carries a deployment-branch rule, a
  job on `agent/issue-<n>` cannot read them whatever the workflow says. **Verify
  this in repository settings before pricing any option below** — if those are
  repository-level secrets, the SSH key and the Kaneo/Postgres credentials are
  in the same bucket as `LLM_API_KEY`, and the price of a blanket grant goes up
  by an order of magnitude.

And the untrusted-input reminder: issue and comment bodies reach the prompt. The
question is never only "would the model do this" but "would the model do this if
an issue body asked it to". The pipeline's envelope defences are good; they are
not a reason to hand the same turn a credential that can mint secrets.

## 3. The options

### A. Grant the agent's own token `workflows: write`

The README's stated route: give the App behind `AGENT_GITHUB_TOKEN` the
permission, re-install, drop the prefix from `PROTECTED_PREFIXES`.

- **Cost:** one setting and a one-line deletion. Nothing else to build.
- **What it opens:** section 2, in full. The token is mounted in the same step as
  the model session, for every run, whether or not the task is about a workflow.
- **Verdict:** the cheapest and the widest. Reasonable on a private repo whose
  secrets are all environment-scoped; hard to justify here while `ci.yml` runs
  from the PR head and repository secrets exist.

Credential variants, if this is chosen: a GitHub App token minted per-run with
`actions/create-github-app-token` is preferable to either PAT — it is
short-lived, scoped to the installation, and not tied to a human account. A
fine-grained PAT is second (scoped, expiring). A classic PAT with `workflow`
scope is the worst: it carries `repo` across every repository the account can
reach.

### B. Two-token split — staged proposal, separate applier job

Keep the model's token unable to push workflows. Have the agent commit its
intended workflow change to a path it *is* allowed to carry — say
`.github/workflow-proposals/<name>.yml` — and let a **separate job**, after the
model session has exited, move it into place and push it with a
workflow-capable token.

- The workflow-capable credential is never mounted in a step the model can
  reach; the applier is deterministic code, and it lives in the default-branch
  copy of `agent-pipeline.yml`, which the agent cannot change without a merge.
- The existing drop in `stageAllowed` stays exactly as it is. Nothing about the
  atomic-push hazard changes: the agent's own commit still carries no protected
  path.
- The prompt rule flips from "say what a maintainer should apply" to "write it
  to `.github/workflow-proposals/`", which is a remedy the model can reach in
  the same turn — the thing `PROTECTED_PATHS_RULE` currently cannot offer.
- **Cost:** a real build. A staging path convention, an applier step, a second
  push (so a second CI run), and `ciBlockedPaths`-style plumbing so a failed
  apply is reported rather than silently dropped.
- **What it does not solve on its own:** the applier will push whatever it is
  given. Without option D it is option A with extra steps — the model no longer
  *holds* the credential, but it still *directs* it.

### C. Maintainer-dispatched applier

Same staging path as B, but the applier is its own `workflow_dispatch` workflow
a maintainer clicks, or a `/approve-workflow` command on the thread.

- `workflow_dispatch` requires write access to the repository, so the human is
  structural rather than conventional. A slash command reuses machinery that
  already exists — `checkSender` already requires `OWNER | MEMBER |
  COLLABORATOR`, and the vocabulary is already differential-tested against the
  `contains(…)` arms in `agent-pipeline.yml`.
- **Cost:** less than B (no per-run credential wiring, no ordering question),
  and it keeps a human on the one action that can escalate.
- **Trade:** the maintainer is still in the loop — but at one click, not one
  hand-applied commit, and without re-reading a diff the agent already wrote.

### D. Policy gate on what may be applied

Not an option on its own; the thing that makes B or C worth more than A. Before
any applier pushes:

1. `bun workflows:lint`. An invalid workflow is not a red build — GitHub rejects
   the file and starts no job — so this is the only thing that catches one.
   Note the existing runner takes **no file arguments**: actionlint walks
   `.github/workflows` itself, so a proposal has to be copied into place and
   then linted, not linted where it is staged.
2. A diff policy over the proposed file, refusing outright: any change to
   `permissions:`, any new `secrets.` reference, any change to `on:` (and
   `pull_request_target`, `workflow_run` and `schedule` at all), `runs-on:
   self-hosted`, and any `uses:` that is not a 40-hex SHA — this repo pins
   everything, so that last one is a cheap and total rule.
3. A file allowlist. `agent-pipeline.yml` is the file the agent has business
   editing, and the one whose edits need a merge to take effect. `ci.yml` is the
   one that runs from the PR head; keeping it off the list removes the entire
   escalation path in section 2 while leaving the common case working.

Rule 3 is doing most of the work, and it is worth noticing that it inverts the
intuition: the agent's *own* workflow is the safe one to let it edit.

### E. Make the edit not be a workflow edit

The cheapest structural answer, and it needs no new privilege at all.

`.github/workflows/` is the only protected prefix. A local composite action
under `.github/actions/` is an ordinary file the agent can already commit. So
step bodies that live in a composite action, or in a `bun run …` script, stop
being workflow edits — `agent-pipeline.yml` is 866 lines, but only 8 of them are
`run: |` blocks, and the file is mostly trigger graph and commentary.

Two things to weigh:

- For `agent-pipeline.yml` this is *safe*, and for a non-obvious reason: the
  agent job runs the default-branch workflow and starts from a base-branch
  checkout, so a composite action edited on `agent/issue-<n>` does not take
  effect until merge. The human gate survives the move.
- For `ci.yml` it is neutral, not safe: that job checks out the PR head, so a
  composite action it calls is branch-controlled. As established in section 2,
  so is everything else it runs, and it holds nothing — but this is the reason
  the "extract the steps" move must be judged per workflow rather than as a
  policy.

What it does not reach: trigger graphs, `permissions:`, concurrency, secret
wiring. Those are the workflow edits that genuinely need a workflow edit — and
they are exactly the ones a human should be looking at.

### F. Make the current dead end applicable

Independent of everything above, and worth doing regardless. Today the model is
told to "say in your reply exactly what a maintainer should apply by hand", and
what comes back is prose. Have it write the intended file to a staged path and
emit a `git apply`-able patch alongside the report, so the remedy is one command
rather than a retyped edit. That is most of the value of B and C at none of the
privilege cost, and it makes the staging convention B and C need exist first.

## 4. Recommendation

A ladder, not a choice — each rung is worth taking on its own and each makes the
next cheaper:

1. **F**, now. Cheap, no privilege change, and it turns the round the guardrail
   currently costs into a one-command apply.
2. **E**, where a step body is what keeps changing. Removes the need for a
   workflow edit rather than authorising one.
3. **C + D**, if 1 and 2 leave real work blocked. A maintainer-dispatched
   applier with the file allowlist, `workflows:lint` and the diff policy, minting
   a short-lived App token in a job the model cannot reach.
4. **A**, only after confirming `deploy.yml`'s secrets are environment-scoped
   with a deployment-branch rule, and only with `ci.yml` protected some other
   way — CODEOWNERS on `.github/workflows/ci.yml` plus a required review, or a
   branch rule.

Do not take A as a first step because it is the smallest diff. It is the only
option on this page that hands a model-directed turn a credential that can read
every repository secret without a human, and the smallest diff is not the goal.

## 5. Sources

- Fine-grained PAT permission table, "Workflows" repository permission and its
  endpoint list — <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>
- Which ref a workflow runs from per event —
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- `pull_request` vs `pull_request_target` context and secret availability — same
  page, `pull_request_target` section.
- The refusal itself, and that a GitHub App token inherits the App's
  `workflows` permission — community discussions
  [#35410](https://github.com/orgs/community/discussions/35410),
  [#27072](https://github.com/orgs/community/discussions/27072).
