// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import { resolveOpenSpecMode, STAND_DOWN_REASON } from '../../opencode-agent/src/config-discovery.js'

/**
 * The `openspec/` root probe — design D10.
 *
 * The agent runs in repos other than papai. At job start it asks whether the
 * checkout carries an `openspec/` tree, the same testable ladder shape the
 * `review-loop/` probe already uses: an injected `exists` callback keeps the
 * ladder testable without a filesystem. Present → the compliant pipeline runs;
 * absent → the agent posts one clear comment and stands down (fail-closed). It
 * never scaffolds OpenSpec into a foreign repo.
 */
describe('resolveOpenSpecMode', () => {
  it('reports compliant when the checkout has an openspec/ tree', () => {
    const exists = (target: string): boolean => target === path.join('/repo', 'openspec')
    expect(resolveOpenSpecMode('/repo', exists)).toEqual({ mode: 'compliant' })
  })

  it('reports stand-down when no openspec/ tree is present', () => {
    expect(resolveOpenSpecMode('/repo', () => false).mode).toBe('stand-down')
  })

  it('the stand-down reason is the non-empty comment the door posts', () => {
    expect(STAND_DOWN_REASON.length).toBeGreaterThan(0)
    expect(resolveOpenSpecMode('/repo', () => false).mode).toBe('stand-down')
  })

  it('checks the openspec directory at the repo root, not a nested path', () => {
    const seen: string[] = []
    const exists = (target: string): boolean => {
      seen.push(target)
      return false
    }
    resolveOpenSpecMode('/repo', exists)
    expect(seen).toEqual([path.join('/repo', 'openspec')])
  })

  it('does not treat a nested openspec/ (e.g. under src/) as present', () => {
    // A foreign repo that happens to ship an `openspec` module under `src/`
    // must not trick the probe into compliant mode.
    const exists = (target: string): boolean => target === path.join('/repo', 'src', 'openspec')
    expect(resolveOpenSpecMode('/repo', exists).mode).toBe('stand-down')
  })
})
