// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Render an event's wall-clock time as a fixed 24-hour `HH:MM:SS` in the viewer's local zone.
 *
 * Deliberately NOT `toLocaleTimeString`: its output varies with the runtime's ICU locale data,
 * which would make every screenshot baseline containing a timestamp differ between machines.
 *
 * `ts` arrives as `z.string()` with no format guarantee (it originates in magi), so an
 * unparseable value returns '' — a blank column reads as "unknown", where the literal text
 * "Invalid Date" reads as a bug in the viewer.
 */
export function formatEventTime(ts: string): string {
  const at = new Date(ts)
  if (Number.isNaN(at.getTime())) return ''
  return at.toTimeString().slice(0, 8)
}
