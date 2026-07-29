// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as importerApi from '../../scripts/memory-research/importers.js'
import {
  ImportedPublicDatasetSchema,
  importPublicDatasetFile,
  parsePublicDatasetCases,
  type CaseValidationResult,
  type ImportedPublicDataset,
  type NormalizedPublicCase,
  type PublicDatasetImportResult,
} from '../../scripts/memory-research/importers.js'

type LocomoFixture = Readonly<{
  sample_id: string
  conversation: Readonly<Record<string, unknown>>
  observation: Readonly<Record<string, string>>
  session_summary: Readonly<Record<string, string>>
  event_summary: Readonly<Record<string, string>>
  qa: readonly Readonly<{
    question: string
    answer: string
    category: number
    evidence: readonly string[]
  }>[]
}>

type MemoryAgentBenchFixture = Readonly<{
  context: string
  questions: readonly string[]
  answers: readonly (readonly string[])[]
  metadata: Readonly<{
    qa_pair_ids: readonly string[]
    question_types: readonly string[] | null
    question_dates: readonly string[] | null
    question_ids: readonly string[] | null
    source: string | null
    demo: null
    haystack_sessions: unknown
    keypoints: null
    previous_events: null
  }>
}>

const expectImported = (result: PublicDatasetImportResult): ImportedPublicDataset => {
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.value
}

const expectRejected = (
  result: PublicDatasetImportResult,
): Extract<PublicDatasetImportResult, { readonly ok: false }>['error'] => {
  expect(result.ok).toBe(false)
  if (result.ok) {
    throw new Error('Expected import to be rejected')
  }
  return result.error
}

const expectCases = (result: CaseValidationResult): readonly NormalizedPublicCase[] => {
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(`Expected case normalization to succeed: ${result.issues.map(({ message }) => message).join('; ')}`)
  }
  return result.cases
}

const expectCasesRejected = (result: CaseValidationResult): Extract<CaseValidationResult, { readonly ok: false }> => {
  expect(result.ok).toBe(false)
  if (result.ok) {
    throw new Error('Expected case normalization to be rejected')
  }
  return result
}

const makeLongMemEvalRecord = (): Readonly<Record<string, unknown>> => ({
  question_id: 'q_abs',
  question_type: 'single-session-user',
  question: 'Which city did I say I avoid?',
  answer: 'session-2',
  question_date: '2025/01/03 (Fri) 09:00',
  haystack_session_ids: ['session-1', 'session-2'],
  haystack_dates: ['2025/01/01 (Wed) 09:00', '2025/01/02 (Thu) 09:00'],
  haystack_sessions: [
    [
      {
        role: 'user',
        content: 'I avoid Oslo in winter.',
        has_answer: true,
      },
      { role: 'assistant', content: 'Understood.' },
    ],
    [
      { role: 'user', content: 'This is a distractor.' },
      { role: 'assistant', content: 'Noted.' },
    ],
  ],
  answer_session_ids: ['session-1'],
})

const makeLocomoSample = (index: number): LocomoFixture => ({
  sample_id: `locomo-${index}`,
  conversation: {
    speaker_a: 'Alice',
    speaker_b: 'Bob',
    session_1_date_time: '1:00 pm on 8 May, 2023',
    session_1: [
      {
        speaker: 'Alice',
        dia_id: `d-${index}-1`,
        text: 'I adopted a dog named Pixel.',
      },
      {
        speaker: 'Bob',
        dia_id: `d-${index}-2`,
        text: 'That is wonderful.',
      },
    ],
  },
  observation: { generated: 'must not become memory input' },
  session_summary: { generated: 'must not become memory input' },
  event_summary: { annotated: 'must not become memory input' },
  qa: [
    {
      question: 'What is the dog called?',
      answer: 'Pixel',
      category: 1,
      evidence: [`d-${index}-1`],
    },
  ],
})

