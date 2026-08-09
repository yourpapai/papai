// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { OctokitLog } from '../../opencode-agent/src/github.js'

/**
 * An Octokit logger that discards every level.
 *
 * `@octokit/plugin-request-log` narrates every request, and a rejected one
 * lands on `error`, which Octokit defaults to `console.error` — past the
 * console suppression in `tests/setup.ts`, which deliberately leaves that
 * channel alone. A suite that drives a refusal on purpose passes this so its
 * expected 403 does not read as a real diagnostic in the test log.
 */
export const silentOctokitLog = (): OctokitLog => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})
