import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'

const HEADER = [
  '// SPDX-License-Identifier: BUSL-1.1',
  '// Copyright (c) 2026 Dmitriy Lazarev',
  '// Use of this software is governed by the Business Source License 1.1.',
  '// See LICENSE in the project root for details.',
  '',
].join('\n')

const SOURCE_ROOTS = ['src', 'client'] as const
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const TEST_PATTERN = /\.(test|spec)\./

const isSourceFile = (filePath: string): boolean =>
  SOURCE_EXTENSIONS.has(extname(filePath)) && !TEST_PATTERN.test(basename(filePath))

const hasHeader = (content: string): boolean =>
  content.split('\n').slice(0, 5).some(line => line.startsWith('// SPDX-License-Identifier:'))

type StampResult = { readonly kind: 'stamped'; readonly path: string } | { readonly kind: 'skipped'; readonly path: string }

async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath)
    } else if (entry.isFile()) {
      yield fullPath
    }
  }
}

const processFile = async (filePath: string, repoRoot: string): Promise<StampResult> => {
  const rel = relative(repoRoot, filePath)
  const content = await readFile(filePath, 'utf-8')
  if (hasHeader(content)) return { kind: 'skipped', path: rel }
  await writeFile(filePath, HEADER + '\n' + content, 'utf-8')
  return { kind: 'stamped', path: rel }
}

const main = async (): Promise<void> => {
  const repoRoot = new URL('..', import.meta.url).pathname
  const results: StampResult[] = []

  for (const root of SOURCE_ROOTS) {
    for await (const filePath of walkFiles(join(repoRoot, root))) {
      if (!isSourceFile(filePath)) continue
      const result = await processFile(filePath, repoRoot)
      results.push(result)
      if (result.kind === 'stamped') process.stdout.write(`  stamped: ${result.path}\n`)
    }
  }

  const stamped = results.filter(r => r.kind === 'stamped').length
  const skipped = results.filter(r => r.kind === 'skipped').length
  process.stdout.write(`\nDone: ${stamped} stamped, ${skipped} skipped\n`)
}

main()
