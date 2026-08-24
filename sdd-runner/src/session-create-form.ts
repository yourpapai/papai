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

/** Matches the H1 shape `deriveChangeName` names a session from. */
const H1_LINE = /^#\s+\S/u

/**
 * The task text a submitted form composes: heading-led, body optional.
 *
 * A description that itself opens with an H1 — a pasted prompt document — is
 * returned verbatim: prepending the typed title would give the task text two
 * H1s, and its own heading already names the session.
 */
export function composeTaskText(title: string, description: string): string {
  const body = description.trim()
  if (body === '') return `# ${title}\n`
  if (H1_LINE.test(body)) return `${body}\n`
  return `# ${title}\n\n${body}\n`
}

function editBuffer(state: CreateFormState, text: string): CreateFormState {
  return {
    ...state,
    ...(state.field === 'title' ? { title: text } : { description: text }),
    notice: null,
  }
}

/**
 * A paste arrives as one chunk whose newlines the terminal has already turned
 * into `\r` (or `\r\n`) — Ink passes the chunk through verbatim with no
 * `key.return`, so the buffer would otherwise hold CRs that no downstream
 * markdown consumer treats as line breaks. A typed Return never reaches the
 * append branch; the submit branch consumes it first.
 */
const normalizeInput = (input: string): string => input.replace(/\r\n?/gu, '\n')

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
  if (input.length > 0) return { kind: 'state', state: editBuffer(state, buffer + normalizeInput(input)) }
  return { kind: 'none' }
}
