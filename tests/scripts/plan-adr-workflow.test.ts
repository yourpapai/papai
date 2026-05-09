import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import {
  IMPLEMENTATION_CHECK_SCHEMA,
  REMAINING_WORK_ASSESSMENT_SCHEMA,
  type ImplementationCheck,
  type RemainingWorkAssessment,
  ARCHIVE_DIR,
  archiveFile,
} from '../../scripts/plan-adr-workflow-helpers.js'
import { shouldRunAdrWorkflow } from '../../scripts/plan-adr-workflow.js'

const makeCheck = (status: ImplementationCheck['status'], isFullyImplemented: boolean): ImplementationCheck => ({
  status,
  is_fully_implemented: isFullyImplemented,
  evidence: 'evidence',
  spec_path: undefined,
})

const makeAssessment = (shouldWriteAdr: boolean): RemainingWorkAssessment => ({
  effort: 'high',
  worthiness: shouldWriteAdr ? 'low' : 'high',
  practical_value: shouldWriteAdr ? 'low' : 'high',
  should_write_adr: shouldWriteAdr,
  rationale: 'rationale',
})

describe('plan ADR workflow', () => {
  test('treats superseded plans as ADR-eligible even when not fully implemented', () => {
    expect(shouldRunAdrWorkflow(makeCheck('superseded', false))).toBe(true)
  })

  test('keeps ordinary not-implemented plans out of the ADR workflow', () => {
    expect(shouldRunAdrWorkflow(makeCheck('not_implemented', false))).toBe(false)
  })

  test('treats low-value remaining work as ADR-eligible', () => {
    expect(shouldRunAdrWorkflow(makeCheck('partially_implemented', false), makeAssessment(true))).toBe(true)
  })

  test('keeps valuable remaining work out of the ADR workflow', () => {
    expect(shouldRunAdrWorkflow(makeCheck('partially_implemented', false), makeAssessment(false))).toBe(false)
  })

  test('allows implementation checks to return superseded status', () => {
    expect(IMPLEMENTATION_CHECK_SCHEMA.properties.status.enum).toContain('superseded')
  })

  test('requires remaining-work assessments to return an ADR recommendation', () => {
    expect(REMAINING_WORK_ASSESSMENT_SCHEMA.required).toContain('should_write_adr')
  })

  test('does not fail when a file was already archived by the ADR agent', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'plan-adr-workflow-'))
    const sourcePath = join(tempDir, `plan-${crypto.randomUUID()}.md`)
    const archivedPath = join(ARCHIVE_DIR, basename(sourcePath))

    await mkdir(ARCHIVE_DIR, { recursive: true })
    await writeFile(archivedPath, 'already archived', 'utf-8')

    try {
      await expect(archiveFile(sourcePath, false)).resolves.toBeUndefined()
    } finally {
      await rm(archivedPath, { force: true })
    }
  })
})
