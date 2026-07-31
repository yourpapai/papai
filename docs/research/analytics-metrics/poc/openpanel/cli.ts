// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'

import { parseCliOptions, type CliOptions } from './cli-options.js'
import { buildRunEvidence } from './evidence.js'
import { forwardMappedEvents } from './forwarder.js'
import { initializeDeliveryLedger } from './ledger.js'
import { readCanonicalFixture } from './source.js'
import { createOpenPanelTransport } from './transport.js'

async function run(options: CliOptions, clientSecret: string): Promise<number> {
  const source = await readCanonicalFixture(options.sourcePath)
  if (!source.ok) {
    console.error(JSON.stringify({ code: source.code, status: 'error' }))
    return 1
  }
  const transport = createOpenPanelTransport({
    baseUrl: options.baseUrl,
    clientId: options.clientId,
    clientSecret,
    fetchImpl: fetch,
    simulateAmbiguousSuccesses: options.simulateAmbiguousSuccesses,
    timeoutMs: options.timeoutMs,
  })
  if (!transport.ok) {
    console.error(JSON.stringify({ code: transport.code, status: 'error' }))
    return 1
  }
  using database = new Database(options.ledgerPath, { create: true, strict: true })
  initializeDeliveryLedger(database)
  const forwarder = await forwardMappedEvents({
    concurrency: options.concurrency,
    database,
    events: source.value.events,
    maxAttempts: options.maxAttempts,
    nowMs: Date.now,
    send: transport.send,
    sinkId: options.sinkId,
  })
  const evidence = buildRunEvidence({
    baseUrl: options.baseUrl,
    fixtureSha256: source.value.fixtureSha256,
    forwarder,
    profileEventCount: source.value.profileEventCount,
    selectedEventCount: source.value.events.length,
    simulateAmbiguousSuccesses: options.simulateAmbiguousSuccesses,
    sinkId: options.sinkId,
    sourceEventCount: source.value.sourceEventCount,
  })
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  if (options.evidencePath !== undefined) await Bun.write(options.evidencePath, serialized)
  console.log(serialized.trim())
  return forwarder.ledger.pending === 0 && forwarder.ledger.dead === 0 ? 0 : 2
}

async function main(): Promise<number> {
  const parsed = parseCliOptions(Bun.argv.slice(2))
  if (!parsed.ok) {
    console.error(JSON.stringify({ code: parsed.code, status: 'error' }))
    return 1
  }
  const clientSecret = process.env['OPENPANEL_CLIENT_SECRET']
  if (clientSecret === undefined || clientSecret.length === 0) {
    console.error(JSON.stringify({ code: 'OPENPANEL_CLIENT_SECRET_REQUIRED', status: 'error' }))
    return 1
  }
  const exitCode = await run(parsed.value, clientSecret)
  return exitCode
}

process.exitCode = await main()
