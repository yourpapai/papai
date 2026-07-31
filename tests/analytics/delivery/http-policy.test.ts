// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  approveSinkEndpoint,
  assertEndpointMatches,
  buildSinkAuthHeaders,
  EndpointPolicyError,
  isPublicAddress,
} from '../../../src/analytics/delivery/http-policy.js'
import type {
  ApprovedEndpoint,
  EndpointPolicyReason,
  LookupAll,
  ResolvedAddress,
} from '../../../src/analytics/delivery/http-policy.js'
import { mockLogger } from '../../utils/test-helpers.js'

const PUBLIC_A = { address: '203.0.113.10', family: 4 as const }
const PUBLIC_B = { address: '203.0.113.20', family: 4 as const }
const ENDPOINT = 'https://sink.example.com/ingest?source=papai'

const lookupOf =
  (answers: readonly ResolvedAddress[]): LookupAll =>
  () =>
    Promise.resolve(answers)

const approve = (lookup: LookupAll): Promise<ApprovedEndpoint> => approveSinkEndpoint(ENDPOINT, { lookupAll: lookup })

// Narrowing helper at module scope — no-conditional-in-test forbids ifs in test bodies.
const expectPolicyError = async (promise: Promise<unknown>, reason: EndpointPolicyReason): Promise<void> => {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(EndpointPolicyError)
  if (!(error instanceof EndpointPolicyError)) throw new Error('expected an EndpointPolicyError')
  expect(error.reason).toBe(reason)
}

describe('public address classification', () => {
  test('rejects loopback, RFC1918, link-local, multicast, and unspecified IPv4', () => {
    for (const address of [
      '127.0.0.1',
      '127.55.66.77',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.0.1',
      '224.0.0.1',
      '239.255.255.255',
      '0.0.0.0',
      '255.255.255.255',
      '100.64.0.1',
    ]) {
      expect(isPublicAddress(address)).toBe(false)
    }
  })

  test('rejects IPv6 loopback, ULA, link-local, multicast, unspecified, and mapped non-public IPv4', () => {
    for (const address of [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fe80::abcd:ef01',
      'ff02::1',
      'ff00::1',
      '::ffff:10.0.0.1',
      '::ffff:127.0.0.1',
      '::ffff:192.168.1.1',
      '::ffff:169.254.0.1',
    ]) {
      expect(isPublicAddress(address)).toBe(false)
    }
  })

  test('accepts ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '203.0.113.10', '172.15.0.1', '192.167.0.1', '2606:4700:4700::1111']) {
      expect(isPublicAddress(address)).toBe(true)
    }
  })
})

describe('endpoint approval from the operator-owned sink record', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('requires HTTPS and a parseable URL without embedded credentials', async () => {
    await expectPolicyError(approveSinkEndpoint('http://sink.example.com/x', {}), 'not_https')
    await expectPolicyError(approveSinkEndpoint('not a url', {}), 'invalid_url')
    await expectPolicyError(approveSinkEndpoint('https://user:pw@sink.example.com/x', {}), 'embedded_credentials')
  })

  test('rejects a hostname whose answers include any non-public address', async () => {
    await expectPolicyError(approve(lookupOf([PUBLIC_A, { address: '10.0.0.1', family: 4 }])), 'non_public_address')
    await expectPolicyError(approve(lookupOf([{ address: '192.168.0.1', family: 4 }])), 'non_public_address')
    await expectPolicyError(approve(lookupOf([{ address: '::1', family: 6 }])), 'non_public_address')
    await expectPolicyError(approve(lookupOf([])), 'no_addresses')
  })

  test('rejects IP-literal endpoints that are not public', async () => {
    await expectPolicyError(approveSinkEndpoint('https://127.0.0.1/x', {}), 'non_public_address')
    await expectPolicyError(approveSinkEndpoint('https://[::1]/x', {}), 'non_public_address')
    await expectPolicyError(approveSinkEndpoint('https://[fe80::1]/x', {}), 'non_public_address')
  })

  test('approves a public HTTPS endpoint and pins one validated address', async () => {
    const approved = await approve(lookupOf([PUBLIC_B, PUBLIC_A]))
    expect(approved.url).toBe(ENDPOINT)
    expect(approved.hostname).toBe('sink.example.com')
    expect(approved.port).toBe(443)
    expect(approved.path).toBe('/ingest?source=papai')
    expect([PUBLIC_A.address, PUBLIC_B.address]).toContain(approved.pinnedAddress.address)
  })

  test('a DNS failure is a controlled policy error', async () => {
    await expectPolicyError(
      approveSinkEndpoint(ENDPOINT, { lookupAll: () => Promise.reject(new Error('ENOTFOUND')) }),
      'dns_resolution_failed',
    )
  })

  test('assertEndpointMatches refuses any URL other than the approved record', async () => {
    const approved = await approve(lookupOf([PUBLIC_A]))
    expect(() => assertEndpointMatches(approved, ENDPOINT)).not.toThrow()
    expect(() => assertEndpointMatches(approved, 'https://other.example.com/ingest?source=papai')).toThrow(
      EndpointPolicyError,
    )
    expect(() => assertEndpointMatches(approved, 'https://sink.example.com/other')).toThrow(EndpointPolicyError)
  })
})

describe('sink token handling', () => {
  test('the decrypted token reaches only the authorization header builder', () => {
    expect(buildSinkAuthHeaders('super-secret')).toEqual({ authorization: 'Bearer super-secret' })
  })
})
