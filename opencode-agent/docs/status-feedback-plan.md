<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Status feedback UX — audit and plan

How a maintainer finds out what the agent is doing, in what state their issue
is, and where the job that is doing it lives.

Audit of the pipeline as it stands on `claude/opencode-agent-feedback-ux-mr89ep`,
then a staged plan. Nothing here is implemented yet; this is the design and the
reasoning behind it, in the shape the rest of this workspace records decisions.

---

## 1. What a maintainer can see today

Three surfaces exist, and only one of them is durable.

| Surface            | Written by                                           | When                        | Seen by                  |
| ------------------ | ---------------------------------------------------- | --------------------------- | ------------------------ |
| Issue comments     | `run-report.ts` `postAndAppend`, from phase handlers | **only when a phase ends**  | everyone                 |
| Actions job log    | `progress.ts` events + heartbeat                     | continuously, once a minute | whoever opens it         |
| Hidden state block | `state-manager.ts` `renderStateComment`              | with every comment          | nobody — it is a comment |

That is the whole of it. There are no labels, no reactions, no issue-title
decoration, no link from the issue to the run doing the work, and no surface
that is updated _while_ a phase runs.

Verified absences, not assumptions:

- `grep -rn 'GITHUB_RUN\|run_id\|runUrl' src/` finds `runUrl` only on
  `CiTriggerEvent` — the URL of the **red run that triggered** a CI fix. The
  pipeline never learns the URL of its _own_ run. The one place it exists is the
  workflow's failure fallback step, which builds `RUN_URL` in YAML and only ever
  posts it when the job itself dies.
