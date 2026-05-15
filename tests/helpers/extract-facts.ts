// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Test helper for extracting facts from tool results.
 * This was moved from src/memory.ts since it's only used in tests.
 */

import { z } from 'zod'

import type { MemoryFact } from '../../src/types/memory.js'

const TaskResultSchema = z.looseObject({
  id: z.string(),
  title: z.string().optional(),
  number: z.number().optional(),
})

const ProjectResultSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
})

type ToolResultEntry = { toolName: string; result: unknown }

// Helper to extract projects from list_projects result
function extractProjectsFromListResult(output: unknown): Omit<MemoryFact, 'last_seen'>[] {
  if (!Array.isArray(output)) {
    return []
  }

  const facts: Omit<MemoryFact, 'last_seen'>[] = []
  // Cap at first 10 projects to avoid polluting the fact store
  const projects = output.slice(0, 10)

  for (const project of projects) {
    const parsed = ProjectResultSchema.safeParse(project)
    if (parsed.success) {
      facts.push({
        identifier: `proj:${parsed.data.id}`,
        title: parsed.data.name,
        url: parsed.data.url ?? '',
      })
    }
  }

  return facts
}

/**
 * Extract facts from tool results for testing purposes.
 */
export function extractFacts(toolResults: readonly ToolResultEntry[]): readonly Omit<MemoryFact, 'last_seen'>[] {
  const facts: Omit<MemoryFact, 'last_seen'>[] = []

  for (const result of toolResults) {
    // Task-related facts from mutation and read operations
    if (['create_task', 'update_task', 'delete_task', 'get_task'].includes(result.toolName)) {
      const parsed = TaskResultSchema.safeParse(result.result)
      if (parsed.success) {
        const label = parsed.data.number === undefined ? parsed.data.id : `#${parsed.data.number}`
        facts.push({
          identifier: label,
          title: parsed.data.title ?? label,
          url: '',
        })
      }
    }

    // Project facts from mutation operations (single project)
    if (['create_project', 'update_project', 'archive_project'].includes(result.toolName)) {
      const parsed = ProjectResultSchema.safeParse(result.result)
      if (parsed.success) {
        facts.push({
          identifier: `proj:${parsed.data.id}`,
          title: parsed.data.name,
          url: parsed.data.url ?? '',
        })
      }
    }

    // Project facts from list_projects operation (array of projects)
    if (result.toolName === 'list_projects') {
      const projectFacts = extractProjectsFromListResult(result.result)
      facts.push(...projectFacts)
    }
  }

  return facts
}
