/**
 * API compatibility schemas for known upstream Kaneo bugs.
 *
 * The original schemas in this directory reflect the documented API contract.
 * When the real API deviates from its own documentation, place the lenient
 * workaround schema here and import it instead of the original.
 *
 * Each entry must include:
 *   - A reference to the upstream bug (GitHub URL)
 *   - A short description of what the API actually returns vs what it should
 */

import { z } from 'zod'

import { CreateCommentResponseSchema } from './create-comment.js'
import { ColumnSchema, ListTaskSchema } from './list-tasks.js'
import { UpdateCommentResponseSchema } from './update-comment.js'

/**
 * POST /activity/comment returns {} instead of the created activity record.
 *
 * Root cause: missing .returning() on the Drizzle ORM insert in create-comment.ts.
 * Upstream bug: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/create-comment.ts
 *
 * All fields are made optional via .partial() so validation does not throw on
 * the empty object. The caller must supply fallback values for any field it needs.
 */
export const CreateCommentResponseCompatSchema = CreateCommentResponseSchema.partial()

/**
 * PUT /activity/comment returns {} instead of the updated activity record.
 *
 * Root cause: missing .returning() on the Drizzle ORM update in update-comment.ts.
 * Upstream bug: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/update-comment.ts
 *
 * All fields are made optional via .partial() so validation does not throw on
 * the empty object. The caller must supply fallback values for any field it needs.
 */
export const UpdateCommentResponseCompatSchema = UpdateCommentResponseSchema.partial()

/**
 * All column endpoints return `icon` and `color` as absent (undefined) instead of null
 * when the database value is NULL.
 *
 * Root cause: `icon` and `color` columns in the Drizzle schema are declared without
 * `.default(null)`, so Drizzle omits the key from query results entirely when the DB
 * value is NULL. JSON.stringify then drops those undefined keys from the response.
 * Upstream bug: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/database/schema.ts
 *
 * Only `icon` and `color` are relaxed to optional; `id`, `name`, and `isFinal` are
 * always present and remain required.
 */
export const ColumnCompatSchema = ColumnSchema.extend({
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
})

/**
 * ListTasksResponseSchema embeds ColumnWithTasksSchema which extends the strict ColumnSchema.
 * Same upstream bug applies: icon/color are absent in column objects returned by GET /task/tasks/:projectId.
 */
const ColumnWithTasksCompatSchema = ColumnCompatSchema.extend({
  slug: z.string().optional(),
  tasks: z.array(ListTaskSchema),
})

export const ListTasksResponseCompatSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string().optional(),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    isPublic: z.boolean().nullable().optional(),
    workspaceId: z.string().optional(),
    columns: z.array(ColumnWithTasksCompatSchema),
    archivedTasks: z.array(ListTaskSchema),
    plannedTasks: z.array(ListTaskSchema),
  }),
  pagination: z
    .object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    })
    .optional(),
})
