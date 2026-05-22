// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/custom-fields.ts
import { z } from 'zod'

import { UserReferenceSchema } from './user.js'

const EnumBundleElementSchema = z.object({
  $type: z.literal('EnumBundleElement'),
  name: z.string(),
  ordinal: z.number().optional(),
})

const TextFieldValueSchema = z.object({
  $type: z.literal('TextFieldValue'),
  text: z.string(),
})

const SingleEnumIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleEnumIssueCustomField'),
  name: z.string(),
  value: EnumBundleElementSchema,
})

const SingleUserIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleUserIssueCustomField'),
  name: z.string(),
  value: UserReferenceSchema.optional(),
})

const TextIssueCustomFieldSchema = z.object({
  $type: z.literal('TextIssueCustomField'),
  name: z.string(),
  value: TextFieldValueSchema,
})

const SimpleIssueCustomFieldSchema = z.object({
  $type: z.literal('SimpleIssueCustomField'),
  name: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
})

/** Fallback for field types not explicitly modelled (e.g. StateIssueCustomField, PeriodIssueCustomField). */
const UnknownIssueCustomFieldSchema = z.object({
  $type: z.string(),
  name: z.string(),
  value: z.unknown(),
})

export const CustomFieldValueSchema = z.union([
  SingleEnumIssueCustomFieldSchema,
  z.object({
    $type: z.literal('MultiEnumIssueCustomField'),
    name: z.string(),
    value: z.array(EnumBundleElementSchema),
  }),
  SingleUserIssueCustomFieldSchema,
  z.object({
    $type: z.literal('MultiUserIssueCustomField'),
    name: z.string(),
    value: z.array(UserReferenceSchema).optional(),
  }),
  TextIssueCustomFieldSchema,
  SimpleIssueCustomFieldSchema,
  UnknownIssueCustomFieldSchema,
])
