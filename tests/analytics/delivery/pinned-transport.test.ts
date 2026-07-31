// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'

import { approveSinkEndpoint, buildSinkAuthHeaders } from '../../../src/analytics/delivery/http-policy.js'
import type { ApprovedEndpoint, LookupAll, ResolvedAddress } from '../../../src/analytics/delivery/http-policy.js'
import {
  createEgressLimiter,
  createPinnedTransport,
  EGRESS_MAX_BODY_BYTES,
} from '../../../src/analytics/delivery/pinned-transport.js'
import type {
  PinnedSendOutcome,
  PolicyRequest,
  PolicyRequestOptions,
  PolicyResponse,
} from '../../../src/analytics/delivery/pinned-transport.js'
import type { DeliveryErrorClass } from '../../../src/analytics/delivery/sink.js'
import { mockLogger } from '../../utils/test-helpers.js'

const PUBLIC_A = { address: '203.0.113.10', family: 4 as const }
const ENDPOINT = 'https://sink.example.com/ingest?source=papai'

const lookupOf =
  (answers: readonly ResolvedAddress[]): LookupAll =>
  () =>
    Promise.resolve(answers)

// Scripted lookup helper at module scope — no-conditional-in-test requires
// branch logic to live outside test blocks.
const scriptedLookup = (scripts: ReadonlyArray<readonly ResolvedAddress[]>): LookupAll => {
  let call = 0
  return (): Promise<readonly ResolvedAddress[]> => {
    const answer = scripts[Math.min(call, scripts.length - 1)] ?? []
    call += 1
    return Promise.resolve(answer)
  }
}

const approve = (lookup: LookupAll): Promise<ApprovedEndpoint> => approveSinkEndpoint(ENDPOINT, { lookupAll: lookup })

// Narrowing helpers at module scope — no-conditional-in-test forbids ifs in test bodies.
const requireFirstCall = (calls: readonly FakeCall[]): FakeCall => {
  const first = calls[0]
  if (first === undefined) throw new Error('expected at least one request call')
  return first
}

const requireDelivered = (outcome: PinnedSendOutcome): Extract<PinnedSendOutcome, { kind: 'delivered' }> => {
  if (outcome.kind !== 'delivered') throw new Error(`expected delivered, got ${outcome.kind}`)
  return outcome
}

type FakeRequestHandle = Readonly<{
  request: PolicyRequest
  written: readonly Buffer[]
  destroyed: boolean
  emitTimeout: () => void
  emitError: (error: Error) => void
  respond: (status: number, body: string) => void
}>

const createFakeRequestHandle = (): FakeRequestHandle => {
  const emitter = new EventEmitter()
  const state = { written: [] as Buffer[], destroyed: false }
  return {
    get written() {
      return state.written
    },
    get destroyed() {
      return state.destroyed
    },
    request: {
      on: (event: string, listener: (response: PolicyResponse) => void): unknown => emitter.on(event, listener),
      end: (body?: string): void => {
        if (body !== undefined) state.written.push(Buffer.from(body))
        queueMicrotask(() => {
          emitter.emit('finish')
        })
      },
      destroy: (): void => {
        state.destroyed = true
      },
    },
    emitTimeout: (): void => {
      emitter.emit('timeout')
    },
    emitError: (error: Error): void => {
      emitter.emit('error', error)
    },
    respond: (status: number, body: string): void => {
      const responseEmitter = new EventEmitter()
      const response: PolicyResponse = {
        statusCode: status,
        on: (event: string, listener: (chunk: unknown) => void): unknown => responseEmitter.on(event, listener),
      }
      emitter.emit('response', response)
      queueMicrotask(() => {
        responseEmitter.emit('data', Buffer.from(body))
        responseEmitter.emit('end')
      })
    },
  }
}

type FakeCall = Readonly<{ options: PolicyRequestOptions; handle: FakeRequestHandle }>

const createFakeRequest = (
  responder: (call: FakeCall) => void,
): { requestFn: (options: PolicyRequestOptions) => PolicyRequest; calls: FakeCall[] } => {
  const calls: FakeCall[] = []
  const requestFn = (options: PolicyRequestOptions): PolicyRequest => {
    const handle = createFakeRequestHandle()
    const call: FakeCall = { options, handle }
    calls.push(call)
    queueMicrotask(() => {
      responder(call)
    })
    return handle.request
  }
  return { requestFn, calls }
}

const respondJson =
  (status: number, body: string) =>
  (call: FakeCall): void => {
    call.handle.respond(status, body)
  }

