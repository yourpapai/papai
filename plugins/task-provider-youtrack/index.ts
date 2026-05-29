// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContext, TaskProvider } from 'papai/plugin-types'

import type { PluginFactory, PluginInstance } from '../../src/plugins/types.js'
import { YouTrackProvider } from './provider.js'
import { validateConfig } from './validate-config.js'

const factory: PluginFactory = (): PluginInstance => ({
  activate(ctx: PluginContext): void {
    ctx.registration.registerTaskProviderType('youtrack', {
      factory: (config): TaskProvider =>
        new YouTrackProvider({ baseUrl: config['baseUrl'] ?? '', token: config['token'] ?? '' }),
      validateConfig,
    })
  },
})

export default factory
