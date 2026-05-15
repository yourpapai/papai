// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { PROJECT_ROOT } from './config.js'

function resolveSafe(inputPath: string): string | null {
  const resolved = resolve(PROJECT_ROOT, inputPath)
  const rel = relative(PROJECT_ROOT, resolved)
  if (rel === '' || (!rel.startsWith('..') && !rel.includes(`${pathSeparator()}..${pathSeparator()}`))) return resolved
  return null
}

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

function resolveSafeDirectory(inputPath: string): string | null {
  const resolved = resolveSafe(inputPath)
  if (resolved === null) return null
  return resolved
}

function makeReadFileTool(): ToolSet[string] {
  return tool({
    description: 'Read the contents of a file by project-relative path (e.g. "src/bot.ts")',
    inputSchema: z.object({
      path: z.string().describe('Project-relative file path'),
    }),
    execute: async ({ path }): Promise<string> => {
      const resolved = resolveSafe(path)
      if (resolved === null) return `Error: path "${path}" resolves outside project`
      try {
        return await Bun.file(resolved).text()
      } catch {
        return `Error: file not found: ${path}`
      }
    },
  })
}

function makeGrepTool(): ToolSet[string] {
  return tool({
    description: 'Search for a regex pattern in src/ and tests/. Returns matching lines as "file:line:content".',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      directory: z.string().optional().describe('Subdirectory to search within (default: src/ and tests/)'),
    }),
    execute: async ({ pattern, directory }): Promise<string> => {
      const dirs = resolveGrepDirectories(directory)
      if (dirs === null) return `Error: directory "${directory}" resolves outside project`
      const args = ['-rn', '--include=*.ts', '-E', pattern, ...dirs]
      try {
        const proc = Bun.spawn(['grep', ...args], {
          cwd: PROJECT_ROOT,
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const output = await new Response(proc.stdout).text()
        await proc.exited
        const lines = output.trim().split('\n').filter(Boolean)
        if (lines.length > 100) {
          return lines.slice(0, 100).join('\n') + `\n... (${lines.length - 100} more matches truncated)`
        }
        return lines.length > 0 ? lines.join('\n') : 'No matches found'
      } catch {
        return `Error running grep for pattern: ${pattern}`
      }
    },
  })
}

function resolveGrepDirectories(directory: string | undefined): readonly string[] | null {
  if (directory === undefined) return ['src', 'tests']
  const safe = resolveSafeDirectory(directory)
  if (safe === null) return null
  return [relative(PROJECT_ROOT, safe)]
}

function makeFindFilesTool(): ToolSet[string] {
  return tool({
    description: 'Find files matching a glob-style name pattern (e.g. "*.test.ts", "bot.ts")',
    inputSchema: z.object({
      pattern: z.string().describe('File name pattern (passed to find -name)'),
    }),
    execute: async ({ pattern }): Promise<string> => {
      try {
        const proc = Bun.spawn(
          ['find', '.', '-name', pattern, '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'],
          { cwd: PROJECT_ROOT, stdout: 'pipe', stderr: 'pipe' },
        )
        const output = await new Response(proc.stdout).text()
        await proc.exited
        const files = output.trim().split('\n').filter(Boolean)
        if (files.length > 50) {
          return files.slice(0, 50).join('\n') + `\n... (${files.length - 50} more files truncated)`
        }
        return files.length > 0 ? files.join('\n') : 'No files found'
      } catch {
        return `Error finding files with pattern: ${pattern}`
      }
    },
  })
}

function makeListDirTool(): ToolSet[string] {
  return tool({
    description: 'List the contents of a directory. Each entry shows whether it is a file or directory.',
    inputSchema: z.object({
      path: z.string().describe('Project-relative directory path'),
    }),
    execute: async ({ path }): Promise<string> => {
      const resolved = resolveSafe(path)
      if (resolved === null) return `Error: path "${path}" resolves outside project`
      try {
        const entries = await readdir(resolved)
        const stats = await Promise.all(
          entries.map(async (entry) => {
            const s = await stat(join(resolved, entry))
            return s.isDirectory() ? `${entry}/` : entry
          }),
        )
        return stats.join('\n')
      } catch {
        return `Error: directory not found: ${path}`
      }
    },
  })
}

export function makeAuditTools(): Record<string, ToolSet[string]> {
  return {
    readFile: makeReadFileTool(),
    grep: makeGrepTool(),
    findFiles: makeFindFilesTool(),
    listDir: makeListDirTool(),
  }
}
