// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { InstanceConfig, InstanceStatus, PlatformInstanceType } from '../instances/types.js'
import type { ChatProvider } from './types.js'

export type ManagedChatInstance = {
  readonly id: string
  readonly type: PlatformInstanceType
  readonly provider: ChatProvider
  status: InstanceStatus
  readonly configFingerprint: string
}

export type ManagedChatInstanceSnapshot = {
  readonly id: string
  readonly type: PlatformInstanceType
  readonly status: InstanceStatus
  readonly configFingerprint: string
}

export type ManagedChatInstanceFactory = (
  id: string,
  type: PlatformInstanceType,
  config: InstanceConfig,
) => ChatProvider
