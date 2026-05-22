// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const TaskDateTimeSchema = z.iso.datetime({ offset: true })
const TaskPriorityEnum = z.enum(['no-priority', 'low', 'medium', 'high', 'urgent'])

// Column schema
export const ColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  isFinal: z.boolean(),
})

// Task within columns (simplified)
export const ListTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: TaskPriorityEnum,
  description: z.string().optional(),
  position: z.number().optional(),
  createdAt: TaskDateTimeSchema.optional(),
  userId: z.string().nullable().optional(),
  projectId: z.string().optional(),
  dueDate: TaskDateTimeSchema.nullable().optional(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).optional(),
  externalLinks: z.array(z.unknown()).optional(),
})

const ColumnWithTasksSchema = ColumnSchema.extend({
  tasks: z.array(ListTaskSchema),
})

const PaginationSchema = z.object({
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

const GroupedTaskListDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  isPublic: z.boolean().nullable().optional(),
  workspaceId: z.string().optional(),
  columns: z.array(ColumnWithTasksSchema),
  archivedTasks: z.array(ListTaskSchema),
  plannedTasks: z.array(ListTaskSchema),
})

export const ListTasksResponseSchema = z.object({
  data: GroupedTaskListDataSchema,
  pagination: PaginationSchema.optional(),
})
