// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The consumer shows most errors only after a field is touched, but surfaces this one
 * immediately — so it is exported rather than duplicated as a literal at the call site.
 */
export const DUPLICATE_ID_MESSAGE = 'An instance with this id already exists'

/** Per-field failures for the instance create form; an empty object means valid. */
export interface InstanceCreateErrors {
  id?: string
  type?: string
}

export interface InstanceCreateInput {
  id: string
  type: string
  existingIds: readonly string[]
}

/**
 * Mirrors the server's create contract (`id` non-empty, `type` selected) and adds the
 * duplicate check the server can only answer with a database constraint violation.
 */
export function validateInstanceCreate(input: InstanceCreateInput): InstanceCreateErrors {
  const errors: InstanceCreateErrors = {}
  const id = input.id.trim()
  if (id === '') errors.id = 'Required'
  else if (input.existingIds.includes(id)) errors.id = DUPLICATE_ID_MESSAGE
  if (input.type === '') errors.type = 'Required'
  return errors
}
