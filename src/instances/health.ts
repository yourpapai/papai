// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { getTaskProviderDescriptor } from '../providers/registry.js'
import { listTaskInstances } from './task-store.js'

const KNOWN_PLUGIN_FOR_TYPE: Readonly<Record<string, string>> = {
  kaneo: 'task-provider-kaneo',
  youtrack: 'task-provider-youtrack',
}

const pluginIdFor = (type: string): string =>
  KNOWN_PLUGIN_FOR_TYPE[type] ?? `(provider plugin contributing type '${type}')`

export function warnUnresolvedTaskInstances(): void {
  const instances = listTaskInstances()
  const offenders = instances.filter((instance) => getTaskProviderDescriptor(instance.type) === undefined)
  if (offenders.length === 0) return
  const types = [...new Set(offenders.map((instance) => instance.type))]
  const commands = types.map((type) => `/plugin approve ${pluginIdFor(type)}`)
  logger
    .child({ scope: 'instances:health' })
    .warn(
      { unresolvedTypes: types, instanceIds: offenders.map((instance) => instance.id) },
      `Found ${offenders.length} task_instances row(s) whose provider plugin is not active. Run: ${commands.join('; ')}`,
    )
}