const makeMemoryAgentBenchRecord = (): MemoryAgentBenchFixture => ({
  context: 'The user stores the launch code in a blue notebook.',
  questions: ['Where is the launch code?', 'What color is the notebook?'],
  answers: [['a blue notebook'], ['blue']],
  metadata: {
    qa_pair_ids: ['mab-q-1', 'mab-q-2'],
    question_types: ['retrieval', 'retrieval'],
    question_dates: ['2025-01-02', '2025-01-02'],
    question_ids: ['source-q-1', 'source-q-2'],
    source: 'longmemeval',
    demo: null,
    haystack_sessions: null,
    keypoints: null,
    previous_events: null,
  },
})

const makeMemBenchExport = (
  mode: 'participation' | 'observation',
  level: 'factual' | 'reflective',
): Readonly<Record<string, unknown>> => {
  const category = level === 'factual' ? '01_simple_roles' : '01_highlevel_preferences'
  const messageList =
    mode === 'participation'
      ? [{ user: 'Remember Beta.', agent: 'I will remember it.' }]
      : ['An observed agent selected Beta.']
  return {
    [category]: {
      role: [
        {
          tid: 7,
          message_list: messageList,
          QA: {
            question: 'Which option is correct?',
            time: '2025-02-03 10:00',
            choices: {
              A: 'Alpha',
              B: 'Beta',
              C: 'Gamma',
              D: 'Delta',
            },
            ground_truth: 'B',
            target_step_id: [0],
          },
        },
      ],
    },
  }
}

describe('LongMemEval cleaned-v1 importer', () => {
  test('uses the official question_id _abs suffix instead of changing question_type', () => {
    const cases = expectCases(
      parsePublicDatasetCases(
        {
          datasetId: 'longmemeval',
          profile: 'longmemeval-cleaned-v1',
        },
        [
          {
            ...makeLongMemEvalRecord(),
            question_id: 'official-question_abs',
            question_type: 'single-session-user',
          },
        ],
      ),
    )

    expect(cases[0]?.category).toBe('single-session-user')
    expect(cases[0]?.questions[0]).toMatchObject({
      questionId: 'official-question_abs',
      category: 'single-session-user',
      abstention: true,
    })
  })

  test('preserves official session evidence and never infers it from answers', () => {
    const cases = expectCases(
      parsePublicDatasetCases(
        {
          datasetId: 'longmemeval',
          profile: 'longmemeval-cleaned-v1',
        },
        [makeLongMemEvalRecord()],
      ),
    )

    expect(cases[0]?.sessions.map(({ sessionId }) => sessionId)).toEqual(['session-1', 'session-2'])
    expect(cases[0]?.questions[0]).toMatchObject({
      questionId: 'q_abs',
      abstention: true,
      officialEvidenceRefs: ['session-1'],
      evidenceGranularity: 'session',
      officialAnswers: ['session-2'],
    })
    expect(cases[0]?.sessions[0]?.messages[0]?.officialEvidence).toBe(true)
    expect(cases[0]?.sessions[1]?.messages[0]?.officialEvidence).toBe(false)
  })

  test('rejects parallel-array mismatch with record and JSON-path context', () => {
    const record = {
      ...makeLongMemEvalRecord(),
      haystack_dates: ['2025/01/01 (Wed) 09:00'],
    }
    const error = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'longmemeval',
          profile: 'longmemeval-cleaned-v1',
        },
        [record],
      ),
    )

    expect(error.issues.map(({ recordIndex, path }) => `${String(recordIndex)}:${path}`)).toContain(
      '0:$[0].haystack_dates',
    )
  })

  test('rejects undocumented fields instead of guessing a legacy revision', () => {
    const error = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'longmemeval',
          profile: 'longmemeval-cleaned-v1',
        },
        [{ ...makeLongMemEvalRecord(), answer_sessions: ['session-1'] }],
      ),
    )

    expect(error.issues[0]?.path).toContain('answer_sessions')
  })

  test('rejects the non-official question_type abstention suffix', () => {
    const error = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'longmemeval',
          profile: 'longmemeval-cleaned-v1',
        },
        [{ ...makeLongMemEvalRecord(), question_type: 'single-session-user_abs' }],
      ),
    )

    expect(error.code).toBe('invalid_shape')
    expect(error.issues.map(({ path }) => path)).toContain('$[0].question_type')
  })
})

