// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { FIXED_TS } from '../fixtures/debug.js'

// Pins `Date.now` to a fixed instant so Storybook screenshots that surface
// wall-clock-derived values (e.g. `formatUptime`) are deterministic across
// runs. Mirrors the install/uninstall shape of the SSE and IntersectionObserver
// story stubs and is installed once in `.storybook/preview.ts`. Story-loaded
// fixtures use FIXED_TS for every timestamp, so pinning now to the same instant
// makes every relative duration a stable constant. Not loaded by production or
// the unit-test suite.
let originalNow: typeof Date.now | undefined

export function installTimeStub(): void {
  originalNow ??= Date.now
  Date.now = (): number => FIXED_TS
}

export function uninstallTimeStub(): void {
  if (originalNow !== undefined) {
    Date.now = originalNow
    originalNow = undefined
  }
}
