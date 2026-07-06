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

/** Reactive error state a Field publishes to its descendant control. */
export interface FieldErrorContext {
  errorId: string
  /** Getter so the control tracks the Field's live `error` prop. */
  readonly invalid: boolean
}

/** Called by Field during init to publish its error state to descendant controls. */
export function setFieldError(ctx: FieldErrorContext): void {
  setContext(FIELD_ERROR, ctx)
}

/** Called by Input/Select during init; returns the enclosing Field's error context, if any. */
export function getFieldError(): FieldErrorContext | undefined {
  return getContext<FieldErrorContext | undefined>(FIELD_ERROR)
}