describe('LoCoMo 10-conversation importer', () => {
  test('imports exactly ten conversations and excludes generated summaries', () => {
    const cases = expectCases(
      parsePublicDatasetCases(
        { datasetId: 'locomo', profile: 'locomo-10-v1' },
        Array.from({ length: 10 }, (_, index) => makeLocomoSample(index)),
      ),
    )

    expect(cases).toHaveLength(10)
    expect(cases[0]?.sessions).toHaveLength(1)
    expect(cases[0]?.sessions[0]?.messages).toHaveLength(2)
    expect(cases[0]?.questions[0]).toMatchObject({
      officialEvidenceRefs: ['d-0-1'],
      evidenceGranularity: 'dialog',
    })
    expect(JSON.stringify(cases)).not.toContain('must not become memory input')
  })

  test('rejects the legacy 50-conversation release explicitly', () => {
    const error = expectCasesRejected(
      parsePublicDatasetCases(
        { datasetId: 'locomo', profile: 'locomo-10-v1' },
        Array.from({ length: 50 }, (_, index) => makeLocomoSample(index)),
      ),
    )

    expect(error.issues.map(({ recordIndex, path, message }) => `${String(recordIndex)}:${path}:${message}`)).toContain(
      'null:$:locomo-10-v1 requires exactly 10 records; received 50',
    )
  })

  test('rejects evidence dialog IDs that are not in the conversation', () => {
    const first = makeLocomoSample(0)
    const invalidFirst = {
      ...first,
      qa: [
        {
          ...first.qa[0]!,
          evidence: ['missing-dialog'],
        },
      ],
    }
    const samples = [invalidFirst, ...Array.from({ length: 9 }, (_, index) => makeLocomoSample(index + 1))]

    const error = expectCasesRejected(
      parsePublicDatasetCases({ datasetId: 'locomo', profile: 'locomo-10-v1' }, samples),
    )
    expect(error.issues.map(({ recordIndex, path }) => `${String(recordIndex)}:${path}`)).toContain(
      '0:$[0].qa[0].evidence[0]',
    )
  })

  test('rejects conversation turns attributed to an undeclared speaker', () => {
    const first = makeLocomoSample(0)
    const invalidFirst = {
      ...first,
      conversation: {
        ...first.conversation,
        session_1: [
          {
            speaker: 'Mallory',
            dia_id: 'd-0-1',
            text: 'I adopted a dog named Pixel.',
          },
        ],
      },
    }
    const error = expectCasesRejected(
      parsePublicDatasetCases({ datasetId: 'locomo', profile: 'locomo-10-v1' }, [
        invalidFirst,
        ...Array.from({ length: 9 }, (_, index) => makeLocomoSample(index + 1)),
      ]),
    )

    expect(error.issues.map(({ path }) => path)).toContain('$[0].conversation.session_1[0].speaker')
  })

  test('accepts released multimodal turns and category-5 adversarial answers', () => {
    const first = makeLocomoSample(0)
    const officialVariant = {
      ...first,
      conversation: {
        ...first.conversation,
        session_1: [
          {
            speaker: 'Alice',
            dia_id: 'd-0-1',
            text: 'I adopted a dog named Pixel.',
            img_url: ['https://example.test/pixel.jpg'],
            blip_caption: 'a dog',
            query: 'dog photo',
            're-download': true,
          },
          {
            speaker: 'Bob',
            dia_id: 'd-0-2',
            text: 'That is wonderful.',
          },
        ],
      },
      qa: [
        {
          question: 'What incorrect dog name should be rejected?',
          adversarial_answer: 'Pixel',
          category: 5,
          evidence: ['d-0-1'],
        },
      ],
    }
    const cases = expectCases(
      parsePublicDatasetCases({ datasetId: 'locomo', profile: 'locomo-10-v1' }, [
        officialVariant,
        ...Array.from({ length: 9 }, (_, index) => makeLocomoSample(index + 1)),
      ]),
    )

    expect(cases[0]?.questions[0]?.officialAnswers).toEqual(['Pixel'])
    expect(cases[0]?.questions[0]?.abstention).toBe(true)
    expect(cases[0]?.sessions[0]?.messages[0]?.messageId).toBe('d-0-1')
  })
})

