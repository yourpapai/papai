// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { promptForJson } from '../ask-json.js'
import { branchNameFor } from '../git.js'
import { MAINTAINER_ASSOCIATIONS } from '../guardrails.js'
import { composeSystemPrompt } from '../obra-skills.js'
import type { AgentPromptRequest } from '../opencode-adapter.js'
import type { PhaseHandler, PhaseInput, PhaseOutcome } from '../phase-context.js'
import { buildTriagePrompt, TRIAGE_INSTRUCTIONS } from '../prompts.js'
import type { UntrustedEnvelope } from '../prompts.js'
import type { TriggerEvent } from '../trigger-events.js'
import { mintEnvelope } from './envelope.js'

/**
 * A kebab-case OpenSpec change name: lowercase alphanumeric segments joined by
 * single hyphens. The CLI has its own view, but validating here means the
 * `promptForJson` re-ask fires on a name the model misspelled ("Add Retry
 * Helper") rather than a scaffold that fails inside the driver.
 */
const changeNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/u, 'changeName must be kebab-case (lowercase letters, digits, hyphens)')

const triageSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('clarify'), questions: z.array(z.string().min(1)).min(1) }),
  // Bridge (slice A): `capture` still carries `spec` text so PLANNING — not yet
  // reworked onto the folder — can read the design spec from the SPEC block.
  // Slice B drops `spec`, drafts the proposal into the folder, and retires the
  // SPEC block entirely.
  z.object({ status: z.literal('capture'), changeName: changeNameSchema, spec: z.string().min(1) }),
  z.object({ status: z.literal('answer'), reply: z.string().min(1) }),
])

/**
 * Phase 1. Reads the issue plus every maintainer reply so far and decides one
 * of three things — ask for clarification, capture the issue as an OpenSpec
 * change, or answer it as a question (design D9).
 *
 * `capture` scaffolds a real `openspec/changes/<name>/` folder via the driver,
 * sets `state.changeName`, and parks at `DESIGN_SPEC` — but only when the
 * trigger's author association is a maintainer (OWNER/MEMBER/COLLABORATOR). An
 * untrusted author gets a consent comment naming the change and parks here; the
 * capture completes when a maintainer replies affirmatively, which
 * `applyClarifyIntent` routes back into triage (the re-run sees the
 * maintainer's trusted association and captures).
 *
 * `answer` is the inline form of the answer path: the model has already read
 * the issue, so it replies directly and the machine stays put (`ANSWERED` is
 * phase-neutral). It is how triage says "this is a question, not work".
 */
export const handleTriage: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, issue, state } = input
  const feedback = changeRequest(input)
  deps.log.info({ issue: state.issueId, revising: feedback !== null }, 'Triaging issue')

  const envelope = mintEnvelope()
  const decision = await promptForJson({
    agent: await deps.agent(),
    schema: triageSchema,
    envelope,
    log: deps.log,
    request: await triageRequest(input, envelope, feedback, issue),
  })

  if (decision.status === 'clarify') {
    return { signal: 'NEEDS_CLARIFICATION', comment: renderQuestions(decision.questions) }
  }
  if (decision.status === 'answer') {
    return { signal: 'ANSWERED', comment: renderAnswer(decision.reply) }
  }
  return captureOutcome(input, decision)
}

/**
 * Builds the prompt request for the triage turn. Extracted so the handler reads
 * as decide-then-act: one prompt, three outcomes, each its own return.
 */
const triageRequest = async (
  input: PhaseInput,
  envelope: UntrustedEnvelope,
  feedback: string | null,
  issue: { number: number; title: string; body: string },
): Promise<AgentPromptRequest> => {
  const { deps, thread } = input
  return {
    system: composeSystemPrompt({
      phase: 'INIT_OR_CLARIFY',
      skills: await deps.skills('INIT_OR_CLARIFY'),
      repoRoot: deps.config.repoRoot,
      nonce: envelope.nonce,
      instructions: TRIAGE_INSTRUCTIONS,
    }),
    prompt: buildTriagePrompt(
      { envelope, issueNumber: issue.number, title: issue.title, body: issue.body, thread },
      feedback,
    ),
    agent: 'plan',
  }
}

