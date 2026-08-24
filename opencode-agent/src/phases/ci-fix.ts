// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { promptForJson } from '../ask-json.js'
import type { CheckSpec } from '../check-loop.js'
import { runCheckLoop } from '../check-loop.js'
import { diagnosisSchema } from '../ci-diagnosis.js'
import { buildDiagnosisPrompt } from '../ci-diagnosis.js'
import type { Diagnosis } from '../ci-diagnosis.js'
import { branchNameFor } from '../git.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildCiFixPrompt, MINIMALITY_RULE } from '../prompts.js'
import { PROTECTED_PATHS_RULE } from '../protected-paths.js'
import { selectFailedJobs, failedJobsFromCheckRuns } from '../red-run.js'
import type { FailedJob } from '../red-run.js'
import { commitAndPush } from './ci-commit.js'
import type { CiTurn } from './ci-commit.js'
import { renderCiReport } from './ci-report.js'
import type { RoundCommit, RoundProof } from './ci-report.js'
import { mintEnvelope } from './envelope.js'

/**
 * Exported for `instructions.test.ts`, which asserts every phase that can write
 * a file offers the protected-paths rule. This phase is the one that had no
 * copy of it, and is the likeliest to need it: a red job's root cause is often
 * the workflow that ran it.
 */
export const CI_FIX_INSTRUCTIONS = [
  'Continuous integration is red on a pull request you opened. Diagnose and fix the root cause.',
  'Diagnose from the failed jobs and logs of the red run itself, never from a memorized check list.',
  'Reproduce the failure from the repository’s own CI configuration before changing anything; if you cannot, say so.',
  'Never weaken, skip, or delete a test to make a check pass, and never add lint-disable or type-ignore comments.',
  'If the failure is unrelated to this branch, or outside this pipeline’s reach, say so rather than papering over it.',
  MINIMALITY_RULE,
  PROTECTED_PATHS_RULE,
].join('\n')

/**
 * Entered when a check run goes red on the agent's own pull request — through
 * the red-run door, or through `/fix` typed by a maintainer.
 *
 * The round reads what its door named: the red run's failed jobs and logs
 * through the Actions API, distilled by `red-run.ts`, or — for a
 * command-bought round — the check runs of the pull request's head, mapped by
 * the same module into the same `FailedJob` shape. One diagnosis turn
 * returns a verdict that picks the branch — a reproduced failure enters the
 * bounded loop against the derived command; a log-justified fix is made with
 * its weaker proof named; a needs-human verdict reports job, reason and remedy
 * without repairing. The incident that bought this (runs 32641725211 /
 * 32652877782, PR #337) spent a pull request's whole CI budget "repairing" a
 * mutation-ratchet failure a static check list could not even see.
 */
export const handleCiFix: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state } = input
  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, await deps.baseBranch())

  const turn = await openTurn(input)

  const discovered = await discoverFailures(input)
  if (discovered.readError !== null || discovered.jobs.length === 0) return undiagnosedRound(input, discovered)

  const jobs = discovered.jobs
  const diagnosis = await diagnose(input, turn, jobs)
  // Content goes to the encrypted transcript, never the public Actions log:
  // the verdict and the CI logs are the round's substance, and the log channel
  // keeps names and counts only.
  foldToTranscript(input, jobs, diagnosis)

  const repair = await repairUnder(diagnosis, input, jobs, turn)
  // A needs-human round writes nothing on purpose: its remedy is outside this
  // pipeline's reach, so there is no tree worth committing and no push to make.
  const commit: RoundCommit =
    diagnosis.verdict === 'needs-human' ? { pushed: false, dropped: [] } : await commitAndPush(input, branch, turn)

  deps.log.info(
    {
      issue: state.issueId,
      branch,
      verdict: diagnosis.verdict,
      passed: repair.loop?.passed ?? null,
      logBased: repair.logBased,
      pushed: commit.pushed,
      dropped: commit.dropped,
    },
    'CI fix round finished',
  )

  return {
    signal: 'CI_FIXED',
    comment: renderCiReport(
      input,
      { ...repair, diagnosis, failures: jobs, readError: null },
      commit,
      deps.config.runUrl,
    ),
    // Rewritten every round, never accumulated: this says what *this* round
    // could not push, so a round that pushed clears a path a maintainer has
    // since applied by hand.
    patch: { ciBlockedPaths: diagnosis.verdict === 'needs-human' ? state.ciBlockedPaths : [...commit.dropped] },
  }
}

