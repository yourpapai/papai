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
import { renderAnswer, renderCapture, renderConsent, renderQuestions } from './triage-comments.js'

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
  return captureOutcome(input, decision, feedback)
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
 * the issue. The scaffold commit (D2) carries it. When the name is one the base
 * branch already carries the folder is **adopted** instead of created, and then
 * the folder's own proposal outranks the one this turn composed — see
 * {@link adoptOrCreate} and {@link settleProposal}.
 */
const captureOutcome = async (
  input: PhaseInput,
  decision: { changeName: string; spec: string },
  feedback: string | null,
): Promise<PhaseOutcome> => {
  const { deps, state, trigger } = input
  const association = authorAssociation(trigger)
  if (!MAINTAINER_ASSOCIATIONS.has(association)) {
    deps.log.info({ issue: state.issueId, association, changeName: decision.changeName }, 'Capture awaiting consent')
    return { signal: 'NEEDS_CLARIFICATION', comment: renderConsent(decision.changeName) }
  }

  const adopted = await adoptOrCreate(input, decision.changeName)
  const proposalPath = await settleProposal(input, decision, adopted, feedback)
  await scaffoldOnBranch(input, decision.changeName, adopted)
  // The park digest is a render of the folder, not a memory of the model reply:
  // the proposal is read straight back from where it landed (design D1). The
  // branch carries the real history; the comment is a snapshot of it.
  const proposal = await deps.readFile(proposalPath)
  const pending = adopted ? await pendingArtifacts(input, decision.changeName) : null
  return {
    signal: 'CAPTURED',
    comment: renderCapture({
      changeName: decision.changeName,
      proposal,
      branch: branchNameFor(state.issueId),
      pending,
    }),
    patch: { changeName: decision.changeName },
  }
}

/**
 * Creates the change, or reports that it was already there — `true` when this
 * capture **adopted** an existing `openspec/changes/<name>/` rather than
 * scaffolding one.
 *
 * A job starts on the base branch, so the only folder a capture can collide with
 * is one the base branch already carries: a change somebody proposed and never
 * implemented. Naming one is a legitimate answer to "implement the most valuable
 * unbuilt thing" — issue #281 asked exactly that, triage answered
 * `prompt-injection-defense`, and `openspec new change` exited 1 with "already
 * exists", which the driver threw and the run reported as a failed phase. The
 * folder is truth (D1): an existing one is work to pick up, not a name clash to
 * die on. What it is missing, PLANNING drafts through the ordinary artifact
 * loop, which is the same loop that would have drafted them for a new change.
 */
const adoptOrCreate = async (input: PhaseInput, changeName: string): Promise<boolean> => {
  const { deps, state } = input
  const existing = await deps.openspec.listChangeNames()
  if (existing.includes(changeName)) {
    deps.log.info({ issue: state.issueId, changeName }, 'Adopting an existing change')
    return true
  }
  await deps.openspec.newChange(changeName, OPENSPEC_SCHEMA)
  return false
}

/**
 * Settles what `proposal.md` holds after this capture, and answers with its path.
 *
 * An adopted change's proposal is the one thing capture must not overwrite by
 * default: it is the artifact a human wrote when they proposed the change, every
 * other artifact in the folder was drafted against it, and the model's fresh
 * spec is a reading of one issue rather than of the change. Two cases still
 * write. A folder scaffolded but never drafted has no proposal to keep — that is
 * `openspec new change` interrupted, and the missing artifact is exactly what
 * this turn just composed. And a maintainer's `/changes <what to change>` is a
 * request to rewrite it, so honouring it is the whole point of the re-run.
 */
const settleProposal = async (
  input: PhaseInput,
  decision: { changeName: string; spec: string },
  adopted: boolean,
  feedback: string | null,
): Promise<string> => {
  const { deps } = input
  const instruction = await deps.openspec.instructions('proposal', decision.changeName)
  const keep = adopted && instruction.existingOutputPaths.length > 0 && feedback === null
  if (!keep) await deps.writeFile(instruction.resolvedOutputPath, `${decision.spec.trim()}\n`)
  return instruction.resolvedOutputPath
}

/**
 * The artifacts an adopted change still owes, in the schema's own order.
 *
 * Read for the park comment alone: PLANNING re-reads status when it drafts, so
 * nothing downstream depends on this list — it is what tells a maintainer
 * whether `/approve` will draft three artifacts or none before it plans.
 */
const pendingArtifacts = async (input: PhaseInput, changeName: string): Promise<readonly string[]> => {
  const status = await input.deps.openspec.status(changeName)
  return Object.entries(status.artifacts)
    .filter(([, artifactStatus]) => artifactStatus !== 'done')
    .map(([artifactId]) => artifactId)
}

/**
 * Design D2 — the scaffold is durable the moment capture converges, and D12 —
 * a restart starts from zero.
 *
 * Creates `agent/issue-<n>` off the configured base, force-resetting any prior
 * branch to base first (a restarted issue's branch may carry partial legacy
 * work that must not be adopted), commits the scaffolded folder as commit #1,
 * and pushes, so planning artefacts survive the Actions runner without
 * travelling in hidden blocks. `openspec new change` has already written the
 * folder into the working tree; the untracked files carry across the branch
 * switch and land in this commit.
 */
const scaffoldOnBranch = async (input: PhaseInput, changeName: string, adopted: boolean): Promise<void> => {
  const { deps, state } = input
  const branch = branchNameFor(state.issueId)
  await deps.git.resetBranchToBase(branch, await deps.baseBranch())
  // An adopted folder is already in the base branch's tree, so this commit is
  // usually empty (`commitAll` answers `clean` and makes none) — it lands only
  // when the adoption wrote a proposal the folder was missing. The verb says
  // which of the two happened, because the branch history is where a maintainer
  // asks that question.
  await deps.git.commitAll(`chore(openspec): ${adopted ? 'adopt' : 'scaffold'} ${changeName}`)
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
