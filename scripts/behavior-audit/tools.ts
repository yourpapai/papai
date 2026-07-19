// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import type { ToolExecutionOptions } from 'ai'
import { Glob } from 'bun'
import { z } from 'zod'

import { PROJECT_ROOT } from './config.js'

const fileCache = new Map<string, string>()

export function resetGrepCache(): void {
  fileCache.clear()
}

async function readCached(absPath: string): Promise<string> {
  const hit = fileCache.get(absPath)
  if (hit !== undefined) return hit
  const text = await Bun.file(absPath).text()
  fileCache.set(absPath, text)
  return text
}

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

function resolveSafeAt(rootAbs: string, inputPath: string): string | null {
  const resolved = resolve(rootAbs, inputPath)
  const rel = relative(rootAbs, resolved)
  if (rel === '' || (!rel.startsWith('..') && !rel.includes(`${pathSeparator()}..${pathSeparator()}`))) return resolved
  return null
}

function enumerateTsFiles(rootAbs: string, dirs: readonly string[]): readonly string[] {
  const out: string[] = []
  for (const dir of dirs) {
    const abs = resolve(rootAbs, dir)
    const scan = new Glob('**/*.ts').scanSync({ cwd: abs, absolute: true })
    for (const path of scan) {
      out.push(path)
    }
  }
  return out
}

function resolveGrepDirectoriesAt(rootAbs: string, directory: string | undefined): readonly string[] | null {
  if (directory === undefined) return ['src', 'tests']
  const resolved = resolveSafeAt(rootAbs, directory)
  if (resolved === null) return null
  return [relative(rootAbs, resolved)]
}

type GrepInput = { readonly pattern: string; readonly directory?: string }
type ReadFileInput = { readonly path: string }
type FindFilesInput = { readonly pattern: string }
type ListDirInput = { readonly path: string }

export type AuditTool<I> = {
  readonly description: string
  readonly inputSchema: z.ZodType<I>
  execute: (input: I, options?: ToolExecutionOptions<unknown>) => Promise<string>
}

export type AuditTools = {
  readonly readFile: AuditTool<ReadFileInput>
  readonly grep: AuditTool<GrepInput>
  readonly findFiles: AuditTool<FindFilesInput>
  readonly listDir: AuditTool<ListDirInput>
}

function makeReadFileToolAt(rootAbs: string): AuditTool<ReadFileInput> {
  return {
    description: 'Read the contents of a file by project-relative path (e.g. "src/bot.ts")',
    inputSchema: z.object({
      path: z.string().describe('Project-relative file path'),
    }),
    execute: async ({ path }): Promise<string> => {
      const resolved = resolveSafeAt(rootAbs, path)
      if (resolved === null) return `Error: path "${path}" resolves outside project`
      try {
        return await Bun.file(resolved).text()
      } catch {
        return `Error: file not found: ${path}`
      }
    },
  }
}

function makeGrepToolAt(rootAbs: string): AuditTool<GrepInput> {
  return {
    description: 'Search for a regex pattern in src/ and tests/. Returns matching lines as "file:line:content".',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      directory: z.string().optional().describe('Subdirectory to search within (default: src/ and tests/)'),
    }),
    execute: async ({ pattern, directory }): Promise<string> => {
      const dirs = resolveGrepDirectoriesAt(rootAbs, directory)
      if (dirs === null) return `Error: directory "${directory}" resolves outside project`
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'u')
      } catch (err) {
        return `Error: invalid regex: ${err instanceof Error ? err.message : String(err)}`
      }
      const files = enumerateTsFiles(rootAbs, dirs)
      const texts = await Promise.all(files.map((file) => readCached(file)))
      const matches: string[] = []
      for (let f = 0; f < files.length; f++) {
        const file = files[f]!
        const lines = texts[f]!.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!
          if (regex.test(line)) {
            matches.push(`${relative(rootAbs, file)}:${i + 1}:${line}`)
            if (matches.length >= 100) return matches.join('\n')
          }
        }
      }
      return matches.length > 0 ? matches.join('\n') : 'No matches found'
    },
  }
}

function makeFindFilesToolAt(rootAbs: string): AuditTool<FindFilesInput> {
  return {
    description: 'Find files matching a glob-style name pattern (e.g. "*.test.ts", "bot.ts")',
    inputSchema: z.object({
      pattern: z.string().describe('File name pattern (passed to find -name)'),
    }),
    execute: async ({ pattern }): Promise<string> => {
      try {
        const proc = Bun.spawn(
          ['find', '.', '-name', pattern, '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'],
          { cwd: rootAbs, stdout: 'pipe', stderr: 'pipe' },
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
  }
}

function makeListDirToolAt(rootAbs: string): AuditTool<ListDirInput> {
  return {
    description: 'List the contents of a directory. Each entry shows whether it is a file or directory.',
    inputSchema: z.object({
      path: z.string().describe('Project-relative directory path'),
    }),
    execute: async ({ path }): Promise<string> => {
      const resolved = resolveSafeAt(rootAbs, path)
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
  }
}

export function makeAuditToolsForRoot(rootAbs: string): AuditTools {
  return {
    readFile: makeReadFileToolAt(rootAbs),
    grep: makeGrepToolAt(rootAbs),
    findFiles: makeFindFilesToolAt(rootAbs),
    listDir: makeListDirToolAt(rootAbs),
  }
}

export function makeAuditTools(): AuditTools {
  return makeAuditToolsForRoot(PROJECT_ROOT)
}
