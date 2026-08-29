// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type Row<T> = T & { label: string }

/**
 * Runs each row's assertions sequentially inside one test case. When rows fail,
 * throws a single Error listing every failed row: its label, the row data, and the
 * matcher's own Expected/Received text. A non-assertion throw inside a row is
 * re-reported with its row label, never swallowed.
 */
export async function assertEach<T>(
  rows: readonly Row<T>[],
  run: (row: Row<T>) => void | Promise<void>,
): Promise<void> {
  const failures: string[] = []
  for (const row of rows) {
    try {
      await run(row)
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : String(thrown)
      const data = JSON.stringify(row)
      failures.push(`[${row.label}] ${data}\n${detail}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} of ${rows.length} rows failed:\n\n${failures.join('\n\n')}`)
  }
}
