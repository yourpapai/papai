// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProviderAutoProvision, TaskProviderProvision } from '../../src/providers/registry.js'
import { maybeProvisionKaneo, provisionAndConfigure } from './provision.js'

export const kaneoAutoProvision: TaskProviderAutoProvision = ({ reply, contextId, username }) =>
  maybeProvisionKaneo(reply, contextId, username)

export const kaneoProvision: TaskProviderProvision = ({ contextId, username, publicUrl, internalUrl }) =>
  provisionAndConfigure(contextId, username, { publicUrl, internalUrl })
