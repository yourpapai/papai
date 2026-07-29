// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  acceptedCases,
  issuesFromZod,
  jsonPath,
  rejectedCases,
  semanticIssue,
  type CaseValidationResult,
  type NormalizedPublicCase,
  type PublicDatasetProfile,
  type PublicImportIssue,
} from './importer-types.js'

type MemBenchProfile = Extract<PublicDatasetProfile, `membench-${string}`>

const choicesSchema = z
  .object({
    A: z.string(),
    B: z.string(),
    C: z.string(),
    D: z.string(),
  })
  .strict()
  .readonly()

const qaSchema = z
  .object({
    question: z.string().min(1),
    time: z.string().min(1),
    choices: choicesSchema,
    ground_truth: z.enum(['A', 'B', 'C', 'D']),
    target_step_id: z.array(z.number().int().nonnegative()).min(1).readonly(),
  })
  .strict()
  .readonly()

const participationStepSchema = z
  .object({
    user: z.string(),
    agent: z.string(),
  })
  .strict()
  .readonly()

const participationTrajectorySchema = z
  .object({
    tid: z.number().int().nonnegative(),
    message_list: z.array(participationStepSchema).min(1).readonly(),
    QA: qaSchema,
  })
  .strict()
  .readonly()

const observationTrajectorySchema = z
  .object({
    tid: z.number().int().nonnegative(),
    message_list: z.array(z.string()).min(1).readonly(),
    QA: qaSchema,
  })
  .strict()
  .readonly()

const nestedDatasetSchema = <Trajectory extends z.ZodType>(
  trajectorySchema: Trajectory,
): z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodReadonly<z.ZodArray<Trajectory>>>> =>
  z.record(z.string().min(1), z.record(z.string().min(1), z.array(trajectorySchema).min(1).readonly()))

const participationDatasetSchema = nestedDatasetSchema(participationTrajectorySchema)
const observationDatasetSchema = nestedDatasetSchema(observationTrajectorySchema)
type MemBenchQa = z.infer<typeof qaSchema>
type ParticipationTrajectory = z.infer<typeof participationTrajectorySchema>
type ObservationTrajectory = z.infer<typeof observationTrajectorySchema>

type LocatedTrajectory<Trajectory> = Readonly<{
  category: string
  scenario: string
  sourceRecordIndex: number
  trajectoryIndex: number
  value: Trajectory
}>

type UnindexedTrajectory<Trajectory> = Omit<LocatedTrajectory<Trajectory>, 'sourceRecordIndex'>

const locatedTrajectories = <Trajectory>(
  data: Readonly<Record<string, Readonly<Record<string, readonly Trajectory[]>>>>,
): readonly LocatedTrajectory<Trajectory>[] => {
  const unindexed: readonly UnindexedTrajectory<Trajectory>[] = Object.entries(data).flatMap(([category, scenarios]) =>
    Object.entries(scenarios).flatMap(([scenario, trajectories]) =>
      trajectories.map((value, trajectoryIndex) => ({
        category,
        scenario,
        trajectoryIndex,
        value,
      })),
    ),
  )
  return unindexed.map((located, sourceRecordIndex) => ({
    ...located,
    sourceRecordIndex,
  }))
}

const expectedReflectiveProfile = (profile: MemBenchProfile): boolean => profile.includes('-reflective-')

const categoryProfileIssues = (
  categories: readonly string[],
  profile: MemBenchProfile,
): readonly PublicImportIssue[] => {
  const expectsHighLevel = expectedReflectiveProfile(profile)
  return categories.flatMap((category) => {
    const isHighLevel = /highlevel/iu.test(category)
    return isHighLevel === expectsHighLevel
      ? []
      : [
          semanticIssue(
            jsonPath([category]),
            expectsHighLevel
              ? 'reflective profile requires upstream highlevel category keys'
              : 'factual profile rejects upstream highlevel category keys',
            null,
          ),
        ]
  })
}

const targetIssues = (
  qa: MemBenchQa,
  messageCount: number,
  path: string,
  recordIndex: number,
): readonly PublicImportIssue[] => {
  const seen = new Set<number>()
  return qa.target_step_id.flatMap((stepId, evidenceIndex) => {
    const duplicate = seen.has(stepId)
    seen.add(stepId)
    return [
      ...(stepId < messageCount
        ? []
        : [
            semanticIssue(
              `${path}.QA.target_step_id[${evidenceIndex}]`,
              `official target step ${stepId} is outside message_list`,
              recordIndex,
            ),
          ]),
      ...(duplicate
        ? [
            semanticIssue(
              `${path}.QA.target_step_id[${evidenceIndex}]`,
              `duplicate official target step: ${stepId}`,
              recordIndex,
            ),
          ]
        : []),
    ]
  })
}