describe('MemoryAgentBench current split exporter', () => {
  test('requires an explicit competency split and preserves current qa_pair_ids', () => {
    const cases = expectCases(
      parsePublicDatasetCases(
        {
          datasetId: 'memoryagentbench',
          profile: 'memoryagentbench-current-v1',
          competencySplit: 'Accurate_Retrieval',
        },
        [makeMemoryAgentBenchRecord()],
      ),
    )

    expect(cases[0]?.category).toBe('Accurate_Retrieval')
    expect(cases[0]?.questions.map(({ questionId }) => questionId)).toEqual(['mab-q-1', 'mab-q-2'])
    expect(cases[0]?.questions[0]?.officialEvidenceRefs).toEqual([])
    expect(cases[0]?.questions[0]?.officialAnswers).toEqual(['a blue notebook'])
    expect(cases[0]?.questions[1]?.officialAnswers).toEqual(['blue'])
  })

  test('accepts null non-applicable fields in the unified current metadata struct', () => {
    const current = makeMemoryAgentBenchRecord()
    const cases = expectCases(
      parsePublicDatasetCases(
        {
          datasetId: 'memoryagentbench',
          profile: 'memoryagentbench-current-v1',
          competencySplit: 'Test_Time_Learning',
        },
        [
          {
            ...current,
            metadata: {
              ...current.metadata,
              question_types: null,
              question_dates: null,
              question_ids: null,
              source: null,
              haystack_sessions: [
                [
                  [
                    {
                      content: 'A structured source turn.',
                      has_answer: true,
                      role: 'user',
                    },
                  ],
                ],
              ],
            },
          },
        ],
      ),
    )

    expect(cases[0]?.questions[0]?.category).toBe('Test_Time_Learning')
    expect(cases[0]?.questions[0]?.timestamp).toBeNull()
  })

  test('rejects unequal questions, answers, and metadata.qa_pair_ids arrays', () => {
    const record = {
      ...makeMemoryAgentBenchRecord(),
      answers: [['a blue notebook']],
    }
    const error = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'memoryagentbench',
          profile: 'memoryagentbench-current-v1',
          competencySplit: 'Accurate_Retrieval',
        },
        [record],
      ),
    )

    expect(error.issues.map(({ recordIndex, path }) => `${String(recordIndex)}:${path}`)).toContain('0:$[0].answers')
  })

  test('rejects the legacy uuid metadata field', () => {
    const current = makeMemoryAgentBenchRecord()
    const { qa_pair_ids: _qaPairIds, ...metadata } = current.metadata
    const error = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'memoryagentbench',
          profile: 'memoryagentbench-current-v1',
          competencySplit: 'Conflict_Resolution',
        },
        [{ ...current, metadata: { ...metadata, uuid: ['legacy-q'] } }],
      ),
    )

    expect(error.issues.some(({ path }) => path.includes('uuid'))).toBe(true)
    expect(error.code).toBe('invalid_revision')
  })
})

