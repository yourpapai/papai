// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

const sha256Hex = (input: string): string => createHash('sha256').update(input).digest('hex')

export const toolCallEventId = (turnId: string, toolCallId: string): string => sha256Hex(`${turnId}|${toolCallId}`)

export const usageEventId = (turnId: string | null, responseId: string | null, modelRole: string): string =>
  sha256Hex(`${turnId ?? ''}|${responseId ?? ''}|${modelRole}`)
