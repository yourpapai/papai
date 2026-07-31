// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { getResponse } from 'msw'
import type { HttpHandler } from 'msw'

import { codingCredentialsHandlers } from '../../../../client/stories/msw/settings-handlers-coding.js'

const NAMESPACES = ['agent-provider', 'forge', 'mcp'] as const

const request = (namespace: string): Request =>
  new Request(`http://localhost/settings/api/coding-credentials?contextId=ctx-personal-1&namespace=${namespace}`)

/** Which of the three namespaces this handler set produces a response for. */
const answeredNamespaces = async (handlers: HttpHandler[]): Promise<string[]> => {
  const answered: string[] = []
  for (const namespace of NAMESPACES) {
    const response = await getResponse(handlers, request(namespace))
    if (response !== undefined) answered.push(namespace)
  }
  return answered
}

/** Namespaces a handler set answers, excluding its own — must always be empty. */
const foreignNamespaces = async (handlers: HttpHandler[], own: string): Promise<string[]> =>
  (await answeredNamespaces(handlers)).filter((ns) => ns !== own)

const RESPONDING: { name: string; handlers: HttpHandler[]; own: string }[] = [
  { name: 'agent-provider populated', handlers: codingCredentialsHandlers.populated, own: 'agent-provider' },
  { name: 'agent-provider empty', handlers: codingCredentialsHandlers.empty, own: 'agent-provider' },
  { name: 'agent-provider error', handlers: codingCredentialsHandlers.error, own: 'agent-provider' },
]

// The `loading` families delay past any test timeout for their own namespace, so they are
// asserted negatively: they must fall through for the other two namespaces. A guard placed
// after the `delay()` would hang here instead of falling through, which fails as a timeout.
const LOADING: { name: string; handlers: HttpHandler[]; own: string }[] = [
  { name: 'agent-provider loading', handlers: codingCredentialsHandlers.loading, own: 'agent-provider' },
]

test.each(RESPONDING)('$name answers only its own namespace', async ({ handlers, own }) => {
  expect(await answeredNamespaces(handlers)).toEqual([own])
})

test.each(LOADING)('$name falls through for foreign namespaces', async ({ handlers, own }) => {
  expect(await foreignNamespaces(handlers, own)).toEqual([])
})
