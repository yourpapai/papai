// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test } from '@crvy/strybk'

/**
 * Pin the project's default viewport before every test in the calling spec file.
 *
 * The `sharedPage` fixture from `@crvy/strybk` is worker-scoped: its viewport is set once by
 * `browser.newContext`, and the reset helpers (`resetSharedPage` / `restoreSharedPageBaseline`)
 * never restore it. So any test calling `setViewportSize` leaks that viewport into whichever
 * test runs next in the same worker — which silently records desktop-intent baselines at a
 * narrow size, and makes a spec's results depend on its execution order.
 *
 * A failing test resets the shared page, so the leak only ever reaches one subsequent test.
 * That is why the corruption stays hidden: the bled baseline matches the bled render, and the
 * suite passes.
 *
 * Call this at the top of any spec file whose tests call `setViewportSize`.
 */
export function pinDefaultViewport(): void {
  test.beforeEach(async ({ sharedPage }) => {
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
  })
}
