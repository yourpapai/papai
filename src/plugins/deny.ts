// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function deny(pluginId: string, permission: string): never {
  throw new Error(`Plugin ${pluginId} does not have '${permission}' permission`)
}
