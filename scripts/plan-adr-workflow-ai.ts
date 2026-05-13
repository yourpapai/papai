/**
 * plan-adr-workflow-ai.ts
 *
 * OpenCode API interaction helpers for plan-adr-workflow.ts:
 * session management, retry logic, implementation checks,
 * ADR command dispatch, and remaining-work generation.
 */

import { createOpencode } from '@opencode-ai/sdk/v2'

import {
  IMPLEMENTATION_CHECK_SCHEMA,
  REMAINING_WORK_ASSESSMENT_SCHEMA,
  REMAINING_WORK_SCHEMA,
  type ImplementationCheck,
  type RemainingWork,
  type RemainingWorkAssessment,
} from './plan-adr-workflow-helpers.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type OpencodeClient = Awaited<ReturnType<typeof createOpencode>>['client']

// ─── Session Management ───────────────────────────────────────────────────────

export async function createSession(client: OpencodeClient, title: string): Promise<string> {
  const result = await client.session.create({ title })
  const sessionData = result.data
  const sessionID = sessionData === undefined ? undefined : sessionData.id
  if (sessionID === undefined || sessionID === '') throw new Error('session.create returned no id')
  return sessionID
}

export async function deleteSession(client: OpencodeClient, sessionID: string): Promise<void> {
  try {
    await client.session.delete({ sessionID })
  } catch {
    // best-effort session cleanup — non-fatal
  }
}

// ─── Retry Utility ────────────────────────────────────────────────────────────

const MAX_RETRY_ATTEMPTS = 5

async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  maxAttempts: number = MAX_RETRY_ATTEMPTS,
  attempt: number = 1,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (!shouldRetry(error) || attempt >= maxAttempts) throw error
    const delayMs = 1000 * attempt
    console.warn(
      `  [attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms] ${error instanceof Error ? error.message : String(error)}`,
    )
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs)
    })
    return withRetry(fn, shouldRetry, maxAttempts, attempt + 1)
  }
}

const isNoStructuredOutputError = (error: unknown): boolean =>
  error instanceof Error && error.message === 'implementation check returned no structured output'

// ─── Implementation Check ─────────────────────────────────────────────────────

function isImplementationCheck(value: unknown): value is ImplementationCheck {
  if (typeof value !== 'object' || value === null) return false
  return (
    'status' in value &&
    typeof value.status === 'string' &&
    'is_fully_implemented' in value &&
    typeof value.is_fully_implemented === 'boolean' &&
    'evidence' in value &&
    typeof value.evidence === 'string'
  )
}

async function checkImplementationStatusOnce(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
): Promise<ImplementationCheck> {
  const planRelPath = `docs/superpowers/plans/${planFile}`
  const result = await client.session.prompt({
    sessionID,
    parts: [
      {
        type: 'text',
        text: [
          `Read the implementation plan at @${planRelPath} and verify its status in the codebase.`,
          '',
          'Steps:',
          '1. Read the plan to understand the goal, target files, and task checklist',
          '2. Check whether the key source files listed in the plan exist with the expected content',
          '3. If the plan has checkbox tasks (- [x] done / - [ ] todo), note the completion ratio',
          '4. Look for a "Spec:" or "Design:" reference in the plan frontmatter or body',
          '5. If the plan is explicitly marked superseded, return status "superseded" and mention the replacement in evidence',
          '6. Return structured JSON with your findings',
        ].join('\n'),
      },
    ],
    format: {
      type: 'json_schema',
      schema: IMPLEMENTATION_CHECK_SCHEMA,
    },
  })

  const responseData = result.data
  if (responseData === undefined) throw new Error('session.prompt returned no data')
  const responseInfo = responseData.info
  const structured: unknown = responseInfo === undefined ? undefined : responseInfo.structured
  if (!isImplementationCheck(structured)) throw new Error('implementation check returned no structured output')
  return structured
}

export function checkImplementationStatus(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
): Promise<ImplementationCheck> {
  return withRetry(() => checkImplementationStatusOnce(client, sessionID, planFile), isNoStructuredOutputError)
}

// ─── ADR Command ─────────────────────────────────────────────────────────────

export async function runAdrCommand(client: OpencodeClient, sessionID: string, planFile: string): Promise<void> {
  await client.session.prompt({
    sessionID,
    parts: [
      {
        type: 'text',
        text: [
          `Use the architecture-decision-records skill to write an ADR for the decision implemented in @docs/superpowers/plans/${planFile}.`,
          '',
          'Steps:',
          '1. Load the architecture-decision-records skill',
          '2. List existing files in docs/adr/ to determine the next sequential ADR number',
          '3. Write the ADR using the MADR template from the skill with status "Accepted"',
          '4. Save it to docs/adr/<NNNN>-<kebab-case-title>.md',
          '5. The ADR must document the architectural decision: what was chosen, why, and the consequences',
        ].join('\n'),
      },
    ],
  })
}