const trajectoryPath = (category: string, scenario: string, trajectoryIndex: number): string =>
  jsonPath([category, scenario, trajectoryIndex])

const trajectoryIssues = (
  trajectories: readonly LocatedTrajectory<{
    readonly message_list: readonly unknown[]
    readonly QA: MemBenchQa
  }>[],
): readonly PublicImportIssue[] =>
  trajectories.flatMap(({ category, scenario, sourceRecordIndex, trajectoryIndex, value }) =>
    targetIssues(
      value.QA,
      value.message_list.length,
      trajectoryPath(category, scenario, trajectoryIndex),
      sourceRecordIndex,
    ),
  )

const normalizedQuestion = (
  caseId: string,
  category: string,
  qa: MemBenchQa,
): NormalizedPublicCase['questions'][number] => ({
  questionId: `${caseId}:qa`,
  text: qa.question,
  timestamp: qa.time,
  category,
  abstention: false,
  officialAnswers: [qa.ground_truth],
  officialChoices: qa.choices,
  officialEvidenceRefs: qa.target_step_id.map(String),
  evidenceGranularity: 'message',
})

const participationCase = (located: LocatedTrajectory<ParticipationTrajectory>): NormalizedPublicCase => {
  const { category, scenario, sourceRecordIndex, value } = located
  const caseId = `${category}:${scenario}:${value.tid}`
  const evidence = new Set(value.QA.target_step_id)
  return {
    caseId,
    sourceRecordIndex,
    category,
    sessions: [
      {
        sessionId: `${caseId}:memory-flow`,
        timestamp: null,
        messages: value.message_list.map((step, index) => ({
          messageId: String(index),
          role: 'speaker',
          speaker: null,
          content: `user: ${step.user}\nagent: ${step.agent}`,
          officialEvidence: evidence.has(index),
        })),
      },
    ],
    questions: [normalizedQuestion(caseId, category, value.QA)],
  }
}

const observationCase = (located: LocatedTrajectory<ObservationTrajectory>): NormalizedPublicCase => {
  const { category, scenario, sourceRecordIndex, value } = located
  const caseId = `${category}:${scenario}:${value.tid}`
  const evidence = new Set(value.QA.target_step_id)
  return {
    caseId,
    sourceRecordIndex,
    category,
    sessions: [
      {
        sessionId: `${caseId}:memory-flow`,
        timestamp: null,
        messages: value.message_list.map((content, index) => ({
          messageId: String(index),
          role: 'document',
          speaker: null,
          content,
          officialEvidence: evidence.has(index),
        })),
      },
    ],
    questions: [normalizedQuestion(caseId, category, value.QA)],
  }
}

const parseParticipation = (value: unknown, profile: MemBenchProfile): CaseValidationResult => {
  const parsed = participationDatasetSchema.safeParse(value)
  if (!parsed.success) return rejectedCases('invalid_revision', issuesFromZod(parsed.error))
  const trajectories = locatedTrajectories(parsed.data)
  const issues = [...categoryProfileIssues(Object.keys(parsed.data), profile), ...trajectoryIssues(trajectories)]
  return issues.length > 0
    ? rejectedCases('invalid_revision', issues)
    : acceptedCases(trajectories.map(participationCase))
}

const parseObservation = (value: unknown, profile: MemBenchProfile): CaseValidationResult => {
  const parsed = observationDatasetSchema.safeParse(value)
  if (!parsed.success) return rejectedCases('invalid_revision', issuesFromZod(parsed.error))
  const trajectories = locatedTrajectories(parsed.data)
  const issues = [...categoryProfileIssues(Object.keys(parsed.data), profile), ...trajectoryIssues(trajectories)]
  return issues.length > 0
    ? rejectedCases('invalid_revision', issues)
    : acceptedCases(trajectories.map(observationCase))
}

export const parseMemBench = (value: unknown, profile: MemBenchProfile): CaseValidationResult =>
  profile.includes('-participation-') ? parseParticipation(value, profile) : parseObservation(value, profile)
