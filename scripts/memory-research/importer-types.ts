// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const PublicDatasetIdSchema = z.enum(['longmemeval', 'locomo', 'memoryagentbench', 'membench'])

export const PublicDatasetProfileSchema = z.enum([
  'longmemeval-cleaned-v1',
  'locomo-10-v1',
  'memoryagentbench-current-v1',
  'membench-participation-factual-v1',
  'membench-participation-reflective-v1',
  'membench-observation-factual-v1',
  'membench-observation-reflective-v1',
])

export const MemoryAgentBenchCompetencySchema = z.enum([
  'Accurate_Retrieval',
  'Test_Time_Learning',
  'Long_Range_Understanding',
  'Conflict_Resolution',
])

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)

export const NormalizedPublicMessageSchema = z
  .object({
    messageId: z.string().min(1),
    role: z.enum(['user', 'assistant', 'speaker', 'document']),
    speaker: z.string().min(1).nullable(),
    content: z.string(),
    officialEvidence: z.boolean(),
  })
  .strict()
  .readonly()

export const NormalizedPublicSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    timestamp: z.string().min(1).nullable(),
    messages: z.array(NormalizedPublicMessageSchema).min(1).readonly(),
  })
  .strict()
  .readonly()

export const NormalizedPublicQuestionSchema = z
  .object({
    questionId: z.string().min(1),
    text: z.string().min(1),
    timestamp: z.string().min(1).nullable(),
    category: z.string().min(1),
    abstention: z.boolean(),
    officialAnswers: z.array(z.json()).min(1).readonly(),
    officialChoices: z.record(z.string().min(1), z.json()).nullable(),
    officialEvidenceRefs: z.array(z.string().min(1)).readonly(),
    evidenceGranularity: z.enum(['session', 'dialog', 'message', 'none']),
  })
  .strict()
  .readonly()

export const NormalizedPublicCaseSchema = z
  .object({
    caseId: z.string().min(1),
    sourceRecordIndex: z.number().int().nonnegative(),
    category: z.string().min(1),
    sessions: z.array(NormalizedPublicSessionSchema).min(1).readonly(),
    questions: z.array(NormalizedPublicQuestionSchema).min(1).readonly(),
  })
  .strict()
  .readonly()

export const ImportedPublicDatasetSchema = z
  .object({
    datasetId: PublicDatasetIdSchema,
    profile: PublicDatasetProfileSchema,
    sourceSha256: sha256Schema,
    cases: z.array(NormalizedPublicCaseSchema).min(1).readonly(),
    importStatus: z.literal('validated'),
    protocolStatus: z.literal('not_run'),
  })
  .strict()
  .readonly()

export type PublicDatasetId = z.infer<typeof PublicDatasetIdSchema>
export type PublicDatasetProfile = z.infer<typeof PublicDatasetProfileSchema>
export type MemoryAgentBenchCompetency = z.infer<typeof MemoryAgentBenchCompetencySchema>
export type NormalizedPublicCase = z.infer<typeof NormalizedPublicCaseSchema>
export type ImportedPublicDataset = z.infer<typeof ImportedPublicDatasetSchema>

export type PublicDatasetImportRequest =
  | Readonly<{ datasetId: 'longmemeval'; profile: 'longmemeval-cleaned-v1' }>
  | Readonly<{ datasetId: 'locomo'; profile: 'locomo-10-v1' }>
  | Readonly<{
      datasetId: 'memoryagentbench'
      profile: 'memoryagentbench-current-v1'
      competencySplit: MemoryAgentBenchCompetency
    }>
  | Readonly<{
      datasetId: 'membench'
      profile:
        | 'membench-participation-factual-v1'
        | 'membench-participation-reflective-v1'
        | 'membench-observation-factual-v1'
        | 'membench-observation-reflective-v1'
    }>

export type PublicDatasetFileImportRequest = PublicDatasetImportRequest & Readonly<{ path: string }>

export const PublicImportErrorCodeSchema = z.enum([
  'invalid_profile',
  'invalid_source_hash',
  'invalid_shape',
  'invalid_revision',
  'invalid_reference',
  'non_local_source',
  'read_error',
  'invalid_json',
])

export const PublicImportIssueSchema = z
  .object({
    recordIndex: z.number().int().nonnegative().nullable(),
    path: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()
  .readonly()

export const PublicImportErrorSchema = z
  .object({
    code: PublicImportErrorCodeSchema,
    datasetId: PublicDatasetIdSchema,
    profile: PublicDatasetProfileSchema,
    message: z.string().min(1),
    issues: z.array(PublicImportIssueSchema).min(1).readonly(),
  })
  .strict()
  .readonly()

export type PublicImportErrorCode = z.infer<typeof PublicImportErrorCodeSchema>
export type PublicImportIssue = z.infer<typeof PublicImportIssueSchema>
export type PublicImportError = z.infer<typeof PublicImportErrorSchema>

export type PublicDatasetImportResult =
  | Readonly<{ ok: true; value: ImportedPublicDataset }>
  | Readonly<{ ok: false; error: PublicImportError }>

export type CaseValidationResult =
  | Readonly<{ ok: true; cases: readonly NormalizedPublicCase[] }>
  | Readonly<{
      ok: false
      code: PublicImportErrorCode
      issues: readonly PublicImportIssue[]
    }>

export const acceptedCases = (cases: readonly NormalizedPublicCase[]): CaseValidationResult => ({
  ok: true,
  cases,
})

export const rejectedCases = (
  code: PublicImportErrorCode,
  issues: readonly PublicImportIssue[],
): CaseValidationResult => ({ ok: false, code, issues })

export const semanticIssue = (path: string, message: string, recordIndex: number | null): PublicImportIssue => ({
  recordIndex,
  path,
  message,
})

const pathSegment = (value: PropertyKey): string =>
  typeof value === 'number'
    ? `[${value}]`
    : typeof value === 'string' && /^[A-Za-z_$][\w$]*$/u.test(value)
      ? `.${value}`
      : `[${JSON.stringify(String(value))}]`

export const jsonPath = (path: readonly PropertyKey[]): string => `$${path.map(pathSegment).join('')}`

const issuePaths = (issue: z.core.$ZodIssue): readonly (readonly PropertyKey[])[] =>
  issue.code === 'unrecognized_keys' ? issue.keys.map((key) => [...issue.path, key]) : [issue.path]

export const issuesFromZod = (error: z.ZodError): readonly PublicImportIssue[] =>
  error.issues.flatMap((issue) =>
    issuePaths(issue).map((path) => ({
      recordIndex: path.find((segment) => typeof segment === 'number') ?? null,
      path: jsonPath(path),
      message: issue.message,
    })),
  )

export const createImportError = (
  request: PublicDatasetImportRequest,
  code: PublicImportErrorCode,
  issues: readonly PublicImportIssue[],
): PublicImportError =>
  PublicImportErrorSchema.parse({
    code,
    datasetId: request.datasetId,
    profile: request.profile,
    message: `${request.datasetId}/${request.profile} import failed: ${issues
      .map(({ path, message }) => `${path}: ${message}`)
      .join('; ')}`,
    issues,
  })