// ─── Remaining Work ───────────────────────────────────────────────────────────

function isRemainingWork(value: unknown): value is RemainingWork {
  if (typeof value !== 'object' || value === null) return false
  return (
    'completed_items' in value &&
    Array.isArray(value.completed_items) &&
    'remaining_items' in value &&
    Array.isArray(value.remaining_items) &&
    'suggested_next_steps' in value &&
    Array.isArray(value.suggested_next_steps)
  )
}

const isNoRemainingWorkOutputError = (error: unknown): boolean =>
  error instanceof Error && error.message === 'remaining work returned no structured output'

async function generateRemainingWorkOnce(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
): Promise<RemainingWork> {
  const result = await client.session.prompt({
    sessionID,
    parts: [
      {
        type: 'text',
        text: [
          `Based on the implementation plan at docs/superpowers/plans/${planFile} and your earlier analysis of the codebase, produce a structured remaining-work breakdown.`,
          '',
          'For each category below, be concise and specific — reference actual file names and task descriptions from the plan where possible:',
          '- completed_items: tasks or features from the plan that are fully present in the codebase',
          '- remaining_items: tasks or features from the plan that are missing or incomplete',
          '- suggested_next_steps: prioritised, actionable steps to reach full implementation',
        ].join('\n'),
      },
    ],
    format: {
      type: 'json_schema',
      schema: REMAINING_WORK_SCHEMA,
    },
  })

  const responseData = result.data
  if (responseData === undefined) throw new Error('session.prompt returned no data')
  const responseInfo = responseData.info
  const structured: unknown = responseInfo === undefined ? undefined : responseInfo.structured
  if (!isRemainingWork(structured)) throw new Error('remaining work returned no structured output')
  return structured
}

export function generateRemainingWork(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
): Promise<RemainingWork> {
  return withRetry(() => generateRemainingWorkOnce(client, sessionID, planFile), isNoRemainingWorkOutputError)
}

// ─── Remaining Work Value Assessment ─────────────────────────────────────────

function isRemainingWorkAssessment(value: unknown): value is RemainingWorkAssessment {
  if (typeof value !== 'object' || value === null) return false
  return (
    'effort' in value &&
    typeof value.effort === 'string' &&
    'worthiness' in value &&
    typeof value.worthiness === 'string' &&
    'practical_value' in value &&
    typeof value.practical_value === 'string' &&
    'should_write_adr' in value &&
    typeof value.should_write_adr === 'boolean' &&
    'rationale' in value &&
    typeof value.rationale === 'string'
  )
}

const isNoRemainingWorkAssessmentOutputError = (error: unknown): boolean =>
  error instanceof Error && error.message === 'remaining work assessment returned no structured output'

const formatItems = (items: readonly string[]): string =>
  items.length === 0 ? '- None identified' : items.map((item) => `- ${item}`).join('\n')

async function assessRemainingWorkValueOnce(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
  check: ImplementationCheck,
  work: RemainingWork,
): Promise<RemainingWorkAssessment> {
  const result = await client.session.prompt({
    sessionID,
    parts: [
      {
        type: 'text',
        text: [
          `Evaluate whether the remaining work for docs/superpowers/plans/${planFile} is worth implementing before archiving the plan.`,
          '',
          `Implementation status: ${check.status}`,
          `Evidence: ${check.evidence}`,
          '',
          'Completed items:',
          formatItems(work.completed_items),
          '',
          'Remaining items:',
          formatItems(work.remaining_items),
          '',
          'Suggested next steps:',
          formatItems(work.suggested_next_steps),
          '',
          'Assess effort, worthiness, and practical value. Return should_write_adr=true only when the remaining changes are not worth implementing and the workflow should document the current decision with an ADR instead.',
        ].join('\n'),
      },
    ],
    format: {
      type: 'json_schema',
      schema: REMAINING_WORK_ASSESSMENT_SCHEMA,
    },
  })

  const responseData = result.data
  if (responseData === undefined) throw new Error('session.prompt returned no data')
  const responseInfo = responseData.info
  const structured: unknown = responseInfo === undefined ? undefined : responseInfo.structured
  if (!isRemainingWorkAssessment(structured)) {
    throw new Error('remaining work assessment returned no structured output')
  }
  return structured
}

export function assessRemainingWorkValue(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
  check: ImplementationCheck,
  work: RemainingWork,
): Promise<RemainingWorkAssessment> {
  return withRetry(
    () => assessRemainingWorkValueOnce(client, sessionID, planFile, check, work),
    isNoRemainingWorkAssessmentOutputError,
  )
}
