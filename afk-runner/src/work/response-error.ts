// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The response-error sibling artifact (D3): parse-inert operator feedback
 * beside the gate file — nothing reads it as gate input. Carries the failed
 * gate-file digest so a resumed waiter seeds its digest guard and an
 * unchanged poisoned file never re-attempts.
 */
export function responseErrorPath(runDir: string, version: number): string {
  return path.join(runDir, `gate-${version}.response-error.md`)
}

export function writeResponseError(runDir: string, version: number, reason: string, digest: string): void {
  writeFileSync(responseErrorPath(runDir, version), responseErrorBody(version, '', reason, digest))
}

/**
 * The steer variant (D2): one artifact surface, heading marked `(steer)` —
 * parse-inert by construction, same as the file path's. Written
 * unconditionally (a steer often lands before any stable gate-file read),
 * with the reason embedding the consumed directive.
 */
export function writeSteerResponseError(runDir: string, version: number, reason: string, digest: string): void {
  writeFileSync(responseErrorPath(runDir, version), responseErrorBody(version, ' (steer)', reason, digest))
}

function responseErrorBody(version: number, headingMarker: string, reason: string, digest: string): string {
  return `<!-- gate-${version}.response-error.md -->\n\n# Gate ${version} response error${headingMarker} — the gate is NOT settled\n\n${reason}\n\n<!-- failed-digest: ${digest} -->\n`
}

export function readFailedDigest(runDir: string, version: number): string | null {
  try {
    return /failed-digest: ([0-9a-f]{64})/u.exec(readFileSync(responseErrorPath(runDir, version), 'utf8'))?.[1] ?? null
  } catch {
    return null
  }
}

export function clearResponseError(runDir: string, version: number): void {
  try {
    unlinkSync(responseErrorPath(runDir, version))
  } catch {
    /* no stale artifact */
  }
}
