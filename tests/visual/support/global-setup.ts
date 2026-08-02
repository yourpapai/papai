// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regenerate the concatenated Storybook CSS bundles before every visual run.
 *
 * `storybook:prepare` cats `client/shared/base.css` + `client/shared/tokens.css` (plus the
 * per-SPA stylesheet) into `public/storybook-*.css`, and package.json wires it to *server
 * start*. With `webServer.reuseExistingServer: true`, a warm Storybook means Playwright never
 * executes `webServer.command` — so a long-running server keeps serving the token snapshot it
 * booted with. Sub-project G lost an entire audit to this: the suite reported its normal pass
 * rate while the browser rendered four-hour-old colors.
 *
 * Running it here couples regeneration to the run rather than to the server. Vite serves
 * `public/` from disk per request, so the dev server picks up the new bundles without a
 * restart. Measured cost is ~112 ms, which is why it can run on every `bun shoot -g <Section>`
 * without disturbing the warm loop. Do not remove it as an optimisation: its absence fails
 * silently, by passing.
 */
export default function globalSetup(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

  try {
    execFileSync('bun', ['run', 'storybook:prepare'], { cwd: repoRoot, stdio: 'pipe' })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`storybook:prepare failed, so visual runs would render stale CSS: ${detail}`, { cause: error })
  }
}
