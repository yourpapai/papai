import { spawn } from 'node:child_process'
import path from 'node:path'

import type { Plugin } from '@opencode-ai/plugin'

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])
const INDEXED_ROOTS = ['src', 'client']
const INDEXED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx'])

const debounceMap = new Map<string, ReturnType<typeof setTimeout>>()

const shouldReindex = (filePath: string, cwd: string): boolean => {
  const normalized = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath
  const ext = path.extname(normalized)

  if (!INDEXED_EXTS.has(ext)) return false

  const inIndexedRoot = INDEXED_ROOTS.some(
    (root) => normalized.startsWith(`${root}/`) || normalized.startsWith(`${root}\\`),
  )
  if (!inIndexedRoot) return false

  if (normalized.includes('.test.') || normalized.includes('.spec.')) return false

  return true
}

export const CodeindexReindex: Plugin = async ({ directory }) => {
  return {
    'tool.execute.after': async (input) => {
      if (!EDIT_TOOLS.has(input.tool)) return

      const filePath = (input.args['filePath'] as string) ?? ''
      if (!filePath || !shouldReindex(filePath, directory)) return

      const sessionID = input.sessionID

      const existing = debounceMap.get(sessionID)
      if (existing) clearTimeout(existing)

      const timeout = setTimeout(() => {
        debounceMap.delete(sessionID)
        const child = spawn('bun', ['run', 'codeindex/src/cli.ts', 'reindex'], {
          cwd: directory,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        })
        child.unref()
        child.stdout?.on('data', () => undefined)
        child.stderr?.on('data', () => undefined)
      }, 600)

      debounceMap.set(sessionID, timeout)
    },
  }
}
