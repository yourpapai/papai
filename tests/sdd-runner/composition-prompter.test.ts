// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { makePrompterFor, prompterKindOf } from '../../sdd-runner/src/composition-prompter.js'

describe('makePrompterFor (14.2)', () => {
  it('selects clack when interactive, unless SDD_NO_CLACK is set or the terminal is non-UTF8', () => {
    expect(prompterKindOf(makePrompterFor(true, {}))).toBe('clack')
    expect(prompterKindOf(makePrompterFor(true, { SDD_NO_CLACK: '1' }))).toBe('readline')
    expect(prompterKindOf(makePrompterFor(true, { LANG: 'C' }))).toBe('readline')
    expect(prompterKindOf(makePrompterFor(true, { LANG: 'en_US.UTF-8' }))).toBe('clack')
    expect(prompterKindOf(makePrompterFor(false, {}))).toBe('readline')
  })
})
