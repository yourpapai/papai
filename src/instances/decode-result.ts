// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { InstanceDecodeFailure, InstanceDecodeResult } from './types.js'

export const rowsToInstancesSafe = <TRow, TInstance>(
  rows: readonly TRow[],
  decode: (row: TRow) => TInstance,
  onFailure: (row: TRow, error: unknown) => InstanceDecodeFailure,
): InstanceDecodeResult<TInstance> =>
  rows.reduce<InstanceDecodeResult<TInstance>>(
    (result, row) => {
      try {
        return { ...result, instances: [...result.instances, decode(row)] }
      } catch (error) {
        return { ...result, failures: [...result.failures, onFailure(row, error)] }
      }
    },
    { instances: [], failures: [] },
  )
