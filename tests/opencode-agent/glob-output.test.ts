// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  globOutputBase,
  globStaticRoot,
  isGlobOutputPath,
  resolveGlobOutput,
} from '../../opencode-agent/src/glob-output.js'
import type { GlobOutputResolution } from '../../opencode-agent/src/glob-output.js'

/** The refusal's sentence, or '' when the path was accepted. Module-level so the narrowing is not "in test". */
const reasonOf = (result: GlobOutputResolution): string => (result.ok ? '' : result.reason)

/**
 * The `specs` artifact of the `spec-driven` schema is the one whose
 * `resolvedOutputPath` is a **pattern** rather than a file:
 * `<changeDir>/specs/**\/*.md`, recorded from `openspec instructions specs
 * --change <name> --json` on the pinned `@fission-ai/openspec@1.8.0`. Writing to
 * it verbatim is what failed run 31664928683 with
 * `ENOENT ... openspec/changes/context-vault-plugin/specs/**\/*.md`.
 */
const SPECS_GLOB = '/repo/openspec/changes/add-thing/specs/**/*.md'
const CHANGE_DIR = '/repo/openspec/changes/add-thing'

describe('isGlobOutputPath', () => {
  it('tells the `specs` pattern apart from a concrete artifact path', () => {
    expect(isGlobOutputPath(SPECS_GLOB)).toBe(true)
    expect(isGlobOutputPath(`${CHANGE_DIR}/tasks.md`)).toBe(false)
    expect(isGlobOutputPath(`${CHANGE_DIR}/proposal.md`)).toBe(false)
  })

  it('treats every glob metacharacter as magic, not just `*`', () => {
    expect(isGlobOutputPath(`${CHANGE_DIR}/spec?.md`)).toBe(true)
    expect(isGlobOutputPath(`${CHANGE_DIR}/spec[12].md`)).toBe(true)
  })
})

describe('globStaticRoot', () => {
  it('stops at the first segment carrying a glob character', () => {
    expect(globStaticRoot(SPECS_GLOB)).toBe(`${CHANGE_DIR}/specs`)
  })

  it('is the containing directory when nothing is magic', () => {
    expect(globStaticRoot(`${CHANGE_DIR}/tasks.md`)).toBe(CHANGE_DIR)
  })
})

describe('globOutputBase', () => {
  it('is the change folder the driver reported, when it reported one', () => {
    expect(globOutputBase(SPECS_GLOB, CHANGE_DIR)).toBe(CHANGE_DIR)
  })

  it('falls back to the static root’s parent, so the pattern shown stays relative to the base', () => {
    // Without `changeDir` the base is derived, and the relative pattern the
    // drafter is shown is computed from whichever base was chosen — so the
    // fallback is the same rule with a different anchor, not a second contract.
    expect(globOutputBase(SPECS_GLOB, undefined)).toBe(CHANGE_DIR)
  })
})

describe('resolveGlobOutput', () => {
  it('accepts the per-capability path the artifact instruction asks for', () => {
    const result = resolveGlobOutput(SPECS_GLOB, CHANGE_DIR, 'specs/user-auth/spec.md')

    expect(result).toEqual({ ok: true, path: `${CHANGE_DIR}/specs/user-auth/spec.md` })
  })

  it('accepts a nested capability path (`identity/user-auth`)', () => {
    const result = resolveGlobOutput(SPECS_GLOB, CHANGE_DIR, 'specs/identity/user-auth/spec.md')

    expect(result).toEqual({ ok: true, path: `${CHANGE_DIR}/specs/identity/user-auth/spec.md` })
  })

  it('refuses a path that climbs out of the change folder', () => {
    const result = resolveGlobOutput(SPECS_GLOB, CHANGE_DIR, '../../../../etc/passwd')

    expect(result.ok).toBe(false)
    // The reason is the drafter's retry complaint, so it has to name the path.
    expect(reasonOf(result)).toContain('../../../../etc/passwd')
  })

  it('refuses an absolute path', () => {
    const result = resolveGlobOutput(SPECS_GLOB, CHANGE_DIR, '/etc/passwd')

    expect(result.ok).toBe(false)
  })

  it('refuses a path outside the pattern’s own directory', () => {
    // `design.md` is inside the change folder but is not a spec file; letting it
    // through would have the drafter overwrite another artifact.
    const result = resolveGlobOutput(SPECS_GLOB, CHANGE_DIR, 'design.md')

    expect(result.ok).toBe(false)
  })

  it('refuses a file the pattern’s extension does not admit', () => {
    const result = resolveGlobOutput(SPECS_GLOB, CHANGE_DIR, 'specs/user-auth/spec.txt')

    expect(result.ok).toBe(false)
    expect(reasonOf(result)).toContain('.md')
  })

  it('refuses an empty path rather than resolving it to the base directory', () => {
    const result = resolveGlobOutput(SPECS_GLOB, CHANGE_DIR, '   ')

    expect(result.ok).toBe(false)
  })
})
