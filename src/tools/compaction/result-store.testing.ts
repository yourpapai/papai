// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  clearResultStoreForTesting as _clearResultStoreForTesting,
  setResultStoreClockForTesting as _setResultStoreClockForTesting,
} from './result-store.js'

export const clearResultStoreForTesting = _clearResultStoreForTesting
export const setResultStoreClockForTesting = _setResultStoreClockForTesting
