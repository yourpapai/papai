// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { parseCliOptions } from './cli-options.js'

const SOURCE = '/private/tmp/papai-openpanel-source.sqlite'
const LEDGER = '/private/tmp/papai-openpanel-ledger.sqlite'

test('accepts explicit absolute fixture and independent ledger paths', () => {
  expect(
    parseCliOptions([
      '--source',
      SOURCE,
      '--ledger',
      LEDGER,
      '--client-id',
      'synthetic-client',
      '--sink-id',
      'openpanel-local',
      '--concurrency',
      '12',
      '--max-attempts',
      '2',
      '--timeout-ms',
      '5000',
      '--evidence',
      '/private/tmp/openpanel-evidence.json',
    ]),
  ).toEqual({
    ok: true,
    value: {
      baseUrl: 'http://127.0.0.1:4400',
      clientId: 'synthetic-client',
      concurrency: 12,
      evidencePath: '/private/tmp/openpanel-evidence.json',
      ledgerPath: LEDGER,
      maxAttempts: 2,
      simulateAmbiguousSuccesses: 0,
      sinkId: 'openpanel-local',
      sourcePath: SOURCE,
      timeoutMs: 5_000,
    },
  })
})

test('rejects a relative path, shared source ledger, and secret argument', () => {
  const relative = parseCliOptions([
    '--source',
    'fixture.sqlite',
    '--ledger',
    LEDGER,
    '--client-id',
    'synthetic-client',
  ])
  const shared = parseCliOptions(['--source', SOURCE, '--ledger', SOURCE, '--client-id', 'synthetic-client'])
  const secret = parseCliOptions([
    '--source',
    SOURCE,
    '--ledger',
    LEDGER,
    '--client-id',
    'synthetic-client',
    '--client-secret',
    'must-not-be-an-argument',
  ])

  expect(relative).toEqual({ code: 'PATH_MUST_BE_ABSOLUTE', ok: false })
  expect(shared).toEqual({ code: 'LEDGER_MUST_BE_SEPARATE', ok: false })
  expect(secret).toEqual({ code: 'UNKNOWN_ARGUMENT', ok: false })
})
