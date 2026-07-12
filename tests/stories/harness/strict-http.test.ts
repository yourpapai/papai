// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioEvents } from './events.js'
import { createStrictHttpDispatcher } from './strict-http.js'

const captureError = (promise: Promise<unknown>): Promise<Error> =>
  promise.then(
    () => Promise.reject(new Error('expected rejection')),
    (error: unknown) =>
      error instanceof Error
        ? Promise.resolve(error)
        : Promise.reject(new Error(`non-error rejection: ${String(error)}`)),
  )

describe('strict http dispatcher', () => {
  test('matches exactly in declaration order and consumes each expectation once', async () => {
    const http = createStrictHttpDispatcher(createScenarioEvents('ordered http'))
    http.expect({ method: 'get', url: 'https://api.test/tasks' }, () => Response.json({ step: 1 }))
    http.expect({ method: 'POST', url: 'https://api.test/tasks' }, () => new Response(null, { status: 204 }))

    expect(await (await http.fetch('https://api.test/tasks')).json()).toEqual({ step: 1 })
    expect((await http.fetch('https://api.test/tasks', { method: 'post' })).status).toBe(204)
    expect(() => http.verifyConsumed()).not.toThrow()
    expect(http.fetch('https://api.test/tasks')).rejects.toThrow('undeclared request')
  })

  test('fails an out-of-order request without consuming the next expectation', async () => {
    const http = createStrictHttpDispatcher(createScenarioEvents('order mismatch'))
    http.expect({ method: 'GET', url: 'https://api.test/first' }, () => new Response('first'))
    http.expect({ method: 'GET', url: 'https://api.test/second' }, () => new Response('second'))

    expect(http.fetch('https://api.test/second')).rejects.toThrow(
      'expected GET https://api.test/first but received GET https://api.test/second',
    )
    expect(await (await http.fetch('https://api.test/first')).text()).toBe('first')
    expect(await (await http.fetch('https://api.test/second')).text()).toBe('second')
  })

  test('uses Request constructor merge semantics for input and init', async () => {
    const http = createStrictHttpDispatcher(createScenarioEvents('request merge'))
    http.expect({ method: 'PUT', url: 'https://api.test/tasks/1' }, async (request) => {
      expect(request.headers.get('x-base')).toBe('replaced')
      expect(request.headers.get('x-init')).toBe('present')
      expect(await request.text()).toBe('new body')
      return new Response('ok')
    })
    const base = new Request('https://api.test/tasks/1', {
      method: 'POST',
      headers: { 'x-base': 'base' },
      body: 'old body',
    })

    await http.fetch(base, {
      method: 'put',
      headers: { 'x-base': 'replaced', 'x-init': 'present' },
      body: 'new body',
    })
  })

  test('records sanitized request metadata without reading the body', async () => {
    const events = createScenarioEvents('sanitized http')
    events.setPhase('call api')
    const http = createStrictHttpDispatcher(events)
    http.expect({ method: 'POST', url: 'https://api.test/tasks' }, async (request) => {
      expect(await request.text()).toBe('body-secret')
      return new Response('ok')
    })

    await http.fetch('https://api.test/tasks', {
      method: 'POST',
      headers: { authorization: 'Bearer hidden', accept: 'application/json' },
      body: 'body-secret',
    })

    const event = events.all().find((candidate) => candidate.kind === 'http.request')
    expect(event?.data).toEqual({
      method: 'POST',
      url: 'https://api.test/tasks',
      headers: { accept: 'application/json', authorization: '[REDACTED]' },
    })
    expect(JSON.stringify(event)).not.toContain('body-secret')
  })

  test('reports leftover expectations with scenario phase and recent events', () => {
    const events = createScenarioEvents('leftovers')
    events.setPhase('verify')
    const http = createStrictHttpDispatcher(events)
    http.expect({ method: 'GET', url: 'https://api.test/tasks' }, () => new Response('unused'))

    expect(() => http.verifyConsumed()).toThrow('leftovers')
    expect(() => http.verifyConsumed()).toThrow('phase: verify')
    expect(() => http.verifyConsumed()).toThrow('GET https://api.test/tasks')
  })

  test('wraps responder failures with scenario diagnostics and consumes the matched expectation', async () => {
    const events = createScenarioEvents('failed responder')
    events.setPhase('call tasks api')
    const http = createStrictHttpDispatcher(events)
    const cause = new Error('upstream unavailable')
    http.expect({ method: 'GET', url: 'https://api.test/tasks' }, () => Promise.reject(cause))

    const error = await captureError(http.fetch('https://api.test/tasks'))

    expect(error.message).not.toContain('upstream unavailable')
    expect(error.message).toContain('scenario: failed responder')
    expect(error.message).toContain('phase: call tasks api')
    expect(error.message).toContain('"kind": "http.request"')
    expect(error.cause).toBe(cause)
    expect(() => http.verifyConsumed()).not.toThrow()
  })

  test('rejects redirects by default and permits explicit redirect expectations', async () => {
    const http = createStrictHttpDispatcher(createScenarioEvents('redirects'))
    http.expect(
      { method: 'GET', url: 'https://api.test/default' },
      () => new Response(null, { status: 302, headers: { location: 'https://other.test/' } }),
    )
    http.expect(
      { method: 'GET', url: 'https://api.test/allowed', allowRedirect: true },
      () => new Response(null, { status: 307, headers: { location: 'https://other.test/' } }),
    )

    expect(http.fetch('https://api.test/default')).rejects.toThrow('redirect response rejected')
    const allowed = await http.fetch('https://api.test/allowed')
    expect(allowed.status).toBe(307)
    expect(allowed.headers.get('location')).toBe('https://other.test/')
  })

  test.each([301, 302, 303, 307, 308])('rejects fetch redirect status %i without a Location header', (status) => {
    const http = createStrictHttpDispatcher(createScenarioEvents(`redirect ${status}`))
    http.expect({ method: 'GET', url: 'https://api.test/redirect' }, () => new Response(null, { status }))

    return expect(http.fetch('https://api.test/redirect')).rejects.toThrow('redirect response rejected')
  })

  test('allows non-redirect 304 responses even with a Location header', async () => {
    const http = createStrictHttpDispatcher(createScenarioEvents('not modified'))
    http.expect(
      { method: 'GET', url: 'https://api.test/cache' },
      () => new Response(null, { status: 304, headers: { location: 'https://other.test/' } }),
    )

    const response = await http.fetch('https://api.test/cache')

    expect(response.status).toBe(304)
    expect(response.headers.get('location')).toBe('https://other.test/')
  })
})
