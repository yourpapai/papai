// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { KeyFlags } from '../../sdd-runner/src/gate-session-state.js'
import { composeTaskText, initialCreateForm, reduceCreateForm } from '../../sdd-runner/src/session-create-form.js'
import type { CreateFormAction, CreateFormState } from '../../sdd-runner/src/session-create-form.js'

const keys = (
  over: Partial<{
    readonly ret: boolean
    readonly esc: boolean
    readonly bs: boolean
    readonly del: boolean
    readonly up: boolean
    readonly down: boolean
  }> = {},
): KeyFlags => ({
  upArrow: over.up === true,
  downArrow: over.down === true,
  return: over.ret === true,
  escape: over.esc === true,
  backspace: over.bs === true,
  delete: over.del === true,
})

function stateOf(action: CreateFormAction): CreateFormState {
  if (action.kind === 'state') return action.state
  throw new Error(`expected a form state change, got '${action.kind}'`)
}

function typing(state: CreateFormState, text: string): CreateFormState {
  let current = state
  for (const char of text) current = stateOf(reduceCreateForm(current, char, keys()))
  return current
}

describe('reduceCreateForm (field focus and editing)', () => {
  it('focuses the title first and appends typed chars to it', () => {
    const state = typing(initialCreateForm(), 'fix flaky auth test')
    expect(state.title).toBe('fix flaky auth test')
    expect(state.description).toBe('')
  })

  it('switches fields on Tab and with up/down arrows', () => {
    const afterTab = stateOf(reduceCreateForm(initialCreateForm(), '\t', keys()))
    expect(afterTab.field).toBe('description')
    const afterUp = stateOf(reduceCreateForm(afterTab, '', keys({ up: true })))
    expect(afterUp.field).toBe('title')
    const afterDown = stateOf(reduceCreateForm(afterUp, '', keys({ down: true })))
    expect(afterDown.field).toBe('description')
  })

  it('edits the focused buffer with backspace', () => {
    const withTitle = typing(initialCreateForm(), 'solo')
    const focused = stateOf(reduceCreateForm(withTitle, '\t', keys()))
    const withBody = typing(focused, 'body')
    expect(withBody.description).toBe('body')
    const edited = stateOf(reduceCreateForm(withBody, '', keys({ bs: true })))
    expect(edited.description).toBe('bod')
    expect(edited.title).toBe('solo')
  })

  it('treats q and other list keys as plain text, not shortcuts', () => {
    const state = typing(initialCreateForm(), 'q')
    expect(state.title).toBe('q')
    expect(reduceCreateForm(state, '', keys())).toEqual({ kind: 'none' })
  })

  it('normalizes carriage returns in a pasted chunk into newlines', () => {
    const titled = typing(initialCreateForm(), 'task')
    const focused = stateOf(reduceCreateForm(titled, '\t', keys()))
    const pasted = stateOf(reduceCreateForm(focused, '# Heading\r\rBody\rwrapped', keys()))
    const crlf = stateOf(reduceCreateForm(pasted, 'a\r\nb', keys()))
    expect(pasted.description).toBe('# Heading\n\nBody\nwrapped')
    expect(crlf.description).toBe('# Heading\n\nBody\nwrappeda\nb')
  })
})

describe('reduceCreateForm (outcomes)', () => {
  it('cancels on escape', () => {
    const action = reduceCreateForm(typing(initialCreateForm(), 'x'), '', keys({ esc: true }))
    expect(action).toEqual({ kind: 'cancel' })
  })

  it('rejects an empty title as inline validation: notice set, form stays open, nothing submitted', () => {
    const action = reduceCreateForm(initialCreateForm(), '', keys({ ret: true }))
    expect(action.kind).toBe('state')
    const state = stateOf(action)
    expect(state.field).toBe('title')
    expect(state.notice).toBe('a title is required')
  })

  it('rejects a whitespace-only title the same way', () => {
    const action = reduceCreateForm(typing(initialCreateForm(), '   '), '', keys({ ret: true }))
    expect(action.kind).toBe('state')
    expect(stateOf(action).notice).toBe('a title is required')
  })

  it('clears the validation notice once typing resumes', () => {
    const rejected = stateOf(reduceCreateForm(initialCreateForm(), '', keys({ ret: true })))
    const resumed = stateOf(reduceCreateForm(rejected, 't', keys()))
    expect(resumed.notice).toBe(null)
    expect(resumed.title).toBe('t')
  })

  it('submits a title-only form as heading-led task text', () => {
    const state = typing(initialCreateForm(), 'fix flaky auth test')
    expect(reduceCreateForm(state, '', keys({ ret: true }))).toEqual({
      kind: 'submit',
      taskText: '# fix flaky auth test\n',
    })
  })

  it('submits title plus description, trimming both', () => {
    let state = typing(initialCreateForm(), '  fix flaky auth test  ')
    state = stateOf(reduceCreateForm(state, '\t', keys()))
    state = typing(state, 'the suite flakes under load')
    expect(reduceCreateForm(state, '', keys({ ret: true }))).toEqual({
      kind: 'submit',
      taskText: '# fix flaky auth test\n\nthe suite flakes under load\n',
    })
  })
})

describe('composeTaskText', () => {
  it('keeps the heading-led shape the pipeline consumes', () => {
    expect(composeTaskText('solo title', '')).toBe('# solo title\n')
    expect(composeTaskText('titled', 'with body')).toBe('# titled\n\nwith body\n')
  })

  it('returns an H1-led description verbatim instead of prepending the title', () => {
    const pasted = '# Build: CLI backend\n\n## Context\n\nBody text.'
    expect(composeTaskText('typed title', pasted)).toBe(`${pasted}\n`)
  })

  it('still prepends the title when the description opens with a non-H1 heading', () => {
    expect(composeTaskText('titled', '## subheading first')).toBe('# titled\n\n## subheading first\n')
  })
})
