// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { KeyFlags } from './gate-session-state.js'

/**
 * Pure reducer for the inline creation form: field focus, text buffers, and
 * validation notice — a generalization of the gate input reducer's
 * char/backspace/escape handling to two named fields. No React, no Ink.
 */

export interface CreateFormState {
  readonly field: 'title' | 'description'
  readonly title: string
  readonly description: string
  readonly notice: string | null
}

export type CreateFormAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'state'; readonly state: CreateFormState }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'submit'; readonly taskText: string }

export function initialCreateForm(): CreateFormState {
  return { field: 'title', title: '', description: '', notice: null }
}

/** The task text a submitted form composes: heading-led, body optional. */
export function composeTaskText(title: string, description: string): string {
  return description === '' ? `# ${title}\n` : `# ${title}\n\n${description}\n`
}

function editBuffer(state: CreateFormState, text: string): CreateFormState {
  return {
    ...state,
    ...(state.field === 'title' ? { title: text } : { description: text }),
    notice: null,
  }
}

export function reduceCreateForm(state: CreateFormState, input: string, key: KeyFlags): CreateFormAction {
  if (key.escape) return { kind: 'cancel' }
  if (key.return) {
    const title = state.title.trim()
    if (title === '') return { kind: 'state', state: { ...state, notice: 'a title is required' } }
    return { kind: 'submit', taskText: composeTaskText(title, state.description.trim()) }
  }
  if (key.upArrow) return { kind: 'state', state: { ...state, field: 'title' } }
  if (key.downArrow) return { kind: 'state', state: { ...state, field: 'description' } }
  if (input === '\t') {
    return { kind: 'state', state: { ...state, field: state.field === 'title' ? 'description' : 'title' } }
  }
  const buffer = state.field === 'title' ? state.title : state.description
  if (key.backspace || key.delete) return { kind: 'state', state: editBuffer(state, buffer.slice(0, -1)) }
  if (input.length > 0) return { kind: 'state', state: editBuffer(state, buffer + input) }
  return { kind: 'none' }
}
