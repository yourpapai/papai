// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AGENT_PROVIDER_FIELDS,
  CODING_NAMESPACES,
  FIELDS_BY_NAMESPACE,
  REQUIRED_AGENT_PROVIDER_FIELDS,
  REQUIRED_BY_NAMESPACE,
} from '../../src/coding-credentials/types.js'

describe('coding-credentials types', () => {
  test('CODING_NAMESPACES contains agent-provider', () => {
    expect(CODING_NAMESPACES).toContain('agent-provider')
  })

  test('AGENT_PROVIDER_FIELDS contains provider_api_key and provider_base_url', () => {
    expect(AGENT_PROVIDER_FIELDS).toContain('provider_api_key')
    expect(AGENT_PROVIDER_FIELDS).toContain('provider_base_url')
  })

  test('REQUIRED_AGENT_PROVIDER_FIELDS contains only provider_api_key', () => {
    expect(REQUIRED_AGENT_PROVIDER_FIELDS).toEqual(['provider_api_key'])
  })

  test('FIELDS_BY_NAMESPACE maps agent-provider to all fields', () => {
    expect(FIELDS_BY_NAMESPACE['agent-provider']).toEqual(AGENT_PROVIDER_FIELDS)
  })

  test('REQUIRED_BY_NAMESPACE maps agent-provider to required fields', () => {
    expect(REQUIRED_BY_NAMESPACE['agent-provider']).toEqual(REQUIRED_AGENT_PROVIDER_FIELDS)
  })
})
