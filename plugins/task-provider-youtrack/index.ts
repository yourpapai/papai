// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContext } from 'papai/plugin-types'

import type { PluginFactory, PluginInstance } from '../../src/plugins/types.js'
import { validateConfig } from './validate-config.js'

const factory: PluginFactory = (): PluginInstance => ({
  activate(ctx: PluginContext): void {
    ctx.registration.registerTaskProviderType('youtrack', {
      // Task 4.4 swaps this stub for the real factory once provider sources are moved in.
      factory: () => {
        throw new Error('task-provider-youtrack factory not yet wired')
      },
      validateConfig,
    })
  },
})

export default factory