describe('pinned transport', () => {
  let approved: ApprovedEndpoint

  beforeEach(async () => {
    mockLogger()
    approved = await approve(lookupOf([PUBLIC_A]))
  })

  test('connects to the pinned address while TLS SNI and Host keep the configured hostname', async () => {
    const { requestFn, calls } = createFakeRequest(respondJson(200, '{"ok":true}'))
    const transport = createPinnedTransport({ request: requestFn })
    const outcome = await transport(approved, { headers: buildSinkAuthHeaders('token-1'), body: '{"a":1}' })
    expect(outcome.kind).toBe('delivered')
    expect(calls).toHaveLength(1)
    const { options } = requireFirstCall(calls)
    expect(options.host).toBe(PUBLIC_A.address)
    expect(options.servername).toBe('sink.example.com')
    expect(options.headers['host']).toBe('sink.example.com')
    expect(options.headers['authorization']).toBe('Bearer token-1')
    options.lookup('sink.example.com', {}, (_err, address, family) => {
      expect(address).toBe(PUBLIC_A.address)
      expect(family).toBe(PUBLIC_A.family)
    })
  })

  test('a DNS-rebinding flip after validation never changes the connected address', async () => {
    const rebindLookup = scriptedLookup([[PUBLIC_A], [{ address: '10.66.66.66', family: 4 }]])
    const rebindApproved = await approveSinkEndpoint(ENDPOINT, { lookupAll: rebindLookup })
    const { requestFn, calls } = createFakeRequest(respondJson(200, '{}'))
    const transport = createPinnedTransport({ request: requestFn })
    await transport(rebindApproved, { headers: {}, body: '{}' })
    expect(requireFirstCall(calls).options.host).toBe(PUBLIC_A.address)
    expect(calls).toHaveLength(1)
  })

  test('delivered responses store only a one-way receipt hash', async () => {
    const { requestFn } = createFakeRequest(respondJson(200, 'remote-receipt-body'))
    const transport = createPinnedTransport({ request: requestFn })
    const outcome = requireDelivered(await transport(approved, { headers: {}, body: '{}' }))
    expect(outcome.receiptHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(outcome.receiptHash).not.toContain('remote-receipt-body')
    expect(JSON.stringify(outcome)).not.toContain('remote-receipt-body')
  })

  test('redirects are refused: no follow, no second request, controlled policy class', async () => {
    const { requestFn, calls } = createFakeRequest(respondJson(302, ''))
    const transport = createPinnedTransport({ request: requestFn })
    const outcome = await transport(approved, { headers: {}, body: '{}' })
    expect(outcome).toEqual({ kind: 'responded', status: 302, errorClass: 'policy' })
    expect(calls).toHaveLength(1)
  })

  test('non-2xx statuses classify deterministically', async () => {
    const cases: ReadonlyArray<readonly [number, DeliveryErrorClass]> = [
      [400, 'http_4xx'],
      [401, 'auth'],
      [403, 'auth'],
      [404, 'http_4xx'],
      [500, 'http_5xx'],
      [503, 'http_5xx'],
    ]
    for (const [status, errorClass] of cases) {
      const { requestFn } = createFakeRequest(respondJson(status, ''))
      const transport = createPinnedTransport({ request: requestFn })
      const outcome = await transport(approved, { headers: {}, body: '{}' })
      expect(outcome).toEqual({ kind: 'responded', status, errorClass })
    }
  })

  test('an oversized body is refused before any network call', async () => {
    const requestSpy = mock()
    const transport = createPinnedTransport({ request: requestSpy })
    const outcome = await transport(approved, { headers: {}, body: 'x'.repeat(EGRESS_MAX_BODY_BYTES + 1) })
    expect(outcome).toEqual({ kind: 'policy', reason: 'body_too_large' })
    expect(requestSpy).not.toHaveBeenCalled()
  })

  test('a body at the cap is sent', async () => {
    const { requestFn } = createFakeRequest(respondJson(200, '{}'))
    const transport = createPinnedTransport({ request: requestFn })
    const outcome = await transport(approved, { headers: {}, body: 'x'.repeat(EGRESS_MAX_BODY_BYTES) })
    expect(outcome.kind).toBe('delivered')
  })

  test('timeout destroys the request and reports an uncertain acknowledgement', async () => {
    const { requestFn, calls } = createFakeRequest((call) => {
      call.handle.emitTimeout()
    })
    const transport = createPinnedTransport({ request: requestFn })
    const outcome = await transport(approved, { headers: {}, body: '{}', timeoutMs: 50 })
    expect(outcome).toEqual({ kind: 'timeout' })
    expect(requireFirstCall(calls).handle.destroyed).toBe(true)
    expect(requireFirstCall(calls).options.timeout).toBe(50)
  })

  test('network failure before the request is flushed is retryable; after flush is uncertain', async () => {
    const early = createFakeRequest((call) => {
      call.handle.emitError(new Error('ECONNREFUSED'))
    })
    const earlyOutcome = await createPinnedTransport({ request: early.requestFn })(approved, {
      headers: {},
      body: '{}',
    })
    expect(earlyOutcome).toEqual({ kind: 'network', acknowledgement: 'none' })

    const late = createFakeRequest((call) => {
      call.handle.request.on('finish', () => {
        call.handle.emitError(new Error('ECONNRESET'))
      })
    })
    const lateOutcome = await createPinnedTransport({ request: late.requestFn })(approved, {
      headers: {},
      body: '{}',
    })
    expect(lateOutcome).toEqual({ kind: 'network', acknowledgement: 'uncertain' })
  })

  test('sending against a different URL than the approved record is refused without a network call', async () => {
    const requestSpy = mock()
    const transport = createPinnedTransport({ request: requestSpy })
    const forged: ApprovedEndpoint = { ...approved, url: 'https://attacker.example.com/x' }
    const outcome: PinnedSendOutcome = await transport(forged, {
      headers: {},
      body: '{}',
      expectedUrl: ENDPOINT,
    })
    expect(outcome).toEqual({ kind: 'policy', reason: 'endpoint_mismatch' })
    expect(requestSpy).not.toHaveBeenCalled()
  })
})

describe('egress limiter', () => {
  test('the egress limiter bounds concurrency', async () => {
    const limit = createEgressLimiter(2)
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: 6 }, () =>
      limit(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5)
        })
        active -= 1
      }),
    )
    await Promise.all(tasks)
    expect(peak).toBeLessThanOrEqual(2)
  })
})