- `grep -rni 'label\|reaction' src/` finds four unrelated hits (an
  `activity.ts` comment, `prompts.ts`'s envelope `label`). `GitHubApi` has seven
  methods; none of them touches a label or a reaction.
- `issuePayloadSchema` parses `comment.id`, and `parseIssueEvent` **drops it** —
  so the pipeline currently cannot address the comment that triggered it even if
  it wanted to.

### The nine gaps

**G1 — nothing acknowledges a trigger.** A maintainer types `/approve` and the
next thing that appears on the issue is the finished artefact, up to
`AGENT_TIMEOUT_MS` (default 30 minutes) later; `REVIEW_AND_MUTATE` also runs the
whole `review-loop/` workspace inside that silence, under a 90-minute job
timeout. For that entire window the issue is indistinguishable from one where
the workflow never fired at all — which is also a real outcome, since a
guardrail can drop the event.

**G2 — no link to the running job.** The one question a maintainer has during
the silence in G1 is "is something actually running, and where do I look". The
answer exists (`GITHUB_RUN_ID` is in the runner environment of every step) and is
never wired anywhere. Even the CI-fix comment, which _does_ post a run URL, posts
the red run's — not the agent run repairing it.

**G3 — the state is invisible at a glance.** The phase lives in an HTML comment.
Answering "which of my twelve agent issues are waiting on me" means opening
each one and reading the last comment's prose. An issue list, a project board, a
notification — none of them carry a thing.

**G4 — rejections are silent.** Every one of these produces a log line and
nothing else:

| Path                                                      | What the maintainer typed                      |
| --------------------------------------------------------- | ---------------------------------------------- |
| `guardrails.ts` deny `NOT_MAINTAINER`                     | anything, from an account without write access |
| `triggers.ts` `moveOrSkip` catch                          | `/approve` while in `REVIEW_AND_MUTATE`        |
| `applyCommand` unknown command                            | `/aprove` — a typo                             |
| `applyTrigger` `No actionable command while in ${phase}`  | a plain comment on a non-waiting phase         |
| `applyIntent` `Comment needs no action` / `Empty comment` | a comment the classifier read as chatter       |

A typo'd slash command and a broken pipeline look **exactly the same** from the
issue. This is the cheapest gap to close and probably the most damaging one open.

**G5 — no live surface.** Comments are terminal by construction: `postAndAppend`
is called with a finished `PhaseOutcome`. Nothing exists that can say "round 2 of
4" or "still working" without adding a comment, and adding a comment per tick is
obviously wrong. The heartbeat that already knows all of this writes to a log
nobody has a link to (G2).

**G6 — no consistent visual vocabulary.** Emoji appear in exactly two places —
`implement.ts`'s `REVIEW_LINE` (`✅ clean` / `❌ exited N` / `— not configured`)
and `ci-fix.ts`'s check line — and nowhere else. Headings vary in register:
`### Done`, `### Stopped`, `### Giving up`, `### Run failed in EXECUTION_PLAN`,
`### Waiting`. There is no per-phase glyph, so nothing is scannable.

**G7 — spend is invisible until it is fatal.** `tokensSpent` is persisted and
checked before every phase, and the only time it reaches the issue is
`renderOverBudget`, at which point the issue is dead and `/retry` is explicitly a
lie. A maintainer cannot see the burn approaching.

**G8 — the waiting comment says nothing useful.** `renderSettled` for a
non-terminal phase renders `### Waiting\n\nParked in \`PLAN_REVIEW\`.` — the
phase name, and no statement of what would move it. Every other waiting comment
in the codebase carries a "What now?" block; this one does not.

**G9 — the infrastructure fallback misses half its cases.** The workflow's
`Report an infrastructure failure on the issue` step is gated on
`failure() && github.event.issue.number`. A `workflow_run` event carries no
`issue.number`, so a runner that dies during a CI-fix run posts **nothing**
anywhere. `cancelled()` is not covered either, and a cancelled job is the
documented consequence of G1 — a run that looks hung is a run someone cancels.

---

## 2. Design rules this has to obey

The workspace's existing rules constrain the solution more than the solution
constrains itself. Stating them up front because two of them kill otherwise
obvious designs.

1. **Feedback must never fail a run.** Every write added here is decoration on
   work that matters. A 403 on a label (a token without `issues: write`, a fork
   run, an org policy) must degrade to `log.warn`, never to a failed phase. This
   is the single most important rule in the plan, because every new call is a new
   way to break a pipeline that used to work.
2. **Never send free text through a new `GitHubApi` method without `clean`.**
   `CLAUDE.md` states it; `github.ts` enforces it by making `secrets` required.
   `updateComment` carries free text and must be redacted exactly like
   `createComment`. Label names and reaction contents are pipeline-computed
   constants, so they are treated like `head`/`base` branch names — passed
   through untouched, and that exemption is stated in code rather than implied.
3. **Progress carries names, statuses and counts only.** `activity.ts` decodes
   through schemas that give tool input, tool output and model text nowhere to
   land. An issue comment _is_ covered by outbound redaction, unlike the log — but
   the rule still holds when piping activity to the issue, because a redaction
   list only knows the secrets the pipeline loaded, and a status line is not the
   place to relax that.
4. **The state block is the durability channel and must stay untouched.**
   `findLatestState` restores from the newest agent comment carrying a valid
   block. Any new comment this plan introduces must **not** carry an
   `AGENT_STATE` block, or an edited status comment becomes a second, competing
   source of truth. Testable invariant, and worth pinning as one.
5. **One place per vocabulary.** The recurring defect in this workspace is a fix
   that closes an instance and leaves the class open. A phase→emoji mapping
   spread across five renderers is that defect waiting to happen; it goes in one
   `Record<Phase, …>` so a phase added later fails to compile until it is named.
6. **Comment budget.** More feedback fails by becoming noise. Hard budget: **at
   most one new comment per run** beyond the artefact comments that already
   exist. Everything else is a reaction, a label, or an edit.

---

## 3. The vocabulary

One module, `src/presentation.ts`, owning a total `Record<Phase, PhasePresentation>`.
Every renderer, the label reconciler and the status comment read from it.

| Phase               | Glyph | Label                | Whose turn | Headline                       |
| ------------------- | ----- | -------------------- | ---------- | ------------------------------ |
| `INIT_OR_CLARIFY`   | 🔍    | `agent:triaging`     | agent      | Reading the issue              |
| `INIT_OR_CLARIFY`\* | ❓    | `agent:clarifying`   | **you**    | Waiting on your answers        |
| `DESIGN_SPEC`       | 📋    | `agent:spec-review`  | **you**    | Design spec is waiting for you |
| `EXECUTION_PLAN`    | 🗺️    | `agent:planning`     | agent      | Breaking the spec into steps   |
| `PLAN_REVIEW`       | 🧭    | `agent:plan-review`  | **you**    | Plan is waiting for you        |
| `REVIEW_AND_MUTATE` | 🛠️    | `agent:implementing` | agent      | Writing and reviewing the code |
| `PR_DELIVERY`       | 📦    | `agent:delivering`   | agent      | Opening the pull request       |
| `CI_FIX`            | 🚑    | `agent:ci-fixing`    | agent      | Repairing red checks           |
| `COMPLETE` + PR     | ✅    | `agent:done`         | —          | Delivered                      |
| `COMPLETE`, no PR   | 🛑    | `agent:stopped`      | —          | Stopped                        |
| `FAILED`            | ❌    | `agent:failed`       | **you**    | Run failed                     |

\* `INIT_OR_CLARIFY` is the one phase that is both a working state and a waiting
state — it is where the agent sits after asking questions. The presentation is
therefore keyed on `(phase, whether the last signal was NEEDS_CLARIFICATION)`,
not on the phase alone. Handling that by hand in each renderer is precisely the
class of bug rule 5 exists to prevent, so it belongs in the table's key.

Two orthogonal markers carry the actual filtering value, and they are the part
worth shipping even if the per-phase labels are dropped:

- **`agent:working`** — set at the start of a run, removed when it ends,
  whatever the outcome. "Is something happening right now", answerable from a
  list view.
- **`agent:needs-you`** — set in every **you** row above. "Which of my issues are
  blocked on me", which is the question that actually costs a maintainer time.

`agent:working` has one failure mode: a runner killed mid-flight leaves it stuck
on. Two mitigations, both needed, because either alone leaves a hole — an
`if: always()` cleanup step in the workflow, **and** a reconcile at the top of
every run that computes the desired label set from the restored state and
removes any `agent:*` label the state does not imply. The reconcile is the one
that also repairs an issue whose labels were edited by hand.

**Accessibility.** The glyph is decoration and never the only carrier of
meaning: the phase word sits next to it in every rendering, and the label name is
plain text. A screen reader that announces "clipboard, design spec is waiting for
you" loses nothing by dropping the first word.

**Namespacing.** `AGENT_LABEL_PREFIX` defaults to `agent:`; setting it to `none`
disables labelling entirely. Same shape as `AGENT_REVIEW_COMMAND` — the pipeline
already knows it runs in repositories with their own conventions, and a hardcoded
label set is the papai-specific hardcoding S2-4 was reopened for.

---

## 4. The four channels, and what each one is for

### 4.1 Reactions — instant, zero-noise acknowledgement

Closes **G1** and **G4**, and it is the cheapest thing in this document: one API
call, no thread noise, and it lands on the comment the maintainer just wrote, so
it is already where they are looking.

| Situation                                 | Reaction | Where                       |
| ----------------------------------------- | -------- | --------------------------- |
| Trigger accepted, work starting           | 👀       | triggering comment or issue |
| Comment understood, nothing to do         | 👍       | triggering comment          |
| Command rejected — wrong phase, unknown   | 😕       | triggering comment          |
| Sender lacks maintainer rights            | 😕       | triggering comment          |
| Run finished and delivered a pull request | 🚀       | triggering comment          |

Silent on purpose, still: bot senders, self-recursion, pull-request targets and
CI events. Those are machine noise with no human waiting on them, and the
existing log line is the right amount of record.

Wiring needed: carry `comment.id` out of `parseIssueEvent` (the schema already
parses it and throws it away), and add `addReaction` to `GitHubApi`. Reactions
are idempotent server-side — a repeat returns the existing one — so no
bookkeeping is required.

The one judgement call: reacting to a `NOT_MAINTAINER` comment is a write
triggered by someone without write access. It is bounded (one reaction per
comment, no content, no notification storm), and the alternative is that an
outside contributor's comment vanishes into a log they cannot read.

### 4.2 Labels — the at-a-glance state

Closes **G3**. Reconciled once per run and once more at the end, computing the
desired set from state and issuing the minimal add/remove diff — not a
clear-and-reapply, which would produce two timeline entries per phase and a
visible flicker.

Labels are created on demand with a fixed palette (blue for agent-owned states,
amber for `needs-you`, green for done, red for failed, grey for stopped), and a
422 from `createLabel` means it already exists and is ignored. Per rule 1, every
label call is best-effort.

### 4.3 The live status comment — what is happening right now

Closes **G2**, **G5**, **G7** and **G8**. This is the substantial piece.

One comment per **run**, created when the run starts, edited as it progresses,
finalised when it ends. It is the only comment this plan adds, which is the
entire comment budget from rule 6.

```markdown
### 🛠️ Implementing — run in progress

**Job:** [run #1482, attempt 1](https://github.com/o/r/actions/runs/1482) · started 14:02 UTC · 6m elapsed
**Branch:** `agent/issue-42` · **Pull request:** _not opened yet_

| Phase             |             |
| ----------------- | ----------- |
| 🔍 Triage         | ✅          |
| 📋 Design spec    | ✅ approved |
| 🗺️ Execution plan | ✅ approved |
| 🛠️ Implementation | ⏳ **now**  |
| 📦 Pull request   | ⬜          |

**Doing:** `bash` (running) · 34 tool calls · 218k tokens
**Budget:** 218k of 5,000,000 tokens · attempt 1 of 3
```

Design decisions worth recording, because each had a plausible alternative:

- **One per run, not one per issue.** A single long-lived status comment edited
  forever ends up hundreds of comments above the thing the maintainer just
  typed, which defeats the purpose. Per-run keeps it at the bottom where the
  conversation is, gives every run a permanent record, and — usefully — needs no
  `AgentState` field at all in v1, since the id lives only for the life of the
  process that created it.
- **It carries no `AGENT_STATE` block** (rule 4). The phase-end comments remain
  the sole state channel, so the durability path this plan touches is _none of
  it_. Worth an explicit test: the state restored from a thread containing status
  comments must equal the state restored from the same thread without them.
- **Edits are rate-limited to one per 60 s and skipped when the rendered body is
  unchanged.** A 90-minute run then costs at most ~90 edits, comfortably inside
  the secondary rate limit on content-mutating requests, and unchanged-body
  suppression means a quiet stretch costs nothing.
- **The activity line comes from the existing `ProgressSnapshot`**, which already
  carries exactly `lastAction`, `toolCalls`, `tokens`, `cost` and nothing else —
  so rule 3 is satisfied by construction rather than by care. `HeartbeatOptions`
  grows an optional `onTick`; the log half is unchanged.
- **A failed edit is a warning, not a failure** (rule 1), and a failed _create_
  degrades the run to today's behaviour exactly.

Shape: a `StatusReporter` interface on `PhaseDeps` — `start(state)`,
`enter(phase)`, `tick(snapshot)`, `finish(result)` — with a no-op implementation
used by every existing test and by local `--event-path` runs that have no run
URL. Injected like every other boundary in this workspace.

### 4.4 Run links everywhere else

`GITHUB_RUN_ID` / `GITHUB_RUN_ATTEMPT` / `GITHUB_SERVER_URL` /
`GITHUB_REPOSITORY` are present in every step's environment (GitHub sets them;
`scrubSecrets` matches by _value_, so they survive it), which means the run URL
needs **no workflow change** — only a nullable `runUrl` on `PipelineConfig`,
absent for local runs. Once it exists:

