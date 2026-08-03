// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { buildFamilySpecs, buildRows } from './corpus-families.js'
import type { CorpusCohort, CorpusLanguage, CorpusManifest, CorpusSplit, IntentCorpusRow } from './corpus-types.js'
import { CORE_INTENTS, INTENT_LABELS } from './taxonomy.js'

const OUTPUT_NAME = 'intent-v1-corpus.jsonl'
const MANIFEST_NAME = 'corpus-manifest.json'

const corpusRowSchema = z.strictObject({
  example_id: z.string(),
  scenario_family_id: z.string(),
  split: z.enum(['development', 'calibration', 'test']),
  cohort: z.enum(['canonical_core', 'no_action', 'unknown', 'multi_goal', 'adversarial_boundary']),
  language: z.enum(['en', 'mixed', 'ru']),
  context_type: z.enum(['dm', 'group']),
  actor_role: z.enum(['admin', 'member']),
  task_provider: z.enum(['kaneo', 'none', 'youtrack']),
  message: z.string(),
  tool_trace: z.array(
    z.strictObject({
      ordinal: z.number().int().positive(),
      tool_slug: z.string(),
      outcome: z.enum(['semantic_success', 'structured_failure', 'thrown_failure', 'permission_denied']),
    }),
  ),
  finish_reason: z.enum(['error', 'stop', 'tool_calls']),
  step_count: z.number().int().positive(),
  clarification: z.boolean(),
  error_class: z.enum(['none', 'unsupported']),
  command_family: z.enum(['config', 'help', 'none', 'stop']),
  feature_events: z.array(z.string()),
  gold_primary: z.enum(INTENT_LABELS),
  gold_goals: z.array(z.union([z.enum(CORE_INTENTS), z.literal('no_action')])),
  adjudication_notes: z.string(),
})

export interface GeneratedCorpusArtifacts {
  readonly corpusPath: string
  readonly manifestPath: string
  readonly corpusSha256: string
  readonly manifest: CorpusManifest
}

interface CorpusCounts {
  readonly splits: Record<CorpusSplit, number>
  readonly languages: Record<CorpusLanguage, number>
  readonly cohorts: Record<CorpusCohort, number>
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function countCorpus(rows: readonly IntentCorpusRow[]): CorpusCounts {
  const splits: Record<CorpusSplit, number> = { development: 0, calibration: 0, test: 0 }
  const languages: Record<CorpusLanguage, number> = { en: 0, mixed: 0, ru: 0 }
  const cohorts: Record<CorpusCohort, number> = {
    adversarial_boundary: 0,
    canonical_core: 0,
    multi_goal: 0,
    no_action: 0,
    unknown: 0,
  }
  for (const row of rows) {
    splits[row.split] += 1
    languages[row.language] += 1
    cohorts[row.cohort] += 1
  }
  return { splits, languages, cohorts }
}

async function sourceHash(fileName: string): Promise<string> {
  return sha256(await Bun.file(path.join(import.meta.dir, fileName)).text())
}

async function sourceGroupHash(fileNames: readonly string[]): Promise<string> {
  const sources = await Promise.all(
    fileNames.map(async (fileName) => `${fileName}\0${await Bun.file(path.join(import.meta.dir, fileName)).text()}`),
  )
  return sha256(sources.join('\0'))
}

async function reproducibilityHashes(): Promise<
  Omit<
    CorpusManifest['reproducibility'],
    'ordered_jsonl' | 'examples_per_family' | 'split_unit' | 'family_manifest_sha256' | 'taxonomy_sha256'
  >
> {
  const [classifier, evaluator, generator, familyGenerator, templates, contract, prompt, requestSchema, resultSchema] =
    await Promise.all([
      sourceHash('classifiers.ts'),
      sourceGroupHash([
        'evaluate.ts',
        'evaluation-metrics.ts',
        'evaluation-primary.ts',
        'evaluation-goals.ts',
        'evaluation-types.ts',
      ]),
      sourceHash('corpus-generator.ts'),
      sourceHash('corpus-families.ts'),
      sourceHash('corpus-templates.ts'),
      sourceGroupHash(['small-model-contract.ts', 'small-model-schemas.ts', 'small-model-runner.ts']),
      sourceHash('small-model-prompt.txt'),
      sourceHash('small-model-request.schema.json'),
      sourceHash('small-model-result.schema.json'),
    ])
  return {
    classifier_sha256: classifier,
    evaluator_sha256: evaluator,
    generator_sha256: generator,
    family_generator_sha256: familyGenerator,
    templates_sha256: templates,
    small_model_contract_sha256: contract,
    small_model_prompt_sha256: prompt,
    small_model_request_schema_sha256: requestSchema,
    small_model_result_schema_sha256: resultSchema,
  }
}

async function buildManifest(rows: readonly IntentCorpusRow[], corpusSha256: string): Promise<CorpusManifest> {
  const familySplits = buildFamilySpecs().map((spec) => ({
    scenario_family_id: spec.familyId,
    split: spec.split,
    examples: 10 as const,
  }))
  const counts = countCorpus(rows)
  return {
    schema: 'papai.intent.corpus-manifest.v1',
    spdx: 'BUSL-1.1',
    taxonomy: 'intent.v1',
    corpus: {
      path: OUTPUT_NAME,
      examples: 3_000,
      scenario_families: 300,
      sha256: corpusSha256,
      ...counts,
      invented_content_only: true,
    },
    reproducibility: {
      ordered_jsonl: true,
      examples_per_family: 10,
      split_unit: 'scenario_family_id',
      family_manifest_sha256: sha256(JSON.stringify(familySplits)),
      taxonomy_sha256: sha256(JSON.stringify(INTENT_LABELS)),
      ...(await reproducibilityHashes()),
    },
    family_splits: familySplits,
    annotation: {
      prototype_source: 'versioned_hand_authored_templates',
      independent_human_review: 'NOT_EXECUTED',
      cohen_kappa_primary: null,
      jaccard_goals: null,
      qualification_effect: 'requires_independent_review_before_production_claims',
    },
  }
}

export async function generateCorpusArtifacts(outputDirectory: string): Promise<GeneratedCorpusArtifacts> {
  const rows = buildRows()
  const jsonl = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  const corpusSha256 = sha256(jsonl)
  const manifest = await buildManifest(rows, corpusSha256)
  const corpusPath = path.join(outputDirectory, OUTPUT_NAME)
  const manifestPath = path.join(outputDirectory, MANIFEST_NAME)
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([Bun.write(corpusPath, jsonl), Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)])
  return { corpusPath, manifestPath, corpusSha256, manifest }
}

export async function readCorpus(corpusPath: string): Promise<IntentCorpusRow[]> {
  const text = await Bun.file(corpusPath).text()
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      return corpusRowSchema.parse(parsed)
    })
}

function parseOutputDirectory(args: readonly string[]): string | undefined {
  if (args.length === 0) return import.meta.dir
  if (args.length === 2 && args[0] === '--output-dir' && args[1] !== undefined) return args[1]
  return undefined
}

if (import.meta.main) {
  const outputDirectory = parseOutputDirectory(Bun.argv.slice(2))
  if (outputDirectory === undefined) {
    console.error('Usage: bun corpus-generator.ts [--output-dir /path/to/output]')
    process.exitCode = 1
  } else {
    const result = await generateCorpusArtifacts(outputDirectory)
    console.log(JSON.stringify({ corpus_sha256: result.corpusSha256, examples: 3_000 }))
  }
}
