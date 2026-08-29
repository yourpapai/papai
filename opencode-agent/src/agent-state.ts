// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { phaseName } from './phase-names.js'

/**
 * The issue state block: what one issue remembers between jobs, and the schema
 * that reads it back.
 *
 * Split out of `types.ts` when that file passed `max-lines`, along the seam
 * `run-result.ts` had already named in prose — that file describes `types.ts` as
 * "the state machine's vocabulary **and** its persisted shape", which is two
 * subjects. The vocabulary (phases, signals, the invalid-transition error) moves
 * when the machine gains a state; this moves when an issue needs to remember one
 * more thing between runners, and the two have barely overlapping readers.
 *
 * `types.ts` re-exports everything here, so not one existing import changed —
 * the arrangement `phase-names.ts` already uses, and for the same reason:
 * callers keep naming one module for the vocabulary.
 */

/**
 * Bumped when the persisted shape changes in a way old blocks cannot satisfy.
 *
 * v3 is a **deliberate stranding** (design D12): the opencode-agent rework
 * retires `AGENT_SPEC`/`AGENT_PLAN` artefact blocks outright and moves planning
 * onto a real `openspec/changes/<name>/` folder, so an in-flight issue's legacy
 * state describes a pipeline that no longer exists. Rather than carry a dual
 * format, v2 blocks are rejected by the schema, the restore scan finds nothing
 * valid, and the issue restarts at `INIT_OR_CLARIFY` under the compliant
 * pipeline (with its `agent/issue-<n>` branch reset — D12). The migration
 * precedent avoided bumps because stranding was the cost; here stranding is the
 * chosen behaviour, and restart-with-reset is the recovery path.
 */
export const STATE_VERSION = 3

/**
 * The durable state carried between ephemeral CI jobs. Serialized verbatim into
 * a hidden `<!-- AGENT_STATE: ... -->` block on the agent's own issue comment;
 * every field must survive a JSON round trip.
 *
 * Bulky artefacts (spec, plan, report) deliberately live in their own blocks
 * rather than here — this object is rewritten on every comment, and duplicating
 * a multi-kilobyte spec each time would bloat the thread.
 */
