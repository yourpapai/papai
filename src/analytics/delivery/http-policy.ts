// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { lookup } from 'node:dns/promises'

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:delivery:http-policy' })

export type IpFamily = 4 | 6
export type ResolvedAddress = Readonly<{ address: string; family: IpFamily }>
export type LookupAll = (hostname: string) => Promise<readonly ResolvedAddress[]>

export const defaultLookupAll: LookupAll = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true })
  return answers.map((answer) => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }))
}

export type EndpointPolicyReason =
  | 'invalid_url'
  | 'not_https'
  | 'embedded_credentials'
  | 'dns_resolution_failed'
  | 'no_addresses'
  | 'non_public_address'
  | 'endpoint_mismatch'

export class EndpointPolicyError extends Error {
  readonly reason: EndpointPolicyReason

  constructor(reason: EndpointPolicyReason, message: string) {
    super(message)
    this.name = 'EndpointPolicyError'
    this.reason = reason
  }
}

const parseIpv4 = (address: string): readonly number[] | null => {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  if (parts.some((part) => !/^\d{1,3}$/u.test(part))) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => octet > 255)) return null
  return octets
}

const isPublicIpv4 = (octets: readonly number[]): boolean => {
  const a = octets[0] ?? 0
  const b = octets[1] ?? 0
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a >= 224) return false
  return true
}

const expandIpv6 = (address: string): readonly number[] | null => {
  let input = address.toLowerCase()
  const v4Match = /(\d+\.\d+\.\d+\.\d+)$/u.exec(input)
  if (v4Match !== null) {
    const octets = parseIpv4(v4Match[1] ?? '')
    if (octets === null) return null
    const hi = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0)
    const lo = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
    input = `${input.slice(0, input.length - (v4Match[1] ?? '').length)}${hi.toString(16)}:${lo.toString(16)}`
  }
  const halves = input.split('::')
  if (halves.length > 2) return null
  const parseGroup = (group: string): number[] | null => {
    if (group === '') return []
    const parts = group.split(':')
    const out: number[] = []
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/u.test(part)) return null
      out.push(Number.parseInt(part, 16))
    }
    return out
  }
  const head = parseGroup(halves[0] ?? '')
  const tail = halves.length === 2 ? parseGroup(halves[1] ?? '') : []
  if (head === null || tail === null) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail]
}

const isPublicIpv6 = (address: string): boolean => {
  const hextets = expandIpv6(address)
  if (hextets === null) return false
  const h0 = hextets[0] ?? 0
  if (hextets.every((hextet) => hextet === 0)) return false
  if (hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1) return false
  if ((h0 & 0xfe00) === 0xfc00) return false
  if ((h0 & 0xffc0) === 0xfe80) return false
  if ((h0 & 0xff00) === 0xff00) return false
  const isMapped = hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff
  if (isMapped) {
    return isPublicIpv4([
      (hextets[6] ?? 0) >> 8,
      (hextets[6] ?? 0) & 0xff,
      (hextets[7] ?? 0) >> 8,
      (hextets[7] ?? 0) & 0xff,
    ])
  }
  return true
}

export const isPublicAddress = (address: string): boolean => {
  const octets = parseIpv4(address)
  if (octets !== null) return isPublicIpv4(octets)
  if (address.includes(':')) return isPublicIpv6(address)
  return false
}

export type ApprovedEndpoint = Readonly<{
  url: string
  hostname: string
  port: number
  path: string
  pinnedAddress: ResolvedAddress
}>

export type HttpPolicyDeps = Readonly<{ lookupAll?: LookupAll }>

const stripIpv6Brackets = (hostname: string): string =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

const isIpLiteral = (hostname: string): boolean => parseIpv4(hostname) !== null || hostname.includes(':')

const selectPinnedAddress = (answers: readonly ResolvedAddress[]): ResolvedAddress => {
  const sorted = [...answers].sort((a, b) => a.family - b.family || a.address.localeCompare(b.address))
  const first = sorted[0]
  if (first === undefined) throw new EndpointPolicyError('no_addresses', 'endpoint resolved to no addresses')
  return first
}

export const approveSinkEndpoint = async (endpoint: string, deps: HttpPolicyDeps = {}): Promise<ApprovedEndpoint> => {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new EndpointPolicyError('invalid_url', 'sink endpoint is not a valid URL')
  }
  if (url.protocol !== 'https:') throw new EndpointPolicyError('not_https', 'sink endpoint must use HTTPS')
  if (url.username !== '' || url.password !== '') {
    throw new EndpointPolicyError('embedded_credentials', 'sink endpoint must not embed credentials')
  }
  const hostname = stripIpv6Brackets(url.hostname)
  let answers: readonly ResolvedAddress[]
  if (isIpLiteral(hostname)) {
    answers = [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }]
  } else {
    const lookupAll = deps.lookupAll ?? defaultLookupAll
    try {
      answers = await lookupAll(hostname)
    } catch (error) {
      throw new EndpointPolicyError(
        'dns_resolution_failed',
        `sink endpoint DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (answers.length === 0) throw new EndpointPolicyError('no_addresses', 'endpoint resolved to no addresses')
  if (answers.some((answer) => !isPublicAddress(answer.address))) {
    log.warn({ hostname }, 'sink endpoint rejected: non-public DNS answer')
    throw new EndpointPolicyError('non_public_address', 'endpoint resolved to a non-public address')
  }
  const pinnedAddress = selectPinnedAddress(answers)
  return {
    url: endpoint,
    hostname,
    port: url.port === '' ? 443 : Number(url.port),
    path: `${url.pathname}${url.search}`,
    pinnedAddress,
  }
}

export const assertEndpointMatches = (approved: ApprovedEndpoint, endpoint: string): void => {
  if (approved.url !== endpoint) {
    log.warn('egress refused: request URL does not match the approved sink record')
    throw new EndpointPolicyError('endpoint_mismatch', 'request URL does not match the approved sink endpoint')
  }
}

export const buildSinkAuthHeaders = (secret: string): Record<string, string> => ({
  authorization: `Bearer ${secret}`,
})
