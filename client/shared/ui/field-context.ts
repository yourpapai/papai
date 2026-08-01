// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContext, setContext } from 'svelte'

const FIELD_LABEL_ID = Symbol('field-label-id')

/** Called by Field during init to publish its label element id to descendant controls. */
export function setFieldLabelId(id: string): void {
  setContext(FIELD_LABEL_ID, id)
}

/** Called by Input/Select during init; returns the enclosing Field's label id, if any. */
export function getFieldLabelId(): string | undefined {
  return getContext<string | undefined>(FIELD_LABEL_ID)
}

const FIELD_ERROR = Symbol('field-error')

/** Reactive field state a Field publishes to its descendant control. */
export interface FieldErrorContext {
  errorId: string
  hintId: string
  /** Getter so the control tracks the Field's live `error` prop. */
  readonly invalid: boolean
  /** Getter so the control tracks a `hint` that appears or disappears after init. */
  readonly hasHint: boolean
  /** Getter so the control tracks a `required` prop that changes after init. */
  readonly required: boolean
}

/** Called by Field during init to publish its error state to descendant controls. */
export function setFieldError(ctx: FieldErrorContext): void {
  setContext(FIELD_ERROR, ctx)
}

/** Called by Input/Select during init; returns the enclosing Field's error context, if any. */
export function getFieldError(): FieldErrorContext | undefined {
  return getContext<FieldErrorContext | undefined>(FIELD_ERROR)
}

/** What a control needs to render the enclosing Field's error state. */
export interface FieldInvalidState {
  readonly invalid: boolean
  readonly describedBy: string | undefined
  readonly required: boolean
}

/**
 * Called by Input/Select/Combobox during init. Getters, not a snapshot: each read goes
 * through the context's own `invalid` getter, so a control tracks the Field's live `error`
 * prop without needing a rune here.
 */
export function useFieldInvalid(): FieldInvalidState {
  const ctx = getFieldError()
  return {
    get invalid() {
      return ctx?.invalid ?? false
    },
    // The error and the hint render in exclusive branches of one {#if}, so exactly one
    // id is ever live and aria-describedby never needs a space-separated list.
    get describedBy() {
      if (ctx === undefined) return undefined
      if (ctx.invalid) return ctx.errorId
      return ctx.hasHint ? ctx.hintId : undefined
    },
    get required() {
      return ctx?.required ?? false
    },
  }
}
