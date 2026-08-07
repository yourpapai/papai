// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatFailures } from '../../opencode-agent/src/check-loop.js'
import { acceptedCommands, SLASH_COMMANDS } from '../../opencode-agent/src/commands.js'
import { modelResponseError } from '../../opencode-agent/src/errors.js'
import { fence } from '../../opencode-agent/src/markdown.js'
import { presentationFor } from '../../opencode-agent/src/presentation.js'
import { renderFailure, renderSettled } from '../../opencode-agent/src/run-report.js'
import { initialState, transition } from '../../opencode-agent/src/state-manager.js'
import type { AgentState, Phase } from '../../opencode-agent/src/types.js'

/**
 * Everything this pipeline fences is written by something else — a model reply,
 * a check's stdout, a review-loop summary — and all three routinely contain
 * fences. A fixed ``` lets the first inner one close the block early, at which
 * point the trailing prose renders as code and vice versa.
 */

interface Span {
  text: string
  inCode: boolean
}

/**
 * Splits a document into code and prose spans the way CommonMark does: a fence
 * of N backticks is closed only by a run of at least N with no info string.
 * Deliberately a real model rather than a backtick count — counting says the
 * broken rendering is fine, because its fences balance while pairing wrongly.
 */
const spans = (document: string): { rows: Span[]; unclosed: boolean } => {
  let open: number | null = null
  const rows: Span[] = []

  for (const line of document.split('\n')) {
    const match = /^(`{3,})(.*)$/u.exec(line)
    const ticks = match === null ? 0 : (match[1] ?? '').length
    const info = match === null ? '' : (match[2] ?? '').trim()

    if (open === null) {
      rows.push({ text: line, inCode: false })
      if (match !== null) open = ticks
      continue
    }
    if (match !== null && ticks >= open && info === '') {
      rows.push({ text: line, inCode: false })
      open = null
      continue
    }
    rows.push({ text: line, inCode: true })
  }

  return { rows, unclosed: open !== null }
}

const prose = (document: string): string =>
  spans(document)
    .rows.filter((row) => !row.inCode)
    .map((row) => row.text)
    .join('\n')

const code = (document: string): string =>
  spans(document)
    .rows.filter((row) => row.inCode)
    .map((row) => row.text)
    .join('\n')

const FENCED_REPLY = 'Sure! Here is the spec:\n\n```json\n{"status":"spec"}\n```\n\nHope that helps.'

describe('fence', () => {
  test('leaves ordinary content in a plain fence', () => {
    expect(fence('hello')).toBe('```\nhello\n```')
  })

  test('outgrows any fence the content carries', () => {
    expect(fence('a\n```\nb')).toBe('````\na\n```\nb\n````')
    expect(fence('a\n`````\nb')).toBe('``````\na\n`````\nb\n``````')
  })

  test('keeps the content whole, whatever it contains', () => {
    expect(code(fence(FENCED_REPLY))).toContain('Hope that helps.')
    expect(spans(fence(FENCED_REPLY)).unclosed).toBe(false)
  })

  test('accepts an info string', () => {
    expect(fence('x', 'json').startsWith('```json\n')).toBe(true)
  })

  test('an inline backtick run does not inflate the fence needlessly', () => {
    expect(fence('use `--flag` here')).toBe('```\nuse `--flag` here\n```')
  })
})

describe('renderFailure', () => {
  const failed = transition(initialState(1), 'FAILED', { lastError: 'x' })

  const render = (message: string): string => renderFailure('INIT_OR_CLARIFY', message, failed, 3, null)

  test('keeps the recovery instruction readable when the error carries a fence', () => {
    // This is the line the maintainer has to act on; a broken fence buries it
    // inside a code block, which is precisely where it is useless.
    const rendered = render(modelResponseError('no JSON object', FENCED_REPLY).message)

    expect(prose(rendered)).toContain('/retry')
    expect(prose(rendered)).toContain('### Run failed in INIT_OR_CLARIFY')
  })

  test('keeps the whole error inside the block', () => {
    const rendered = render(modelResponseError('no JSON object', FENCED_REPLY).message)

    expect(code(rendered)).toContain('Hope that helps.')
    expect(code(rendered)).toContain('{"status":"spec"}')
  })

  test('always reports the attempt against the budget', () => {
    // The count is always at least one, so the branch that read "attempt 0"
    // could never render and is gone.
    expect(render('boom')).toContain('Attempt 1 of 3')
  })

  test('leaves no unclosed fence', () => {
    expect(spans(render(modelResponseError('no JSON', FENCED_REPLY).message)).unclosed).toBe(false)
  })
})

describe('renderSettled', () => {
  const parked = (phase: Phase): AgentState => ({ ...initialState(42), phase })

  /** Every phase the cascade can actually stop at without a handler. */
  const WAITING: readonly Phase[] = ['DESIGN_SPEC', 'PLAN_REVIEW', 'FAILED']

  test.each([...WAITING])('%s names exactly the commands the transition table accepts', (phase) => {
    // The gap this closes: the comment used to be `### Waiting` over "Parked in
    // `PLAN_REVIEW`." and nothing else, while every other waiting comment in
    // the file carries a "what now". Derived from `acceptedCommands`, not
    // written out here, so the assertion cannot drift from the machine either.
    const rendered = renderSettled(parked(phase))
    const accepted = acceptedCommands(phase)

    for (const command of accepted) expect(rendered).toContain(`\`${command}\``)
    for (const command of SLASH_COMMANDS.filter((name) => !accepted.includes(name))) {
      expect(rendered).not.toContain(`\`${command}\``)
    }
  })

  test.each([...WAITING])('%s leads with the headline the presentation table gives it', (phase) => {
    // `PLAN_REVIEW` means nothing to a maintainer who has not read the state
    // machine, which is why the phase name is no longer the whole comment.
    const { glyph, headline } = presentationFor(parked(phase), 'waiting')

    expect(renderSettled(parked(phase)).startsWith(`### ${glyph} ${headline}`)).toBe(true)
  })

  test('still says which phase it is parked in', () => {
    // The name is what a maintainer quotes into an issue when asking about it,
    // and what the hidden state block says a line below.
    expect(renderSettled(parked('PLAN_REVIEW'))).toContain('`PLAN_REVIEW`')
  })

  test('a finished issue keeps the closing comment, not the waiting one', () => {
    // COMPLETE accepts no command at all, so offering a list of them would be
    // an invitation the state machine refuses.
    const delivered: AgentState = { ...parked('COMPLETE'), prUrl: 'https://example.test/pull/7' }

    expect(renderSettled(delivered)).toContain('### Done')
    expect(renderSettled(parked('COMPLETE'))).toContain('### Stopped')
  })
})

describe('formatFailures', () => {
  test('survives check output that contains a fence', () => {
    const rendered = formatFailures([{ name: 'test', exitCode: 1, output: `FAIL\n${FENCED_REPLY}` }])

    expect(code(rendered)).toContain('Hope that helps.')
    expect(spans(rendered).unclosed).toBe(false)
  })

  test('keeps each check name out of the code block', () => {
    const rendered = formatFailures([
      { name: 'lint', exitCode: 2, output: '```\nboom\n```' },
      { name: 'test', exitCode: 1, output: 'plain' },
    ])

    expect(prose(rendered)).toContain('**lint** (exit 2)')
    expect(prose(rendered)).toContain('**test** (exit 1)')
  })
})
