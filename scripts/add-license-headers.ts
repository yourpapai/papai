// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const SPDX_LINE = '// SPDX-License-Identifier: BUSL-1.1'
const COPYRIGHT_HOLDER = 'Dmitriy Lazarev'
const USE_LINE = '// Use of this software is governed by the Business Source License 1.1.'
const DETAILS_LINE = '// See LICENSE in the project root for details.'
const COPYRIGHT_LINE_PATTERN = /^\/\/ Copyright \(c\) (\d{4})(?:-(\d{4}))? Dmitriy Lazarev$/u

const SOURCE_ROOTS = ['src', 'client', 'scripts', 'review-loop/src', 'tests'] as const
const ROOT_SOURCE_FILES = ['drizzle.config.ts'] as const
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

const isSourceFile = (filePath: string): boolean => SOURCE_EXTENSIONS.has(extname(filePath))

const getCurrentHeaderYear = (): number => {
  const configuredYear = process.env['LICENSE_HEADER_YEAR']
  if (configuredYear === undefined || configuredYear.length === 0) return new Date().getFullYear()

  const parsedYear = Number.parseInt(configuredYear, 10)
  return Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()
}

const copyrightLineForYear = (year: number): string => `// Copyright (c) ${year} ${COPYRIGHT_HOLDER}`

const normalizeCopyrightLine = (line: string | undefined, currentYear: number): string => {
  if (line === undefined) return copyrightLineForYear(currentYear)

  const match = COPYRIGHT_LINE_PATTERN.exec(line)
  if (match === null) return copyrightLineForYear(currentYear)

  const startYearText = match[1]
  if (startYearText === undefined) return copyrightLineForYear(currentYear)

  const startYear = Number.parseInt(startYearText, 10)
  const endYear = match[2] === undefined ? startYear : Number.parseInt(match[2], 10)
  if (currentYear <= endYear) return line

  return `// Copyright (c) ${startYear}-${currentYear} ${COPYRIGHT_HOLDER}`
}

const buildHeader = (copyrightLine: string): string =>
  [SPDX_LINE, copyrightLine, USE_LINE, DETAILS_LINE, '', ''].join('\n')

type StampResult =
  | { readonly kind: 'stamped'; readonly path: string }
  | { readonly kind: 'skipped'; readonly path: string }

const isMissingDirectoryError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const walkFiles = async (dir: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const nestedFiles = await Promise.all(
      entries.map((entry) => {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) return walkFiles(fullPath)
        if (entry.isFile()) return Promise.resolve([fullPath])
        return Promise.resolve([])
      }),
    )
    return nestedFiles.flat()
  } catch (err) {
    if (isMissingDirectoryError(err)) return []
    throw err
  }
}

const existingRootSourceFiles = async (repoRoot: string): Promise<readonly string[]> =>
  (
    await Promise.all(
      ROOT_SOURCE_FILES.map(async (file) => {
        const filePath = join(repoRoot, file)
        try {
          await access(filePath)
          return [filePath]
        } catch (err) {
          if (isMissingDirectoryError(err)) return []
          throw err
        }
      }),
    )
  ).flat()

const addHeader = (content: string, currentYear: number): string => {
  const header = buildHeader(copyrightLineForYear(currentYear))
  if (!content.startsWith('#!')) return header + content

  const [shebang, ...rest] = content.split('\n')
  return [shebang, header + rest.join('\n')].join('\n')
}

const repairShebangHeader = (content: string): string | null => {
  const lines = content.split('\n')
  const shebangIndex = lines.findIndex((line, index) => index > 0 && index <= 6 && line.startsWith('#!'))
  if (shebangIndex === -1) return null

  const shebang = lines[shebangIndex]
  const remainingLines = lines.filter((_, index) => index !== shebangIndex)
  return [shebang, ...remainingLines].join('\n')
}

const headerStartIndex = (lines: readonly string[]): number => {
  const firstLine = lines[0]
  return firstLine !== undefined && firstLine.startsWith('#!') ? 1 : 0
}

const looksLikeHeaderLine = (line: string | undefined): boolean =>
  line !== undefined &&
  (line.startsWith('// Copyright (c) ') || line === USE_LINE || line === DETAILS_LINE || line.length === 0)

const contentAfterHeader = (lines: readonly string[], startIndex: number): readonly string[] => {
  const hasExistingHeaderBlock =
    lines[startIndex] === SPDX_LINE &&
    (looksLikeHeaderLine(lines[startIndex + 1]) ||
      looksLikeHeaderLine(lines[startIndex + 2]) ||
      looksLikeHeaderLine(lines[startIndex + 3]))
  const rest = lines.slice(startIndex + (hasExistingHeaderBlock ? 4 : 1))
  return rest[0] === '' ? rest.slice(1) : rest
}

const updateExistingHeader = (content: string, currentYear: number): string | null => {
  const lines = content.split('\n')
  const startIndex = headerStartIndex(lines)
  if (lines[startIndex] !== SPDX_LINE) return null

  const prefix = startIndex === 1 ? [lines[0]] : []
  const header = buildHeader(normalizeCopyrightLine(lines[startIndex + 1], currentYear))
  return [...prefix, header + contentAfterHeader(lines, startIndex).join('\n')].join('\n')
}

const processFile = async (filePath: string, repoRoot: string): Promise<StampResult> => {
  const rel = relative(repoRoot, filePath)
  const content = await readFile(filePath, 'utf-8')
  const repaired = repairShebangHeader(content)
  const currentYear = getCurrentHeaderYear()
  const baseContent = repaired ?? content
  const updatedContent = updateExistingHeader(baseContent, currentYear) ?? addHeader(baseContent, currentYear)

  if (updatedContent === content) {
    return { kind: 'skipped', path: rel }
  }

  await writeFile(filePath, updatedContent, 'utf-8')
  return { kind: 'stamped', path: rel }
}

const main = async (): Promise<void> => {
  const repoRoot = new URL('..', import.meta.url).pathname
  const files = [
    ...(await Promise.all(SOURCE_ROOTS.map((root) => walkFiles(join(repoRoot, root))))).flat(),
    ...(await existingRootSourceFiles(repoRoot)),
  ]
    .flat()
    .filter(isSourceFile)
  const results = await Promise.all(files.map((filePath) => processFile(filePath, repoRoot)))
  results
    .filter((result) => result.kind === 'stamped')
    .forEach((result) => {
      process.stdout.write(`  stamped: ${result.path}\n`)
    })

  const stamped = results.filter((r) => r.kind === 'stamped').length
  const skipped = results.filter((r) => r.kind === 'skipped').length
  process.stdout.write(`\nDone: ${stamped} stamped, ${skipped} skipped\n`)
}

await main()
