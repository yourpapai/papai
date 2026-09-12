// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ScenarioEvents } from './events.js'

export type StrictHttpExpectation = Readonly<{
  method: string
  url: string
  allowRedirect?: boolean
}>

export type StrictHttpHostOptions = Readonly<{
  allowZeroRequests?: boolean
  allowRedirect?: boolean
}>

type Responder = (request: Request) => Response | Promise<Response>

type HostSimulator = Readonly<{
  respond: Responder
  allowZeroRequests: boolean
  allowRedirect: boolean
}>

export type StrictHttpDispatcher = Readonly<{
  expect(request: StrictHttpExpectation, respond: Responder): void
  serveHost(host: string, respond: Responder, options?: StrictHttpHostOptions): void
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  verifyConsumed(): void
  idle(): Promise<void>
}>

type PendingExpectation = Readonly<{
  request: Readonly<{ method: string; url: string; allowRedirect: boolean }>
  respond: Responder
}>

const normalizeUrl = (url: string): string => new URL(url).toString()
const normalizeMethod = (method: string): string => method.toUpperCase()
const normalizeHost = (host: string): string => host.toLowerCase()
const hostOf = (url: string): string => normalizeHost(new URL(url).hostname)
const describe = (request: Readonly<{ method: string; url: string }>): string => `${request.method} ${request.url}`
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const runResponder = async (
  expectation: PendingExpectation,
  request: Request,
  events: ScenarioEvents,
  actual: Readonly<{ method: string; url: string }>,
): Promise<Response> => {
  try {
    return await expectation.respond(request)
  } catch (error) {
    const message = events.formatFailure(`HTTP responder failed for ${describe(actual)}`)
    throw error instanceof Error ? new Error(message, { cause: error }) : new Error(message)
  }
}

export function createStrictHttpDispatcher(events: ScenarioEvents): StrictHttpDispatcher {
  let expectations: readonly PendingExpectation[] = []
  let consumed = 0
  const inFlight: Set<Promise<unknown>> = new Set()
  const hosts: Map<string, HostSimulator> = new Map()
  const hostRequestCounts: Map<string, number> = new Map()

  const dispatch = async (
    expectation: PendingExpectation,
    request: Request,
    actual: Readonly<{ method: string; url: string }>,
  ): Promise<Response> => {
    const responderPromise = runResponder(expectation, request, events, actual)
    inFlight.add(responderPromise)
    void responderPromise
      .finally(() => {
        inFlight.delete(responderPromise)
      })
      .catch(() => {
        // Rejection is surfaced to the caller via the `await responderPromise` below;
        // this branch only exists so the untracked `.finally()` chain doesn't register
        // as an unhandled rejection independently of that await.
      })
    const response = await responderPromise
    const isRedirect = REDIRECT_STATUSES.has(response.status)
    if (isRedirect && !expectation.request.allowRedirect) {
      throw new Error(
        events.formatFailure(
          `redirect response rejected for ${describe(actual)}; set allowRedirect to true to permit it`,
        ),
      )
    }
    events.record('http.response', { method: actual.method, url: actual.url, status: response.status })
    return response
  }

  return {
    expect(request, respond): void {
      const host = hostOf(normalizeUrl(request.url))
      if (hosts.has(host)) {
        throw new Error(events.formatFailure(`${host} is served by a host simulator; remove the expect() call`))
      }
      expectations = [
        ...expectations,
        {
          request: {
            method: normalizeMethod(request.method),
            url: normalizeUrl(request.url),
            allowRedirect: request.allowRedirect ?? false,
          },
          respond,
        },
      ]
    },
    serveHost(host, respond, options): void {
      const normalized = normalizeHost(host)
      if (hosts.has(normalized)) {
        throw new Error(events.formatFailure(`${normalized} is already served by a host simulator`))
      }
      const collision = expectations.some(({ request }) => hostOf(request.url) === normalized)
      if (collision) {
        throw new Error(
          events.formatFailure(`${normalized} already has declared expectations; remove them or drop serveHost`),
        )
      }
      hosts.set(normalized, {
        respond,
        allowZeroRequests: options?.allowZeroRequests ?? false,
        allowRedirect: options?.allowRedirect ?? false,
      })
    },
    async fetch(input, init): Promise<Response> {
      const request = new Request(input, init)
      const actual = { method: normalizeMethod(request.method), url: normalizeUrl(request.url) }
      events.record('http.request', {
        ...actual,
        headers: Object.fromEntries(request.headers.entries()),
      })

      const actualHost = hostOf(actual.url)
      const simulator = hosts.get(actualHost)
      if (simulator !== undefined) {
        hostRequestCounts.set(actualHost, (hostRequestCounts.get(actualHost) ?? 0) + 1)
        const hostExpectation: PendingExpectation = {
          request: { ...actual, allowRedirect: simulator.allowRedirect },
          respond: simulator.respond,
        }
        const hostResponse = await dispatch(hostExpectation, request, actual)
        return hostResponse
      }

      const pending = expectations[consumed]
      if (pending === undefined) {
        throw new Error(events.formatFailure(`undeclared request: ${describe(actual)}`))
      }
      if (pending.request.method !== actual.method || pending.request.url !== actual.url) {
        throw new Error(events.formatFailure(`expected ${describe(pending.request)} but received ${describe(actual)}`))
      }

      consumed += 1
      const response = await dispatch(pending, request, actual)
      return response
    },
    verifyConsumed(): void {
      const problems: string[] = []
      const remaining = expectations.slice(consumed)
      if (remaining.length > 0) {
        problems.push(`unconsumed HTTP expectations: ${remaining.map(({ request }) => describe(request)).join(', ')}`)
      }
      for (const [host, simulator] of hosts) {
        if (simulator.allowZeroRequests) continue
        if ((hostRequestCounts.get(host) ?? 0) === 0) {
          problems.push(`host simulator received no requests: ${host}`)
        }
      }
      if (problems.length === 0) return
      throw new Error(events.formatFailure(problems.join('; ')))
    },
    async idle(): Promise<void> {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight])
      }
    },
  }
}