/** The round's substance, into the encrypted transcript a maintainer is told to read. */
const foldToTranscript = (input: PhaseInput, jobs: readonly FailedJob[], diagnosis: Diagnosis): void => {
  const sink = input.deps.transcript
  if (sink === undefined) return
  const at = (): string => new Date(input.deps.now()).toISOString()
  sink.write({ time: at(), tool: 'ci-fix', status: 'diagnosis', detail: JSON.stringify(diagnosis), durationMs: null })
  for (const job of jobs)
    sink.write({ time: at(), tool: 'ci-fix', status: `ci-log:${job.name}`, detail: job.log, durationMs: null })
}

/** The session and the two things every prompt in this phase is composed against. */
type Turn = CiTurn

/** Boots the session and the system prompt every turn in this phase shares. */
const openTurn = async (input: PhaseInput): Promise<Turn> => {
  const { deps } = input
  const envelope = mintEnvelope()
  const agent = await deps.agent()
  const system = composeSystemPrompt({
    phase: 'CI_FIX',
    skills: await deps.skills('CI_FIX'),
    repoRoot: deps.config.repoRoot,
    nonce: envelope.nonce,
    instructions: CI_FIX_INSTRUCTIONS,
  })
  return { agent, envelope, system }
}

/** The round that never reached a diagnosis: nothing repaired, nothing pushed, everything said. */
const undiagnosedRound = (input: PhaseInput, discovered: Discovered): PhaseOutcome => {
  const { deps } = input
  deps.log.warn(
    { issue: input.state.issueId, readError: discovered.readError, failedJobs: discovered.jobs.length },
    'CI fix round could not diagnose the red run',
  )
  const proof: RoundProof = {
    diagnosis: null,
    failures: discovered.jobs,
    loop: null,
    logBased: false,
    readError: discovered.readError,
  }
  // No model turn, no commit: there is nothing to repair and nothing to
  // push, and the state's blocked paths are facts about rounds that did.
  return {
    signal: 'CI_FIXED',
    comment: renderCiReport(input, proof, { pushed: false, dropped: [] }, deps.config.runUrl),
  }
}

/** The one diagnosis turn, through the re-asking JSON seam. */
const diagnose = (input: PhaseInput, turn: Turn, jobs: readonly FailedJob[]): Promise<Diagnosis> => {
  const { deps, state } = input
  return promptForJson({
    agent: turn.agent,
    schema: diagnosisSchema,
    envelope: turn.envelope,
    log: deps.log,
    request: {
      system: turn.system,
      prompt: buildDiagnosisPrompt(turn.envelope, jobs, redRunUrl(input), state.ciBlockedPaths),
      agent: 'build',
    },
  })
}

/** What the red run could say about itself, or why it could say nothing. */
interface Discovered {
  jobs: readonly FailedJob[]
  readError: string | null
}

/**
 * What is red, and how the round learned it.
 *
 * Keyed to the door the round came through. The red run names itself, so the
 * run's jobs and logs are the facts. A command-bought round (`/fix`) arrived
 * with no run id at all — the command means "the pull request's checks are
 * red", so the round reads the check runs of the head's branch, the branch the
 * handler already resolved at its top, and no second lookup exists to make.
 *
 * A refused read (a token without `actions: read` or `checks: read`, a GHES
 * host without either endpoint) degrades to a needs-human round naming the
 * error rather than a crash: the fallback comment covers crashes, but here a
 * degraded sentence on the pull request is the more useful answer.
 */
