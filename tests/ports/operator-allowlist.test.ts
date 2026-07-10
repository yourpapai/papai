// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createOperatorAllowlistPort, operatorAllowlistPort } from '../../src/ports/operator-allowlist.js'

describe('OperatorAllowlistPort', () => {
  test('defaults to "members" when no resolver is registered', () => {
    const port = createOperatorAllowlistPort()
    expect(port.resolve('pi-1')).toBe('members')
  })

  test('resolves via the registered resolver', () => {
    const port = createOperatorAllowlistPort()
    port.register((platformInstanceId) => [platformInstanceId])
    expect(port.resolve('pi-1')).toEqual(['pi-1'])
    expect(port.resolve('pi-2')).toEqual(['pi-2'])
  })

  test('last registration wins', () => {
    const port = createOperatorAllowlistPort()
    port.register(() => ['a'])
    port.register(() => ['b'])
    expect(port.resolve('x')).toEqual(['b'])
  })

  test('exposes a shared singleton', () => {
    expect(typeof operatorAllowlistPort.resolve).toBe('function')
  })
})