export const agentStateSchema = z.object({
  /**
   * Must equal {@link STATE_VERSION} exactly. There is no default and no
   * tolerance for an older `v`: a mismatched block is rejected so the restore
   * scan walks past it (D12), which is the mechanism that strands legacy issues
   * onto a fresh restart under the compliant pipeline rather than reading a
   * state that describes a pipeline this code no longer runs.
   */
  v: z.literal(STATE_VERSION),
  phase: phaseName,
  issueId: z.number().int().positive(),
  // No `branch`: it is exactly `agent/issue-<issueId>`, every phase recomputes
  // it with `branchNameFor`, and persisting a derivable value only adds a field
  // that anyone able to edit the agent's comments could point somewhere else.
  /** Phase to resume from when a FAILED run is retried. */
  resumeFrom: phaseName.nullable().default(null),
  /** Consecutive failures. Cleared by any forward move; preserved across `/retry`. */
  attempts: z.number().int().min(0).default(0),
  /**
   * CI-fix rounds spent on the delivered pull request.
   *
   * Per pull request, not per issue: `handleDeliver` clears it — with
   * `ciBudgetReported` — when it opens a **new** one, and leaves both alone when
   * it refreshes the one already open. Nothing else resets it, so within a
   * single pull request the count only climbs, which is what bounds an agent and
   * CI bouncing off each other.
   */
  ciAttempts: z.number().int().min(0).default(0),
  /**
   * Whether the "I have stopped fixing CI" notice has been posted for the
   * current pull request. CI events arrive on every push and re-run, so without
   * this the notice repeats forever; cleared alongside `ciAttempts` when a new
   * pull request is opened, or the notice could never be said again for it.
   */
  ciBudgetReported: z.boolean().default(false),
  /**
   * Review-loop rounds `/review` has spent on the delivered pull request.
   *
   * Per pull request, not per issue, and reset exactly where `ciAttempts` is —
   * `handleDeliver`'s `existing === null` branch, a genuinely new pull request.
   * It is also the *only* bound on `/review`: the loop's `opencode run`
   * subprocesses are invisible to `AGENT_MAX_TOKENS`, so without this the one
   * command in the pipeline that spawns a fleet of them is bounded by nothing
   * but the job timeout.
   */
  reviewAttempts: z.number().int().min(0).default(0),
  /**
   * Paths the last CI-fix round wrote and could not push, so the next round is
   * told before it re-derives them.
   *
   * A red check has one root cause, and every round diagnoses it afresh from the
   * same output — so when the fix lands on a file `stageAllowed` drops, each
   * round writes the same edit, drops it, and reports having done nothing. Run
   * 31779566286 spent a pull request's whole `ciAttempts` budget that way, on
   * two consecutive rounds whose only edit was `agent-pipeline.yml`.
   *
   * Rewritten by **every** round rather than accumulated, and cleared by one that
   * pushes: it is a fact about the round just run, not a history. A path that
   * stayed blocked is written again by the round that hit it, and a stale entry
   * would warn later rounds off an edit nothing is blocking any more.
   *
   * Deliberately not a reason to *refuse* the next round — the maintainer may
   * have applied the file by hand between the two, and only running the checks
   * can tell. It is `AGENT_MAX_CI_ATTEMPTS` that bounds the bouncing.
   *
   * Needs no `STATE_VERSION` bump — it defaults, exactly as `changedLines` and
   * `stepsDone` do, and a bump strands every issue in flight.
   */
  ciBlockedPaths: z.array(z.string()).default([]),
  /**
   * Lines the implementation commit changed, as the diff guard measured them.
   *
   * The pipeline already held this figure and threw it away: `guardStaged` folds
   * `git diff --cached --numstat` between `git add --all` and the commit, so the
   * one fact that says whether a diff is worth reviewing was computed, used to
   * refuse a runaway commit, and discarded. `/review` being explicit only helps
   * a maintainer who knows when to reach for it, and this is what the delivery
   * comment sizes that recommendation against.
   *
   * The **raw count**, never a `shouldReview` boolean. A flag decided at commit
   * time and frozen into the block could only ever disagree with
   * `reviewHintLines` as the config carries it when the comment is read — the
   * same argument that keeps `approved` out of this schema, where the phase
   * already is the approval gate. It is also the more honest thing to print: a
   * recommendation that states its own figure can be judged rather than trusted.
   *
   * Written by the implementation phase and by nothing else. The review phase's
   * own commits deliberately do not update it: what this sizes is the diff one
   * model turn wrote with nothing having read it, and a `/review` that has since
   * run is the very thing being recommended.
   *
   * Needs no `STATE_VERSION` bump — it defaults, so a block written before it
   * existed still parses, and 0 is below every threshold `LINES_RANGE` allows,
   * which reads as "a small diff" rather than as "one nobody measured".
   */
  changedLines: z.number().int().min(0).default(0),
  /**
   * Steps of the **current plan** already finished, and therefore where the next
   * implementation run starts.
   *
   * The implementation is one model turn per plan step, committed and pushed between
   * them, so a wall-clock stop that lands between two steps costs the run nothing at
   * all — but only if the next job knows which step is next. Without this the
   * `/continue` the stop invites would re-implement the steps already on the branch,
   * paying for them a second time and asking the model to redo work it can see is
   * done.
   *
   * A count rather than an index, so `0` is both the default and the truthful reading
   * of a block written before this field existed: start at the first step. It counts
   * into the plan the state block's `planRevision` names, so `handlePlan` resets it
   * whenever it posts a plan — a cursor carried across a `/changes` would skip work
   * nobody has done, which is the same argument that retires the handoff note on a
   * plan revision. It is reset on a finished implementation too, so a re-entry walks
   * the plan rather than resuming past its end.
   *
   * Written by `REVIEW_AND_MUTATE` and by `PLANNING`, and only ever *forward* within
   * one plan. Note the one thing it deliberately does not survive: a run whose step
   * **threw** posts no outcome patch, so a `/retry` after a crash mid-plan walks the
   * plan from the cursor the last *stop* recorded rather than from the crash. The
   * steps it repeats are already committed, so it costs turns rather than
   * correctness.
   *
   * Needs no `STATE_VERSION` bump — it defaults, exactly as `changedLines`,
   * `tokensSpent` and the two revision counters do, and a bump strands every issue in
   * flight. That does make a rollback **one-way** in the same narrow sense
   * `INCOMPLETE` does: older code drops the key as unknown, so a continuation that
   * was mid-plan starts the plan again rather than resuming it.
   */
  stepsDone: z.number().int().min(0).default(0),
  /**
   * The OpenSpec change folder this issue was captured into — the kebab name
   * triage reported and `openspec new change` scaffolded.
   *
   * `null` until `INIT_OR_CLARIFY` converges on a capture (design D9), then the
   * folder name for the rest of the issue's life. The branch is still derived
   * from `issueId` (`agent/issue-<n>`), never persisted; this names the folder
   * *inside* `openspec/changes/` on that branch, which is the one thing the
   * issue number does not determine. Set on `CAPTURED` and read by every phase
   * that writes or renders the folder's artifacts.
   *
   * Needs no `STATE_VERSION` bump of its own — v3 is brand new under D12, and
   * the field defaults so any v3 block written before it existed still parses.
   */
  changeName: z.string().nullable().default(null),
  /**
   * The plan-identity token: which version of the folder's `tasks.md` the
   * machine is on.
   *
   * Under the OpenSpec rework (design D1) the *content* of the plan no longer
   * lives in an `AGENT_PLAN` block — it lives in `tasks.md` on the branch, which
   * `REVIEW_AND_MUTATE` walks checkbox by checkbox (D5). What state still needs
   * is a machine identity for "a new plan happened", so the wall-clock handoff
   * (`findHandoff`) retires across a re-plan and the implementation report stamps
   * which plan it executed. This counter is that token, bumped by `PLAN_POSTED`
   * alone. It is a machine identity, not an artifact revision: the artifact's
   * real history is the branch's commits, and rendered digests say so.
   *
   * The former companion `specRevision` is gone: the proposal lives in the
   * folder and `DESIGN_SPEC` reviews a digest of it, so nothing counts spec
   * revisions any more. Dropping it needed no `STATE_VERSION` bump — v3 is new,
   * and the field defaulted anyway.
   */
  planRevision: z.number().int().min(0).default(0),
  /**
   * Model tokens this issue has consumed, across every job it has run.
   *
   * Persisted because the runaway this bounds is not one job — it is an issue
   * bouncing through retries and CI-fix rounds, each of which starts a fresh
   * runner with no memory of what the last one spent.
   *
   * Tokens rather than currency. Token counts come from the provider's own
   * usage block and are always right; the cost figure OpenCode reports is
   * derived from its model catalogue and reads **0** for any model it does not
   * price — which, for a pipeline whose whole point is an arbitrary configured
   * model, is the ordinary case. Verified against a real server: a made-up model
   * id reported the correct token counts and a cost of zero. A ceiling that
   * silently never fires is worse than no ceiling, because it looks like one.
   *
   * Needs no `STATE_VERSION` bump: it has a default, so blocks written before it
   * existed still parse — the same reasoning that let `approved` and `updatedAt`
   * be removed.
   */
  tokensSpent: z.number().int().min(0).default(0),
  /**
   * What this issue has cost in US dollars, across every job it has run.
   *
   * Beside `tokensSpent`, never instead of it. The paragraph above records why
   * the *ceiling* counts tokens — a model the catalogue cannot price reports a
   * cost of `0`, and a ceiling that silently never fires is worse than none —
   * and that reasoning is untouched: nothing enforces on this field. It is
   * reported, and reporting may say "unknown" where a guardrail may not.
   *
   * Not `.int()`, unlike the tokens beside it: a turn can genuinely cost less
   * than a cent (the recorded stub turn costs $0.0097), and rounding those to
   * zero would let an issue spend indefinitely while reporting nothing.
   *
   * Needs no `STATE_VERSION` bump — it defaults, exactly as `tokensSpent`,
   * `stepsDone` and `changeName` do, and a bump strands every issue in flight.
   */
  usdSpent: z.number().min(0).default(0),
  /**
   * Whether any turn on this issue could not be priced.
   *
   * Without it `usdSpent` is ambiguous in the one case that matters: an unpriced
   * run contributes nothing to the sum, so `$12.40` could mean "this issue cost
   * $12.40" or "it cost at least $12.40 and we cannot say how much more". The
   * flag makes the total a **floor** and says so, which is the difference
   * between a figure and a guess.
   *
   * Sticky by construction — once true it stays true for the issue's life. An
   * unpriced turn cannot be un-spent by a later priced one.
   */
  usdUnpriced: z.boolean().default(false),
  lastError: z.string().nullable().default(null),
  prUrl: z.url().nullable().default(null),
  prNumber: z.number().int().positive().nullable().default(null),
  // No `approved` and no `updatedAt`. The phase *is* the approval gate, so a
  // separate flag could only ever disagree with it, and the comment carrying
  // this block is already timestamped by GitHub. Both were written and never
  // read. Removing them needs no `STATE_VERSION` bump: zod strips unknown keys,
  // so a block written with them still parses.
})

export type AgentState = z.infer<typeof agentStateSchema>
