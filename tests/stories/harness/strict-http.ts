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

type Responder = (request: Request) => Response | Promise<Response>

export type StrictHttpDispatcher = Readonly<{
  expect(request: StrictHttpExpectation, respond: Responder): void
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  verifyConsumed(): void
}>

type PendingExpectation = Readonly<{
  request: Readonly<{ method: string; url: string; allowRedirect: boolean }>
  respond: Responder
}>

const normalizeUrl = (url: string): string => new URL(url).toString()
const normalizeMethod = (method: string): string => method.toUpperCase()
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

  return {
    expect(request, respond): void {
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
    async fetch(input, init): Promise<Response> {
      const request = new Request(input, init)
      const actual = { method: normalizeMethod(request.method), url: normalizeUrl(request.url) }
      events.record('http.request', {
        ...actual,
        headers: Object.fromEntries(request.headers.entries()),
      })

      const pending = expectations[consumed]
      if (pending === undefined) {
        throw new Error(events.formatFailure(`undeclared request: ${describe(actual)}`))
      }
      if (pending.request.method !== actual.method || pending.request.url !== actual.url) {
        throw new Error(events.formatFailure(`expected ${describe(pending.request)} but received ${describe(actual)}`))
      }

      consumed += 1
      const response = await runResponder(pending, request, events, actual)
      const isRedirect = REDIRECT_STATUSES.has(response.status)
      if (isRedirect && !pending.request.allowRedirect) {
        throw new Error(
          events.formatFailure(
            `redirect response rejected for ${describe(actual)}; set allowRedirect to true to permit it`,
          ),
        )
      }
      events.record('http.response', { method: actual.method, url: actual.url, status: response.status })
      return response
    },
    verifyConsumed(): void {
      const remaining = expectations.slice(consumed)
      if (remaining.length === 0) return
      const descriptions = remaining.map(({ request }) => describe(request)).join(', ')
      throw new Error(events.formatFailure(`unconsumed HTTP expectations: ${descriptions}`))
    },
  }
}
