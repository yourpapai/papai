// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'

/** Globs whose union is the universe of files that can participate in the import graph. */
export const GRAPH_ROOTS: readonly string[] = [
  'src/**/*.ts',
  'client/**/*.ts',
  'plugins/**/*.ts',
  'tests/**/*.ts',
  'scripts/**/*.ts',
]

/**
 * Every filesystem touch the graph builder needs, injected so the whole module is
 * exercisable against an in-memory file map. All paths are repo-relative, POSIX-separated.
 */
export interface GraphDeps {
  /** Repo-relative paths matching a glob from {@link GRAPH_ROOTS}. */
  readonly scan: (pattern: string) => Iterable<string>
  /** File contents, or `null` when the file is unreadable/absent. */
  readonly read: (relPath: string) => string | null
  /** Whether a repo-relative path exists. */
  readonly exists: (relPath: string) => boolean
}

/**
 * Matches static imports/re-exports, `require(...)` and dynamic `import(...)` — but only
 * with a literal relative specifier. Computed specifiers, bare `mock.module(...)` targets
 * and behaviour reached through DI seams are invisible to this graph by construction,
 * which is why callers must treat it as a heuristic and say so out loud.
 */
const IMPORT_PATTERN = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/gu

const TEST_FILE_PATTERN = /\.(?:test|spec)\.tsx?$/u

const JS_EXTENSION = '.js'

const toPosix = (filePath: string): string => filePath.replaceAll('\\', '/')

const isRelativeSpecifier = (spec: string): boolean => spec.startsWith('./') || spec.startsWith('../')

const isTestFile = (filePath: string): boolean => TEST_FILE_PATTERN.test(filePath)

/**
 * Resolution order: `.js`->`.ts`, `.js`->`.tsx`, the literal path, `+ '.ts'`, `+ '/index.ts'`.
 * The repo declares no path aliases, so nothing else can resolve.
 */
const candidatePaths = (base: string): readonly string[] => {
  const rewritten = base.endsWith(JS_EXTENSION)
    ? [`${base.slice(0, -JS_EXTENSION.length)}.ts`, `${base.slice(0, -JS_EXTENSION.length)}.tsx`]
    : []
  return [...rewritten, base, `${base}.ts`, `${base}/index.ts`]
}

/** Resolve one relative import specifier to a repo-relative file, or `null` if nothing matches. */
export function resolveSpecifier(fromFile: string, spec: string, exists: (p: string) => boolean): string | null {
  if (!isRelativeSpecifier(spec)) return null
  const base = path.posix.join(path.posix.dirname(toPosix(fromFile)), spec)
  for (const candidate of candidatePaths(base)) {
    if (exists(candidate)) return candidate
  }
  return null
}

const extractSpecifiers = (content: string): string[] =>
  [...content.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? '').filter((spec) => spec !== '')

const listGraphFiles = (deps: GraphDeps): string[] => {
  const files = new Set<string>()
  for (const pattern of GRAPH_ROOTS) {
    for (const file of deps.scan(pattern)) files.add(toPosix(file))
  }
  return [...files]
}

/** Build `dependency -> importers` over {@link GRAPH_ROOTS}. Unresolvable specifiers are dropped. */
export function buildReverseGraph(deps: GraphDeps): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  for (const file of listGraphFiles(deps)) {
    const content = deps.read(file)
    if (content === null) continue
    for (const spec of extractSpecifiers(content)) {
      const target = resolveSpecifier(file, spec, deps.exists)
      if (target === null) continue
      const importers = graph.get(target)
      if (importers === undefined) graph.set(target, new Set([file]))
      else importers.add(file)
    }
  }
  return graph
}

/**
 * Breadth-LIMITED walk up the importer edges: expand non-test importers for at most `depth`
 * hops, collecting every test file seen along the way. Test files are collected but never
 * expanded through, and `seeds` themselves are never reported. Visited-tracking makes cycles
 * terminate.
 */
export function reachableTests(graph: Map<string, Set<string>>, seeds: readonly string[], depth: number): Set<string> {
  const tests = new Set<string>()
  const visited = new Set<string>(seeds)
  let frontier = [...new Set(seeds)]
  for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
    const next: string[] = []
    for (const file of frontier) {
      for (const importer of graph.get(file) ?? []) {
        if (visited.has(importer)) continue
        visited.add(importer)
        if (isTestFile(importer)) tests.add(importer)
        else next.push(importer)
      }
    }
    frontier = next
  }
  return tests
}

/** Production deps: `Bun.Glob` for scanning plus `node:fs` for reads/probes, rooted at `cwd`. */
export function defaultGraphDeps(cwd: string): GraphDeps {
  return {
    scan: (pattern) => new Glob(pattern).scanSync({ cwd, onlyFiles: true }),
    read: (relPath) => {
      try {
        return fs.readFileSync(path.join(cwd, relPath), 'utf8')
      } catch {
        return null
      }
    },
    exists: (relPath) => fs.existsSync(path.join(cwd, relPath)),
  }
}
