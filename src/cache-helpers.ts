// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { type ModelMessage, modelMessageSchema } from 'ai'
import { z } from 'zod'

const modelMessageArraySchema = z.array(modelMessageSchema)

export const parseHistoryFromDb = (messagesJson: string): ModelMessage[] | null => {
  try {
    const result = modelMessageArraySchema.safeParse(JSON.parse(messagesJson))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
