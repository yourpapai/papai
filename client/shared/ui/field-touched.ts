// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Resolve the validation message a field should currently display.
 *
 * A message is withheld until the user has touched the field, so a pristine
 * form does not open covered in errors. `alwaysShow` opts a message out of that
 * gate — use it for server-confirmed problems (e.g. a duplicate id) that are
 * true regardless of whether the user has visited the field.
 */
export function shownError(
  errors: Readonly<Record<string, string | undefined>>,
  touched: readonly string[],
  field: string,
  alwaysShow?: (message: string) => boolean,
): string | undefined {
  const message = errors[field]
  if (message === undefined) return undefined
  if (alwaysShow?.(message) === true) return message
  return touched.includes(field) ? message : undefined
}

/**
 * Add `field` to `touched`, returning the original array when nothing changes.
 *
 * Takes (and returns) a mutable array, not `readonly string[]`: returning the same
 * reference on the "already touched" path requires the input to genuinely be the
 * caller's mutable array, so widening it to `readonly` here would only force an
 * unsafe cast back to `string[]` on the way out.
 */
export function markTouched(touched: string[], field: string): string[] {
  return touched.includes(field) ? touched : [...touched, field]
}
