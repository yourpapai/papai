// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { desiredLabels } from '../../opencode-agent/src/labels.js'
import {
  NEEDS_YOU_LABEL,
  PRESENTATION,
  PRESENTATION_KEYS,
  presentationFor,
  presentationKey,
  WORKING_LABEL,
} from '../../opencode-agent/src/presentation.js'
import type { RunStance } from '../../opencode-agent/src/presentation.js'
import { initialState } from '../../opencode-agent/src/state-manager.js'
import { PHASES } from '../../opencode-agent/src/types.js'
import type { AgentState, Phase } from '../../opencode-agent/src/types.js'

const ISSUE = 42

const stateIn = (phase: Phase, patch: Partial<AgentState> = {}): AgentState => ({
  ...initialState(ISSUE),
  phase,
  ...patch,
})

const DELIVERED = stateIn('COMPLETE', { prUrl: 'https://example.test/pull/7', prNumber: 7 })
const CANCELLED = stateIn('COMPLETE')

const STANCES: readonly RunStance[] = ['working', 'waiting']

describe('the presentation table', () => {
  test.each([...PHASES])('%s resolves in both stances', (phase) => {
    // Totality is a compile-time property — `Record` over a closed union, and a
    // `presentationKey` whose fall-through only type-checks while every phase
    // has a row. This asserts it at run time too, because the fall-through is
    // the kind of line a refactor can widen to `string` without noticing.
    for (const stance of STANCES) {
      const presentation = presentationFor(stateIn(phase), stance)
      expect(presentation.label.suffix.length).toBeGreaterThan(0)
      expect(presentation.headline.length).toBeGreaterThan(0)
      expect(presentation.glyph.length).toBeGreaterThan(0)
    }
  })

  test('no two rows share a label', () => {
    // A shared label collapses two states into one on the surface whose entire
    // job is to tell them apart, and would make the reconcile's diff read a
    // phase move as "nothing changed".
    const suffixes = PRESENTATION_KEYS.map((key) => PRESENTATION[key].label.suffix)

    expect(new Set(suffixes).size).toBe(suffixes.length)
  })

  test('every label carries a six-digit hex colour, which is what GitHub takes', () => {
    const colors = [...PRESENTATION_KEYS.map((key) => PRESENTATION[key].label.color), WORKING_LABEL.color]

    for (const color of [...colors, NEEDS_YOU_LABEL.color]) expect(color).toMatch(/^[0-9a-f]{6}$/u)
  })

  test('INIT_OR_CLARIFY is two states, not one', () => {
    // The one phase that is both a working state and a waiting state: it is
    // where the agent sits after asking clarifying questions. Keying on the
    // phase alone would make "reading the issue" and "waiting on your answers"
    // the same row, which is the whole reason the key is a pair.
    const triaging = presentationFor(stateIn('INIT_OR_CLARIFY'), 'working')
    const clarifying = presentationFor(stateIn('INIT_OR_CLARIFY'), 'waiting')

    expect(triaging.label.suffix).toBe('triaging')
    expect(triaging.whoseTurn).toBe('agent')
    expect(clarifying.label.suffix).toBe('clarifying')
    expect(clarifying.whoseTurn).toBe('you')
  })

  test('COMPLETE splits on the pull request, exactly as the closing comment does', () => {
    // `renderClosing` already reads `prUrl` to decide between "Done" and
    // "Stopped". A label that said `done` for a cancelled issue would contradict
    // the comment sitting right above it.
    expect(presentationFor(DELIVERED, 'waiting').label.suffix).toBe('done')
    expect(presentationFor(CANCELLED, 'waiting').label.suffix).toBe('stopped')
  })

  test.each([...STANCES])('a finished issue is nobody’s turn, in either stance (%s)', (stance) => {
    expect(presentationFor(DELIVERED, stance).whoseTurn).toBe('nobody')
    expect(presentationFor(CANCELLED, stance).whoseTurn).toBe('nobody')
  })

  test('a failure is your turn — it waits for `/retry` or `/cancel`', () => {
    expect(presentationFor(stateIn('FAILED'), 'waiting').whoseTurn).toBe('you')
  })

  test('every key the table declares is reachable from some state', () => {
    // The other direction of totality: a row nothing resolves to is a row that
    // was renamed on one side only.
    const reached = new Set<string>()
    for (const phase of PHASES) for (const stance of STANCES) reached.add(presentationKey(stateIn(phase), stance))
    reached.add(presentationKey(DELIVERED, 'waiting'))

    expect([...reached].sort()).toEqual([...PRESENTATION_KEYS].sort())
  })
})

describe('desiredLabels', () => {
  const names = (state: AgentState, stance: RunStance, prefix = 'agent:'): string[] =>
    desiredLabels(state, stance, prefix).map((label) => label.name)

  test('a working run carries the phase label and the working marker', () => {
    expect(names(stateIn('REVIEW_AND_MUTATE'), 'working')).toEqual(['agent:implementing', 'agent:working'])
  })

  test('a run that has handed back carries the phase label and needs-you', () => {
    expect(names(stateIn('PLAN_REVIEW'), 'waiting')).toEqual(['agent:plan-review', 'agent:needs-you'])
  })

  test('the two markers are mutually exclusive', () => {
    // While the agent holds the issue it is not waiting on anybody, so a run in
    // flight must not also appear in the "blocked on me" filter it is clearing.
    expect(names(stateIn('DESIGN_SPEC'), 'working')).not.toContain('agent:needs-you')
    expect(names(stateIn('DESIGN_SPEC'), 'waiting')).not.toContain('agent:working')
  })

  test('a finished issue carries neither marker', () => {
    expect(names(DELIVERED, 'waiting')).toEqual(['agent:done'])
    expect(names(CANCELLED, 'waiting')).toEqual(['agent:stopped'])
  })

  test('a failure asks for you', () => {
    expect(names(stateIn('FAILED'), 'waiting')).toEqual(['agent:failed', 'agent:needs-you'])
  })

  test('the prefix reaches every name, markers included', () => {
    // The prefix is the whole of the namespacing story: a name that escapes it
    // is a label the reconcile will not recognise as its own, so it is added
    // once and then never cleaned up.
    for (const name of names(stateIn('FAILED'), 'waiting', 'bot/')) expect(name.startsWith('bot/')).toBe(true)
  })
})
