// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHmac } from 'node:crypto'

import { PseudonymSchema } from '../controlled-types.js'
import type { Pseudonym } from '../controlled-types.js'

const TRUNCATED_BYTES = 24

type PseudonymInput = {
  key: Buffer | Uint8Array
  keyVersion: string
  domain: string
  components: readonly string[]
}

export function encodeComponents(domain: string, components: readonly string[]): Uint8Array {
  const encoder = new TextEncoder()
  const domainBytes = encoder.encode(domain)
  const componentBytes = components.map((value) => encoder.encode(value))
  const size = domainBytes.byteLength + 1 + componentBytes.reduce((total, part) => total + 4 + part.byteLength, 0)
  const output = new Uint8Array(size)
  const view = new DataView(output.buffer)
  output.set(domainBytes, 0)
  let offset = domainBytes.byteLength
  output[offset] = 0
  offset += 1
  for (const part of componentBytes) {
    view.setUint32(offset, part.byteLength, false)
    offset += 4
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

export function createPseudonym(input: PseudonymInput): Pseudonym {
  const encoded = encodeComponents(input.domain, input.components)
  const key = Buffer.isBuffer(input.key) ? input.key : Buffer.from(input.key)
  const digest = createHmac('sha256', key).update(Buffer.from(encoded)).digest()
  const truncated = digest.subarray(0, TRUNCATED_BYTES)
  const suffix = truncated.toString('base64url')
  return PseudonymSchema.parse(`${input.keyVersion}.${suffix}`)
}

export type VersionedKey = Readonly<{
  keyVersion: string
  key: Buffer | Uint8Array
}>

/**
 * Planned-rekey derivation: the target-generation pseudonym is the HMAC of the
 * source pseudonym under the target key version, so stored rows can be rekeyed
 * without ever retaining native identity. Deterministic, so copy, dual-write,
 * and verification all derive identical target keys without decrypting
 * mappings.
 */
export function deriveRekeyedPseudonym(input: {
  key: Buffer | Uint8Array
  keyVersion: string
  domain: string
  sourcePseudonym: string
}): Pseudonym {
  return createPseudonym({
    key: input.key,
    keyVersion: input.keyVersion,
    domain: input.domain,
    components: [input.sourcePseudonym],
  })
}

export type VersionedPseudonym = Readonly<{
  keyVersion: string
  pseudonym: Pseudonym
}>

export function derivePseudonymsAcrossVersions(
  keys: readonly VersionedKey[],
  domain: string,
  components: readonly string[],
): readonly VersionedPseudonym[] {
  return keys.map((entry) => ({
    keyVersion: entry.keyVersion,
    pseudonym: createPseudonym({ key: entry.key, keyVersion: entry.keyVersion, domain, components }),
  }))
}
