// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

interface Phase1FingerprintInput {
  readonly testKey: string
  readonly testFileHash: string
  readonly testSource: string
  readonly mirroredSourceHash: string | null
  readonly phaseVersion: string
}

interface Phase2FingerprintInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly phaseVersion: string
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function buildPhase1Fingerprint(input: Phase1FingerprintInput): string {
  return sha256Json(input)
}

export function buildPhase2Fingerprint(input: Phase2FingerprintInput): string {
  return sha256Json(input)
}

export function buildPhase2ConsolidationFingerprint(input: {
  readonly featureKey: string
  readonly sourceBehaviorIds: readonly string[]
  readonly behaviors: readonly string[]
  readonly phaseVersion: string
}): string {
  return sha256Json(input)
}

export function buildPhase3EvaluationFingerprint(input: {
  readonly consolidatedId: string
  readonly phase2Fingerprint: string | null
  readonly evaluation: {
    readonly maria: {
      readonly discover: number
      readonly use: number
      readonly retain: number
      readonly notes: string
    }
    readonly dani: {
      readonly discover: number
      readonly use: number
      readonly retain: number
      readonly notes: string
    }
    readonly viktor: {
      readonly discover: number
      readonly use: number
      readonly retain: number
      readonly notes: string
    }
    readonly flaws: readonly string[]
    readonly improvements: readonly string[]
  }
}): string {
  return sha256Json(input)
}