const discoverFailures = async (input: PhaseInput): Promise<Discovered> => {
  const { deps, state, trigger } = input

  try {
    if (trigger.kind === 'ci') {
      const jobs = await deps.github.listRunJobs(trigger.runId)
      return { jobs: await selectFailedJobs(jobs, (id) => deps.github.jobLog(id)), readError: null }
    }
    const runs = await deps.github.listCheckRunsForRef(branchNameFor(state.issueId))
    return { jobs: failedJobsFromCheckRuns(runs), readError: null }
  } catch (error) {
    return { jobs: [], readError: error instanceof Error ? error.message : String(error) }
  }
}

/** The red run that brought the pipeline here; absent unless CI triggered it. */
const redRunUrl = (input: PhaseInput): string | null => (input.trigger.kind === 'ci' ? input.trigger.runUrl : null)

/** The logs of the run being repaired, as one paragraph the repair prompt carries. */
const ciLogOf = (jobs: readonly FailedJob[]): string => jobs.map((job) => `${job.name}\n${job.log}`).join('\n\n')

/**
 * Repairs under the verdict's branch, and reports which proof the round holds.
 *
 * `fix` + `reproduction` — the derived command runs once, locally. Failing
 * enters the existing bounded loop scoped to that one command, every repair
 * prompt carrying the local failure **and** the CI log it reproduced. Passing
 * while CI was red is *not* success — the incident's rounds were green exactly
 * this way, against checks they never ran — so the round falls through to the
 * log-based path rather than claiming an observed pass.
 *
 * `fix` without `reproduction` — one repair turn from the log. The model holds
 * `bash` and may verify what it can, but nothing in the round observed the
 * derived command pass, and the report says so.
 */
const repairUnder = async (
  diagnosis: Diagnosis,
  input: PhaseInput,
  jobs: readonly FailedJob[],
  turn: Turn,
): Promise<Omit<RoundProof, 'diagnosis' | 'failures' | 'readError'>> => {
  const { deps, state } = input
  if (diagnosis.verdict === 'needs-human') return { loop: null, logBased: false }

  const ciLog = ciLogOf(jobs)

  if (diagnosis.reproduction !== undefined) {
    const check: CheckSpec = { name: jobs[0]?.name ?? 'ci', argv: diagnosis.reproduction.argv }
    const first = await deps.runCheck(check)
    if (first.exitCode !== 0) {
      const loop = await runCheckLoop({
        checks: [check],
        run: deps.runCheck,
        maxRounds: deps.config.ciFixMaxRounds,
        repair: async (failures, round) => {
          deps.log.warn(
            { issue: state.issueId, round, checks: failures.map((failure) => failure.name) },
            'Repairing red checks',
          )
          await turn.agent.prompt({
            system: turn.system,
            prompt: buildCiFixPrompt(turn.envelope, failures, round, state.ciBlockedPaths, undefined, {
              command: check.argv,
              ciLog,
            }),
            agent: 'build',
          })
        },
      })
      return { loop, logBased: false }
    }
    deps.log.info({ issue: state.issueId }, 'Derived command passed locally while CI was red; repairing from the log')
  }

  await repairFromLog(turn, jobs, state.ciBlockedPaths)
  return { loop: null, logBased: true }
}

/** One repair turn working from the CI log, enveloped as the failures it stands for. */
const repairFromLog = async (turn: Turn, jobs: readonly FailedJob[], blocked: readonly string[]): Promise<void> => {
  await turn.agent.prompt({
    system: turn.system,
    prompt: buildCiFixPrompt(
      turn.envelope,
      jobs.map((job) => ({ name: job.name, exitCode: 1, output: job.log })),
      1,
      blocked,
    ),
    agent: 'build',
  })
}
