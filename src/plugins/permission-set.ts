// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginPermission } from './types.js'

export type PluginPermissionSet = Pick<
  ReadonlySet<PluginPermission>,
  'has' | 'forEach' | 'entries' | 'keys' | 'values' | 'size'
> & {
  [Symbol.iterator](): SetIterator<PluginPermission>
}

export function buildPermissions(permissionsList: readonly PluginPermission[]): PluginPermissionSet {
  const permissions = new Set(permissionsList)
  return Object.freeze({
    get size(): number {
      return permissions.size
    },
    has(permission: PluginPermission): boolean {
      return permissions.has(permission)
    },
    forEach(
      callbackfn: (value: PluginPermission, value2: PluginPermission, set: ReadonlySet<PluginPermission>) => void,
      thisArg?: unknown,
    ): void {
      permissions.forEach((value) => {
        callbackfn.call(thisArg, value, value, permissions)
      })
    },
    entries(): SetIterator<[PluginPermission, PluginPermission]> {
      return permissions.entries()
    },
    keys(): SetIterator<PluginPermission> {
      return permissions.keys()
    },
    values(): SetIterator<PluginPermission> {
      return permissions.values()
    },
    [Symbol.iterator](): SetIterator<PluginPermission> {
      return permissions[Symbol.iterator]()
    },
  })
}
