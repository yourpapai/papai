// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { parseLocomo } from './importer-locomo.js'
import { parseLongMemEval } from './importer-longmemeval.js'
import { parseMemBench } from './importer-membench.js'
import { parseMemoryAgentBench } from './importer-memoryagentbench.js'
import {
  ImportedPublicDatasetSchema,
  createImportError,
  semanticIssue,
  type CaseValidationResult,
  type PublicDatasetFileImportRequest,
  type PublicDatasetImportRequest,
  type PublicDatasetImportResult,
} from './importer-types.js'

export {
  ImportedPublicDatasetSchema,
  MemoryAgentBenchCompetencySchema,
  NormalizedPublicCaseSchema,
  NormalizedPublicMessageSchema,
  NormalizedPublicQuestionSchema,
  NormalizedPublicSessionSchema,
  PublicDatasetIdSchema,
  PublicDatasetProfileSchema,
  PublicImportErrorSchema,
} from './importer-types.js'

export type {
  CaseValidationResult,
  ImportedPublicDataset,
  MemoryAgentBenchCompetency,
  NormalizedPublicCase,
  PublicDatasetFileImportRequest,
  PublicDatasetId,
  PublicDatasetImportRequest,
  PublicDatasetImportResult,
  PublicDatasetProfile,
  PublicImportError,
  PublicImportIssue,
} from './importer-types.js'

const reject = (
  request: PublicDatasetImportRequest,
  code: Parameters<typeof createImportError>[1],
  issues: Parameters<typeof createImportError>[2],
): PublicDatasetImportResult => ({
  ok: false,
  error: createImportError(request, code, issues),
})

export const parsePublicDatasetCases = (request: PublicDatasetImportRequest, value: unknown): CaseValidationResult => {
  switch (request.datasetId) {
    case 'longmemeval':
      return parseLongMemEval(value)
    case 'locomo':
      return parseLocomo(value)
    case 'memoryagentbench':
      return parseMemoryAgentBench(value, request.competencySplit)
    case 'membench':
      return parseMemBench(value, request.profile)
  }
  const unreachable: never = request
  return unreachable
}

const certifyLocalDataset = (
  request: PublicDatasetImportRequest,
  raw: Buffer,
  value: unknown,
): PublicDatasetImportResult => {
  const parsed = parsePublicDatasetCases(request, value)
  if (!parsed.ok) return reject(request, parsed.code, parsed.issues)

  const sourceSha256 = createHash('sha256').update(raw).digest('hex')
  const normalized = ImportedPublicDatasetSchema.safeParse({
    datasetId: request.datasetId,
    profile: request.profile,
    sourceSha256,
    cases: parsed.cases,
    importStatus: 'validated',
    protocolStatus: 'not_run',
  })
  return normalized.success
    ? { ok: true, value: normalized.data }
    : reject(request, 'invalid_shape', [
        semanticIssue('$', `normalized importer output violated its schema: ${normalized.error.message}`, null),
      ])
}

const nonLocalPath = (path: string): boolean =>
  /^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(path) || /^(?:data|javascript):/iu.test(path)

const memBenchBasenames = {
  'membench-participation-factual-v1': 'FirstAgentDataLowLevel_multiple_0.json',
  'membench-participation-reflective-v1': 'FirstAgentDataHighLevel_multiple_0.json',
  'membench-observation-factual-v1': 'ThirdAgentDataLowLevel_multiple_0.json',
  'membench-observation-reflective-v1': 'ThirdAgentDataHighLevel_multiple_0.json',
} as const

const invalidMemBenchBasename = (request: PublicDatasetFileImportRequest): PublicDatasetImportResult | null => {
  if (request.datasetId !== 'membench') return null
  const expected = memBenchBasenames[request.profile]
  return basename(request.path) === expected
    ? null
    : reject(request, 'invalid_revision', [
        semanticIssue('$path', `${request.profile} requires official zero-noise export basename ${expected}`, null),
      ])
}

const readLocalJson = async (
  request: PublicDatasetFileImportRequest,
): Promise<
  Readonly<{ ok: true; raw: Buffer; value: unknown }> | Readonly<{ ok: false; result: PublicDatasetImportResult }>
> => {
  let raw: Buffer
  try {
    raw = await readFile(request.path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      result: reject(request, 'read_error', [semanticIssue('$path', message, null)]),
    }
  }

  try {
    return { ok: true, raw, value: JSON.parse(raw.toString('utf8')) as unknown }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      result: reject(request, 'invalid_json', [semanticIssue('$', message, null)]),
    }
  }
}

export const importPublicDatasetFile = async (
  request: PublicDatasetFileImportRequest,
): Promise<PublicDatasetImportResult> => {
  if (nonLocalPath(request.path)) {
    return reject(request, 'non_local_source', [
      semanticIssue('$path', 'only caller-supplied local JSON paths are accepted', null),
    ])
  }
  const revisionError = invalidMemBenchBasename(request)
  if (revisionError !== null) return revisionError

  const loaded = await readLocalJson(request)
  if (!loaded.ok) return loaded.result

  return certifyLocalDataset(request, loaded.raw, loaded.value)
}
