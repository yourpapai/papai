// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { readCorpus } from '../../docs/research/analytics-metrics/poc/intent/corpus-generator.js'
import type { IntentCorpusRow } from '../../docs/research/analytics-metrics/poc/intent/corpus-types.js'
import { basicMetrics } from '../../docs/research/analytics-metrics/poc/intent/evaluation-primary.js'
import evaluationResults from '../../docs/research/analytics-metrics/poc/intent/evaluation-results.json' with { type: 'json' }
import { classifyHybrid, type IntentClassifierInput } from '../../src/analytics/intent/classifier.js'

const corpusPath = fileURLToPath(
  new URL('../../docs/research/analytics-metrics/poc/intent/intent-v1-corpus.jsonl', import.meta.url),
)

const toInput = (row: IntentCorpusRow): IntentClassifierInput => ({
  tool_trace: row.tool_trace,
  feature_events: row.feature_events,
  command_family: row.command_family,
})

describe('frozen 3,000-row corpus qualification parity', () => {
  test('runtime hybrid classifier reproduces the recorded sealed-test values', async () => {
    const rows = await readCorpus(corpusPath)
    expect(rows).toHaveLength(3_000)
    const sealedTest = rows.filter((row) => row.split === 'test')
    expect(sealedTest).toHaveLength(600)
    const predictions = sealedTest.map((row) => classifyHybrid(toInput(row)))
    const basics = basicMetrics(sealedTest, predictions)

    const recorded = evaluationResults.strategies.hybrid_v1.metrics
    expect(recorded.primary_accuracy).toBe(0.991667)
    expect(recorded.primary_macro_f1).toBe(0.995641)
    expect(recorded.coverage).toBe(0.991667)
    expect(recorded.per_label.unknown.precision).toBe(0.909091)

    expect(basics.primary_accuracy).toBe(recorded.primary_accuracy)
    expect(basics.primary_macro_f1).toBe(recorded.primary_macro_f1)
    expect(basics.coverage).toBe(recorded.coverage)
    expect(basics.per_label['unknown']?.precision).toBe(recorded.per_label.unknown.precision)
    expect(basics.selective_accuracy).toBe(recorded.selective_accuracy)
  })
})