/**
 * The `capture` branch and its D9 gate: auto-capture only for authors the
 * guardrails already trust with maintainer rights, and a consent comment for
 * everybody else. The association is the *current trigger's* — so an untrusted
 * issue author parks behind consent, and the maintainer whose affirmative reply
 * re-runs triage passes the gate on the re-run and captures.
 *
 * On auto-capture the design spec the model produced is written to the folder's
 * `proposal.md` — the folder is truth (D1), so no `AGENT_SPEC` block rides on
 * the issue. The scaffold commit (D2) carries it.
 */
const captureOutcome = async (
  input: PhaseInput,
  decision: { changeName: string; spec: string },
): Promise<PhaseOutcome> => {
  const { deps, state, trigger } = input
  const association = authorAssociation(trigger)
  if (!MAINTAINER_ASSOCIATIONS.has(association)) {
    deps.log.info({ issue: state.issueId, association, changeName: decision.changeName }, 'Capture awaiting consent')
    return { signal: 'NEEDS_CLARIFICATION', comment: renderConsent(decision.changeName) }
  }

  await deps.openspec.newChange(decision.changeName, OPENSPEC_SCHEMA)
  const proposalPath = (await deps.openspec.instructions('proposal', decision.changeName)).resolvedOutputPath
  await deps.writeFile(proposalPath, `${decision.spec.trim()}\n`)
  await scaffoldOnBranch(input, decision.changeName)
  return {
    signal: 'CAPTURED',
    comment: renderCapture(decision.changeName, decision.spec),
    patch: { changeName: decision.changeName },
  }
}

/**
 * Design D2 — the scaffold is durable the moment capture converges.
 *
 * Creates `agent/issue-<n>` off the configured base, commits the scaffolded
 * folder as commit #1, and pushes, so planning artefacts survive the Actions
 * runner without travelling in hidden blocks. `openspec new change` has already
 * written the folder into the working tree; the untracked files carry across
 * the branch switch and land in this commit.
 */
const scaffoldOnBranch = async (input: PhaseInput, changeName: string): Promise<void> => {
  const { deps, state } = input
  const branch = branchNameFor(state.issueId)
  await deps.git.ensureBranch(branch, await deps.baseBranch())
  await deps.git.commitAll(`chore(openspec): scaffold ${changeName}`)
  await deps.git.push(branch)
}

/** The OpenSpec schema every agent change is scaffolded under. */
const OPENSPEC_SCHEMA = 'spec-driven'

/**
 * The author association the D9 gate reads, regardless of which trigger kind
 * reached triage.
 *
 * Both human kinds carry it (an issue event and a resolved pull-request comment
 * event). A CI event does not, but a CI event never reaches `INIT_OR_CLARIFY` —
 * `CI_FAILED` moves straight to `CI_FIX` — so the `NONE` fallback names a
 * shape that cannot capture and never misleads.
 */
const authorAssociation = (trigger: TriggerEvent): string => {
  if (trigger.kind === 'issue' || trigger.kind === 'pull-request') return trigger.authorAssociation
  return 'NONE'
}

/** The maintainer's `/changes` argument, when this run was triggered by one. */
const changeRequest = (input: PhaseInput): string | null => {
  const { command } = input
  if (command === null || command.command !== '/changes') return null
  return command.argument.length > 0 ? command.argument : null
}

const renderQuestions = (questions: readonly string[]): string =>
  [
    '### Clarification needed',
    '',
    'I need a bit more before I can capture this as a change:',
    '',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
    '',
    'Reply in this thread with the answers and I will pick it up from there.',
  ].join('\n')

const renderAnswer = (reply: string): string =>
  [
    '### Answer',
    '',
    reply.trim(),
    '',
    '_This looks like a question rather than work — reply with the details if you want me to capture it as a change._',
  ].join('\n')

const renderConsent = (changeName: string): string =>
  [
    '### Ready to capture',
    '',
    `I would scaffold this as \`openspec/changes/${changeName}/\` and plan the work — but I want a maintainer to confirm first.`,
    '',
    'Reply to confirm (or describe what should change), and I will pick it up from there.',
  ].join('\n')

const renderCapture = (changeName: string, spec: string): string =>
  [
    `### Captured: ${changeName}`,
    '',
    `Captured into \`openspec/changes/${changeName}/\`. The proposal drafted from the issue:`,
    '',
    spec.trim(),
    '',
    '**What now?** `/approve` to plan the work, `/changes <what to change>` to revise the proposal,',
    '`/ask <question>` to ask about it, or `/cancel` to stop. A plain reply works too — I will',
    'read it as a question unless it clearly asks for changes.',
  ].join('\n')
