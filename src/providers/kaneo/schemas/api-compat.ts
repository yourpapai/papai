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

import { ColumnSchema } from './list-tasks.js'

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
