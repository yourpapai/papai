/**
 * plan-adr-workflow.ts
 *
 * Walks through docs/superpowers/plans/, checks each plan's implementation
 * status via opencode, writes ADR documents for completed, superseded, or
 * low-value remaining-work plans using the architecture-decision-records skill,
 * and archives both the plan and its spec file.
 *
 * Prerequisites:
 *   - opencode installed and in PATH
 *   - architecture-decision-records skill in .agents/skills/
 *
 * Usage:
 *   bun scripts/plan-adr-workflow.ts
 *   bun scripts/plan-adr-workflow.ts --dry-run
 *   bun scripts/plan-adr-workflow.ts --filter deferred
 *   bun scripts/plan-adr-workflow.ts --port 4097
 *   bun scripts/plan-adr-workflow.ts --model anthropic/claude-opus-4-5
 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { createOpencode } from '@opencode-ai/sdk/v2'

import {
  type OpencodeClient,
  assessRemainingWorkValue,
  checkImplementationStatus,
  createSession,
  deleteSession,
  generateRemainingWork,
  runAdrCommand,
} from './plan-adr-workflow-ai.js'
import {
  PLANS_DIR,
  SPECS_DIR,
  PROJECT_ROOT,
  type ImplementationCheck,
  type RemainingWorkAssessment,
  type WorkflowResult,
  archiveFile,
  discoverPlanFiles,
  extractSpecReference,
  parseArgs,
  resolveSpecFile,
  writeRemainingWorkDoc,
} from './plan-adr-workflow-helpers.js'

// ─── Per-Plan Processing ──────────────────────────────────────────────────────

export function shouldRunAdrWorkflow(check: ImplementationCheck, assessment?: RemainingWorkAssessment): boolean {
  return check.is_fully_implemented || check.status === 'superseded' || assessment?.should_write_adr === true
}

function printCheckSummary(check: ImplementationCheck): void {
  console.log(`  status:   ${check.status}`)
  const evidencePreview = check.evidence.length > 120 ? `${check.evidence.slice(0, 120)}...` : check.evidence
  console.log(`  evidence: ${evidencePreview}`)
}

async function maybeCreateRemainingWorkDoc(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
  check: ImplementationCheck,
  dryRun: boolean,
): Promise<WorkflowResult | null> {
  if (shouldRunAdrWorkflow(check)) {
    return null
  }

  const work = await generateRemainingWork(client, sessionID, planFile)
  const assessment = await assessRemainingWorkValue(client, sessionID, planFile, check, work)
  console.log(`  value:    ${assessment.rationale}`)

  if (shouldRunAdrWorkflow(check, assessment)) {
    return null
  }

  const remainingDocFile = await writeRemainingWorkDoc(planFile, check.status, work, dryRun)
  return { kind: 'skipped', planFile, status: check.status, reason: check.evidence, remainingDocFile }
}

async function runAdrAndArchiveFiles(
  client: OpencodeClient,
  sessionID: string,
  planFile: string,
  check: ImplementationCheck,
  specRefFromContent: string | null,
  dryRun: boolean,
): Promise<WorkflowResult> {
  if (dryRun) {
    console.log('  [dry-run] would run architecture-decision-records skill')
  } else {
    await runAdrCommand(client, sessionID, planFile)
    console.log('  ADR skill completed')
  }

  const specPath = await resolveSpecFile(check.spec_path, specRefFromContent, SPECS_DIR, PROJECT_ROOT)

  await archiveFile(join(PLANS_DIR, planFile), dryRun)

  if (specPath !== null) {
    await archiveFile(specPath, dryRun)
  }

  return { kind: 'adr_written', planFile, specFile: specPath === null ? null : basename(specPath) }
}

async function processPlan(
  client: OpencodeClient,
  planFile: string,
  planContent: string,
  dryRun: boolean,
): Promise<WorkflowResult> {
  const specRefFromContent = extractSpecReference(planContent)
  let sessionID: string | null = null

  try {
    sessionID = await createSession(client, `adr-workflow: ${planFile}`)

    const check = await checkImplementationStatus(client, sessionID, planFile)
    printCheckSummary(check)

    const remainingWorkResult = await maybeCreateRemainingWorkDoc(client, sessionID, planFile, check, dryRun)
    if (remainingWorkResult !== null) {
      return remainingWorkResult
    }

    return await runAdrAndArchiveFiles(client, sessionID, planFile, check, specRefFromContent, dryRun)
  } catch (error) {
    return {
      kind: 'error',
      planFile,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (sessionID !== null) {
      await deleteSession(client, sessionID)
    }
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary(results: readonly WorkflowResult[]): void {
  const written = results.filter((r) => r.kind === 'adr_written')
  const skipped = results.filter((r) => r.kind === 'skipped')
  const errors = results.filter((r) => r.kind === 'error')
  const remainingDocs = skipped.filter((r) => r.kind === 'skipped' && r.remainingDocFile !== null)

  console.log('\n' + '-'.repeat(60))
  console.log(`Plans processed: ${results.length}`)
  console.log(`  ADRs written        : ${written.length}`)
  console.log(`  Skipped             : ${skipped.length}  (not fully implemented)`)
  console.log(`  Remaining-work docs : ${remainingDocs.length}`)
  console.log(`  Errors              : ${errors.length}`)

  if (errors.length > 0) {
    console.log('\nErrors:')
    for (const r of errors) {
      if (r.kind === 'error') console.log(`  ${r.planFile}: ${r.error}`)
    }
  }

  if (written.length > 0) {
    console.log('\nADRs written:')
    for (const r of written) {
      if (r.kind === 'adr_written') {
        const specNote = r.specFile === null ? '' : ` (+ spec: ${r.specFile})`
        console.log(`  ${r.planFile}${specNote}`)
      }
    }
  }

  if (remainingDocs.length > 0) {
    console.log('\nRemaining-work docs:')
    for (const r of remainingDocs) {
      if (r.kind === 'skipped' && r.remainingDocFile !== null) {
        console.log(`  docs/superpowers/remaining/${r.planFile}  [${r.status}]`)
      }
    }
  }
}

// ─── Plan Execution Loop ──────────────────────────────────────────────────────

// Plans must run sequentially: each uses a fresh opencode session and may
// archive files that affect subsequent plan discovery. Using reduce avoids
// awaiting inside a for-loop while preserving order.
function runPlanSequence(
  client: OpencodeClient,
  planFiles: readonly string[],
  dryRun: boolean,
): Promise<readonly WorkflowResult[]> {
  return planFiles.reduce<Promise<WorkflowResult[]>>(async (accPromise, planFile, index) => {
    const acc = await accPromise
    console.log(`\n[${index + 1}/${planFiles.length}] ${planFile}`)
    const planContent = await readFile(join(PLANS_DIR, planFile), 'utf-8')
    const result = await processPlan(client, planFile, planContent, dryRun)
    acc.push(result)

    if (result.kind === 'adr_written') {
      const specNote = result.specFile === null ? '' : ` + spec archived`
      console.log(`  ADR written, plan archived${specNote}`)
    } else if (result.kind === 'skipped') {
      console.log(`  -> skipped (${result.status})`)
    } else {
      console.log(`  error: ${result.error}`)
    }

    return acc
  }, Promise.resolve([]))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.dryRun) {
    console.log('-- DRY RUN -- no files moved, no ADRs written\n')
  }

  const planFiles = await discoverPlanFiles(args.filter, PLANS_DIR)
  if (planFiles.length === 0) {
    console.log('No plan files found matching the filter.')
    return
  }

  console.log(`Found ${planFiles.length} plan(s). Starting opencode server...\n`)

  let opencode: Awaited<ReturnType<typeof createOpencode>> | null = null

  try {
    opencode = await createOpencode({ port: args.port, config: { model: args.model } })
    const { client } = opencode
    await client.global.health()
    const results = await runPlanSequence(client, planFiles, args.dryRun)
    printSummary(results)
  } finally {
    if (opencode !== null) opencode.server.close()
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error('Fatal:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
