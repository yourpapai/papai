// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/** Shared base shape for a stored, editable config value (settings + admin field schemas). */
export const StoredConfigValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
  value: z.string(),
  control: z.enum(['text', 'select', 'combobox']).optional(),
  options: z.array(z.string()).optional(),
})
