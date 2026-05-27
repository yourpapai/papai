// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

// Alias import is the actual subject of spec §7: the public surface must resolve
// through the `papai/plugin-types` package alias, not just the relative path.
import * as pluginTypes from 'papai/plugin-types'
import { providerError, isAppError } from 'papai/plugin-types'
// Compile-time conformance (erased at runtime): these types must be reachable
// through the alias so a plugin can implement TaskProvider without deep imports.
import type { TaskProvider, Task, UserRef, Attachment, TaskRelation, SystemError } from 'papai/plugin-types'

// Relative import of the implementation module — required by the TDD import-gate
// hook so this test is recognized as covering public-types.ts.
import * as relativeModule from '../../src/providers/public-types.js'

// Compile-time guard: if any of these are dropped from the alias, bun typecheck
// will fail, making type-surface regressions visible immediately.
type _AliasSurfaceGuard = {
  provider: TaskProvider
  task: Task
  user: UserRef
  attachment: Attachment
  relation: TaskRelation
  error: SystemError
}

export type { _AliasSurfaceGuard }

describe('papai/plugin-types alias', () => {
  test('resolves through the alias and exposes error constructors', () => {
    expect(providerError).toBeDefined()
    expect(typeof providerError.taskNotFound).toBe('function')
    expect(typeof isAppError).toBe('function')
  })

  // NOTE: this list must stay in sync with the runtime (value) exports of
  // src/errors.ts re-exported by src/providers/public-types.ts. Types are
  // erased at runtime, so only the 5 AppError helpers appear here.
  test('runtime surface is limited to error helpers — no implementation code', () => {
    // Types are erased at runtime, so the only runtime exports are the AppError
    // helpers. This is the bundle-isolation guard from spec §7: importing the alias
    // must not pull in provider classes (KaneoProvider, YouTrackProvider, …).
    expect(Object.keys(pluginTypes).toSorted()).toEqual(
      ['extractAppError', 'isAppError', 'providerError', 'systemError', 'webFetchError'].toSorted(),
    )
  })

  test('the alias resolves to the same runtime surface as the module', () => {
    expect(Object.keys(pluginTypes).toSorted()).toEqual(Object.keys(relativeModule).toSorted())
  })
})
