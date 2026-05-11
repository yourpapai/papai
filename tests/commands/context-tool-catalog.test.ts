import { describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildContextToolCatalogPages } from '../../src/commands/context-tool-catalog.js'
import { TOOL_METADATA } from '../../src/tools/tool-metadata.js'

describe('context tool catalog', () => {
  test('formats live tool metadata, classification, and schema details', () => {
    const tools: ToolSet = {
      create_task: tool({
        description: 'Create a task in the active tracker',
        inputSchema: z.object({
          title: z.string().describe('Task title'),
          projectId: z.string().optional().describe('Optional project identifier'),
        }),
        execute: () => Promise.resolve({ id: 'task-1' }),
      }),
    }

    const pages = buildContextToolCatalogPages(tools)

    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('`create_task`')
    expect(pages[0]).toContain('Domain: `task`')
    expect(pages[0]).toContain('Operation: `create`')
    expect(pages[0]).toContain('Risk: `write`')
    expect(pages[0]).toContain('Create a task in the active tracker')
    expect(pages[0]).toContain('title (string) *required* - Task title')
    expect(pages[0]).toContain('projectId (string) - Optional project identifier')
  })

  test('supports hyphen-normalized classification through the catalog builder path', () => {
    const tools: ToolSet = {
      'add-task-relation': tool({
        description: 'Add a relation between two tasks',
        inputSchema: z.object({
          taskId: z.string().describe('Primary task identifier'),
        }),
        execute: () => Promise.resolve({ ok: true }),
      }),
    }

    const pages = buildContextToolCatalogPages(tools)

    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('`add-task-relation`')
    expect(pages[0]).toContain('Domain: `task`')
    expect(pages[0]).toContain('Operation: `create`')
    expect(pages[0]).toContain('Risk: `write`')
  })

  test('paginates long catalogs instead of emitting one oversized block', () => {
    const toolNames = Object.keys(TOOL_METADATA).slice(0, 18)
    const lastToolName = toolNames[toolNames.length - 1]!
    const tools = Object.fromEntries(
      toolNames.map((name) => [
        name,
        tool({
          description: `${name} `.repeat(40).trim(),
          inputSchema: z.object({
            taskId: z.string().describe('Task identifier used by this tool'),
            notes: z.string().optional().describe('Extra notes for the operation'),
          }),
          execute: () => Promise.resolve({ ok: true }),
        }),
      ]),
    ) satisfies ToolSet

    const pages = buildContextToolCatalogPages(tools)

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.every((page) => page.length <= 3500)).toBe(true)
    expect(pages.join('\n')).toContain(`\`${lastToolName}\``)
  })

  test('chunks a single oversized entry so every page stays within the cap', () => {
    const tools: ToolSet = {
      create_task: tool({
        description: 'very long description '.repeat(400).trim(),
        inputSchema: z.object({
          title: z.string().describe('Task title'),
        }),
        execute: () => Promise.resolve({ id: 'task-1' }),
      }),
    }

    const pages = buildContextToolCatalogPages(tools)

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.every((page) => page.length <= 3500)).toBe(true)
    expect(pages.join('\n')).toContain('`create_task`')
    expect(pages.join('\n')).toContain('very long description')
  })

  test('keeps final rendered pages within the cap when total-page title grows', () => {
    const toolNames = Object.keys(TOOL_METADATA).slice(0, 12)
    const tools = Object.fromEntries(
      toolNames.map((name) => [
        name,
        tool({
          description: `${name} `.repeat(70).trim(),
          inputSchema: z.object({
            taskId: z.string().describe('Task identifier used by this tool'),
          }),
          execute: () => Promise.resolve({ ok: true }),
        }),
      ]),
    ) satisfies ToolSet

    const pages = buildContextToolCatalogPages(tools)

    expect(pages.length).toBeGreaterThan(1)
    expect(pages.every((page) => page.length <= 3500)).toBe(true)
  })
})
