// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { getResponse } from 'msw'
import type { HttpHandler } from 'msw'

import {
  codingCredentialsHandlers,
  forgeHandlers,
  forgeIncompleteHandlers,
  forgeSaveErrorHandlers,
  forgeSelfHostedHandlers,
} from '../../../../client/stories/msw/settings-handlers-coding.js'
import {
  codingMcpHandlers,
  codingMcpInternalAvailableHandlers,
  codingMcpInternalSelectedHandlers,
  codingMcpNoCatalogHandlers,
} from '../../../../client/stories/msw/settings-handlers-personal-2.js'

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

/**
 * Namespaces a handler set answers other than its own — must always be empty.
 *
 * Deliberately does NOT call answeredNamespaces and filter: the `loading` families delay
 * for NEVER_RESOLVE_MS on their own namespace, so probing it would stall the test for a
 * full minute. Only the foreign namespaces are requested, and each must fall through
 * immediately. A guard placed after the delay turns this into a test timeout.
 */
const foreignNamespaces = async (handlers: HttpHandler[], own: string): Promise<string[]> => {
  const answered: string[] = []
  for (const namespace of NAMESPACES.filter((ns) => ns !== own)) {
    const response = await getResponse(handlers, request(namespace))
    if (response !== undefined) answered.push(namespace)
  }
  return answered
}

const RESPONDING: { name: string; handlers: HttpHandler[]; own: string }[] = [
  { name: 'agent-provider populated', handlers: codingCredentialsHandlers.populated, own: 'agent-provider' },
  { name: 'agent-provider empty', handlers: codingCredentialsHandlers.empty, own: 'agent-provider' },
  { name: 'agent-provider error', handlers: codingCredentialsHandlers.error, own: 'agent-provider' },
  { name: 'mcp populated', handlers: codingMcpHandlers.populated, own: 'mcp' },
  { name: 'mcp empty', handlers: codingMcpHandlers.empty, own: 'mcp' },
  { name: 'mcp error', handlers: codingMcpHandlers.error, own: 'mcp' },
  { name: 'mcp no-catalog', handlers: codingMcpNoCatalogHandlers, own: 'mcp' },
  { name: 'mcp internal-available', handlers: codingMcpInternalAvailableHandlers, own: 'mcp' },
  { name: 'mcp internal-selected', handlers: codingMcpInternalSelectedHandlers, own: 'mcp' },
  { name: 'forge populated', handlers: forgeHandlers.populated, own: 'forge' },
  { name: 'forge empty', handlers: forgeHandlers.empty, own: 'forge' },
  { name: 'forge error', handlers: forgeHandlers.error, own: 'forge' },
  { name: 'forge incomplete', handlers: forgeIncompleteHandlers, own: 'forge' },
  { name: 'forge self-hosted', handlers: forgeSelfHostedHandlers, own: 'forge' },
]

// The `loading` families delay past any test timeout for their own namespace, so they are
// asserted negatively via foreignNamespaces, which never requests the own namespace.
const LOADING: { name: string; handlers: HttpHandler[]; own: string }[] = [
  { name: 'agent-provider loading', handlers: codingCredentialsHandlers.loading, own: 'agent-provider' },
  { name: 'mcp loading', handlers: codingMcpHandlers.loading, own: 'mcp' },
  { name: 'forge loading', handlers: forgeHandlers.loading, own: 'forge' },
]

test.each(RESPONDING)('$name answers only its own namespace', async ({ handlers, own }) => {
  expect(await answeredNamespaces(handlers)).toEqual([own])
})

test.each(LOADING)('$name falls through for foreign namespaces', async ({ handlers, own }) => {
  expect(await foreignNamespaces(handlers, own)).toEqual([])
})

test('forgeSaveErrorHandlers answers only the forge namespace on GET', async () => {
  expect(await getResponse(forgeSaveErrorHandlers, request('forge'))).toBeDefined()
  expect(await foreignNamespaces(forgeSaveErrorHandlers, 'forge')).toEqual([])
})