describe('MemBench explicit profile importers', () => {
  const participationProfiles = [
    {
      profile: 'membench-participation-factual-v1',
      value: makeMemBenchExport('participation', 'factual'),
    },
    {
      profile: 'membench-participation-reflective-v1',
      value: makeMemBenchExport('participation', 'reflective'),
    },
  ] as const
  const observationProfiles = [
    {
      profile: 'membench-observation-factual-v1',
      value: makeMemBenchExport('observation', 'factual'),
    },
    {
      profile: 'membench-observation-reflective-v1',
      value: makeMemBenchExport('observation', 'reflective'),
    },
  ] as const

  for (const { profile, value } of participationProfiles) {
    test(`imports ${profile}`, () => {
      const cases = expectCases(parsePublicDatasetCases({ datasetId: 'membench', profile }, value))

      expect(cases[0]?.sessions[0]?.messages).toHaveLength(1)
      expect(cases[0]?.sessions[0]?.messages[0]?.content).toContain('user: Remember Beta.')
      expect(cases[0]?.questions[0]?.officialEvidenceRefs).toEqual(['0'])
      expect(cases[0]?.questions[0]?.officialAnswers).toEqual(['B'])
      expect(cases[0]?.questions[0]?.officialChoices).toEqual({
        A: 'Alpha',
        B: 'Beta',
        C: 'Gamma',
        D: 'Delta',
      })
    })
  }

  for (const { profile, value } of observationProfiles) {
    test(`imports ${profile}`, () => {
      const cases = expectCases(parsePublicDatasetCases({ datasetId: 'membench', profile }, value))

      expect(cases[0]?.sessions[0]?.messages[0]).toMatchObject({
        role: 'document',
        speaker: null,
      })
    })
  }

  test('rejects profile/data-shape mismatch rather than interpreting it', () => {
    const error = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'membench',
          profile: 'membench-observation-factual-v1',
        },
        makeMemBenchExport('participation', 'factual'),
      ),
    )

    expect(error.code).toBe('invalid_revision')
    expect(error.issues.map(({ path }) => path).join(',')).toContain('message_list')
  })

  test('rejects raw question_list and scale-envelope JSON families', () => {
    const rawFamilyError = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'membench',
          profile: 'membench-observation-factual-v1',
        },
        {
          '01_simple_roles': {
            role: [{ tid: 7, message_list: ['Beta'], question_list: [] }],
          },
        },
      ),
    )
    const scaleEnvelopeError = expectCasesRejected(
      parsePublicDatasetCases(
        {
          datasetId: 'membench',
          profile: 'membench-observation-factual-v1',
        },
        {
          scale: '100k',
          data: makeMemBenchExport('observation', 'factual'),
        },
      ),
    )

    expect(rawFamilyError.issues.map(({ path }) => path).join(',')).toContain('QA')
    expect(scaleEnvelopeError.code).toBe('invalid_revision')
  })
})

describe('local file boundary', () => {
  test('does not expose caller-certified value provenance', () => {
    expect(Object.hasOwn(importerApi, 'parsePublicDatasetValue')).toBe(false)
  })

  test('hashes exact caller-supplied JSON bytes and does not run the protocol', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'papai-importer-'))
    const path = join(directory, 'longmemeval.json')
    const raw = `${JSON.stringify([makeLongMemEvalRecord()], null, 2)}\n`
    await writeFile(path, raw, 'utf8')

    const imported = expectImported(
      await importPublicDatasetFile({
        datasetId: 'longmemeval',
        profile: 'longmemeval-cleaned-v1',
        path,
      }),
    )
    await rm(directory, { recursive: true })

    expect(imported.sourceSha256).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(imported.importStatus).toBe('validated')
    expect(imported.protocolStatus).toBe('not_run')
    expect(ImportedPublicDatasetSchema.safeParse(imported).success).toBe(true)
  })

  test('rejects URLs without downloading them', async () => {
    const error = expectRejected(
      await importPublicDatasetFile({
        datasetId: 'locomo',
        profile: 'locomo-10-v1',
        path: 'https://example.test/locomo10.json',
      }),
    )

    expect(error.code).toBe('non_local_source')
    expect(error.issues[0]?.path).toBe('$path')
  })

  test('rejects MemBench noise/scale variants by official export basename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'papai-importer-'))
    const path = join(directory, 'ThirdAgentDataLowLevel_multiple_100.json')
    await writeFile(path, JSON.stringify(makeMemBenchExport('observation', 'factual')), 'utf8')

    const error = expectRejected(
      await importPublicDatasetFile({
        datasetId: 'membench',
        profile: 'membench-observation-factual-v1',
        path,
      }),
    )
    await rm(directory, { recursive: true })

    expect(error.code).toBe('invalid_revision')
    expect(error.issues[0]?.message).toContain('ThirdAgentDataLowLevel_multiple_0.json')
  })

  test('reports invalid JSON at the document root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'papai-importer-'))
    const path = join(directory, 'invalid.json')
    await writeFile(path, '{"broken":', 'utf8')

    const error = expectRejected(
      await importPublicDatasetFile({
        datasetId: 'locomo',
        profile: 'locomo-10-v1',
        path,
      }),
    )
    await rm(directory, { recursive: true })

    expect(error.code).toBe('invalid_json')
    expect(error.issues).toEqual([expect.objectContaining({ recordIndex: null, path: '$' })])
  })
})
