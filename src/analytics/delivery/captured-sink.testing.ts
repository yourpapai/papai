// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ApprovedEndpoint } from './http-policy.js'
import type { PinnedSendOutcome, PinnedTransport } from './pinned-transport.js'

export const CAPTURED_SINK_ENDPOINT = 'https://captured-sink.example.net/ingest'
export const SYNTHETIC_SINK_TOKEN = 'synthetic-captured-sink-token'

const CAPTURED_ENDPOINT: ApprovedEndpoint = {
  url: CAPTURED_SINK_ENDPOINT,
  hostname: 'captured-sink.example.net',
  port: 443,
  path: '/ingest',
  pinnedAddress: { address: '203.0.113.10', family: 4 },
}

export type CapturedEgressRequest = Readonly<{
  url: string
  hostname: string
  pinnedAddress: string
  headers: Readonly<Record<string, string>>
  body: string
}>

export type CapturedSink = Readonly<{
  endpoint: ApprovedEndpoint
  requests: CapturedEgressRequest[]
  transport: PinnedTransport
  setOutcome: (outcome: PinnedSendOutcome) => void
}>

export const createCapturedSink = (initialOutcome: PinnedSendOutcome): CapturedSink => {
  const requests: CapturedEgressRequest[] = []
  let outcome = initialOutcome
  const transport: PinnedTransport = (endpoint, input) => {
    requests.push({
      url: endpoint.url,
      hostname: endpoint.hostname,
      pinnedAddress: endpoint.pinnedAddress.address,
      headers: input.headers,
      body: input.body,
    })
    return Promise.resolve(outcome)
  }
  return {
    endpoint: CAPTURED_ENDPOINT,
    requests,
    transport,
    setOutcome: (next) => {
      outcome = next
    },
  }
}

export const findCanaries = (haystacks: readonly string[], canaries: readonly string[]): readonly string[] =>
  canaries.filter((canary) => haystacks.some((haystack) => haystack.includes(canary)))