- the failure comment says which run failed, so `/retry` is not the only lead;
- the CI-fix comment distinguishes "the red run I am fixing" from "the run
  fixing it", which today are the same word;
- the pull request body links the run that produced it.

---

## 5. Breaking the remaining silences

Every skip path, with the decision. This table is the deliverable for **G4** —
the point is that no row is left as "log only" by omission.

| Path                                       | Today   | Proposed                                             |
| ------------------------------------------ | ------- | ---------------------------------------------------- |
| `NOT_MAINTAINER`                           | log     | 😕 reaction                                          |
| `PULL_REQUEST` / `BOT_SENDER` / `SELF_*`   | log     | log — machine noise, nobody is waiting               |
| `UNSUPPORTED_EVENT` / `UNSUPPORTED_ACTION` | log     | log                                                  |
| `CI_*` denials                             | log     | log — no human triggered them                        |
| Unknown command (`/aprove`)                | log     | 😕 reaction                                          |
| Command invalid in phase                   | log     | 😕 reaction; the status comment lists valid commands |
| Plain comment, non-waiting phase           | log     | 👍 reaction                                          |
| `Comment needs no action` / empty          | log     | 👍 reaction                                          |
| Retry / token / CI budget exhausted        | comment | unchanged — these are already right                  |

Reaction rather than comment for the rejections, deliberately. A wrong-phase
`/approve` is usually followed by a second attempt; a comment per attempt turns
one confused maintainer into a thread of bot replies. The reaction says "seen and
declined" and the status comment — which states the valid commands for the
current phase — says why.

And **G8**: `renderSettled`'s non-terminal branch gains the same "What now?"
block every other waiting comment carries, read from the presentation table.

---

## 6. Workflow changes

Small, and only two of them matter.

- **Fix the infrastructure fallback (G9).** Resolve the issue number from
  `github.event.issue.number` **or** the `workflow_run.head_branch`'s
  `agent/issue-<n>` suffix, and fire on `failure() || cancelled()`. A cancelled
  job is the documented consequence of a run that looks hung, and it currently
  leaves the issue mid-phase with no explanation at all.
- **Add an `if: always()` label cleanup step** removing `agent:working`, so a
  killed runner cannot strand the marker (belt to the in-run reconcile's braces).
- Optionally surface `AGENT_LABEL_PREFIX` alongside the other `vars.AGENT_*`
  knobs.

No permission change: `issues: write` already covers labels, reactions and
comment edits.

---

## 7. Sequencing

Each stage is independently shippable and independently useful. Stage 1 alone
closes the two worst gaps.

| Stage | Contents                                                                                                                                                  | Closes                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **1** | `runUrl` in config; `commentId` on `IssueTriggerEvent`; `addReaction`; acknowledgement + rejection reactions; run link in the failure and CI-fix comments | G1, G2, G4              |
| **2** | `presentation.ts`; label reconciler; `AGENT_LABEL_PREFIX`; `renderSettled` gains next steps                                                               | G3, G6, G8              |
| **3** | `StatusReporter`; `updateComment`; the live status comment; heartbeat `onTick`; budget line                                                               | G5, G7, and G2 properly |
| **4** | Workflow fallback and cleanup fixes                                                                                                                       | G9                      |
| **5** | README "Watching a run" rewritten around the issue rather than the log; a `CLAUDE.md` local rule for the feedback-is-best-effort invariant                | —                       |

---

## 8. Test plan

Following `tests/CLAUDE.md` and this workspace's own habits.

- **Presentation is total.** `Record<Phase, …>` makes a missing phase a compile
  error; a test asserts every `PHASES` entry resolves and that no two phases
  share a label.
- **Label reconcile is a diff.** Unchanged state issues zero calls; a phase move
  issues exactly one add and one remove; an issue carrying a hand-added
  `agent:*` label is repaired.
- **The state channel is untouched.** `findLatestState` over a thread with status
  comments interleaved equals the same call without them — the invariant from
  rule 4, and the one that would be expensive to discover later.
- **Feedback failures are not run failures.** A `GitHubApi` fake that throws on
  every label, reaction and edit call still drives a full pipeline to the same
  `RunResult` and the same **persisted state**. This is the rule-1 test and it is
  the most important one here.
- **Transport-level assertions for the new methods**, through the existing
  `fetch` seam. This workspace's recorded lesson (S2-6, S3-3, S3-8, S3-9) is that
  a correct adapter which is never wired in passes every phase test; `contain`
  and `assembleDeps` must be exercised, not just the modules.
- **Redaction covers `updateComment`.** A status body carrying a credential goes
  out clean — the same assertion `createComment` already carries, extended to the
  new path rather than trusted to it.
- **Rate limiting.** An injected clock proves a second `tick` inside the window
  issues no request, and that an unchanged body issues none regardless.
- Mutation-check hints for the reviewer: empty the reaction map; make the
  reconcile clear-and-reapply; drop the unchanged-body guard; let a thrown label
  error propagate. Each should kill the test that names it.

---

## 9. Risks and non-goals

- **Noise is the failure mode.** Rule 6's one-comment budget is the mitigation,
  and it is worth re-checking against a real long conversation before stage 3
  ships.
- **Label churn in a repository with its own conventions.** Namespaced and
  disableable; the prefix knob is not optional polish.
- **API budget.** A run costs roughly 10–40 extra calls against 5,000/hour. The
  status edits are the only sustained writer and are capped at 1/minute.
- **A public issue is a public surface.** Everything new goes through the
  outbound redaction in `github.ts`, and the status comment carries only the
  scalar `ProgressSnapshot` fields — no tool input, no model text.
- **Explicitly not in scope:** editing the issue title or body (the maintainer's
  text, not the agent's), GitHub Checks or Deployments as a status surface (a
  much larger integration for the same information), project-board automation,
  and any notification channel outside the issue.
