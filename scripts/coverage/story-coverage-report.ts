// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type FileCoverage = Readonly<{
  path: string
  linesFound: number
  linesHit: number
  functionsFound: number
  functionsHit: number
}>

export function formatStoryCoverageReport(lcov: string, limit = 12): string {
  const files = parseFileCoverage(lcov)
    .filter((file) => file.linesHit < file.linesFound || file.functionsHit < file.functionsFound)
    .sort((left, right) => {
      const lineDifference = right.linesFound - right.linesHit - (left.linesFound - left.linesHit)
      if (lineDifference !== 0) return lineDifference
      const functionDifference = right.functionsFound - right.functionsHit - (left.functionsFound - left.functionsHit)
      if (functionDifference === 0) return left.path.localeCompare(right.path)
      return functionDifference
    })
    .slice(0, limit)
  if (files.length === 0) return 'T0 uncovered production files: none'
  return ['T0 uncovered production files:', ...files.map(formatFile)].join('\n')
}

function formatFile(file: FileCoverage): string {
  return `  ${file.path} lines ${file.linesHit}/${file.linesFound} functions ${file.functionsHit}/${file.functionsFound}`
}

function parseFileCoverage(lcov: string): readonly FileCoverage[] {
  return lcov
    .split('end_of_record')
    .map((record) => record.trim())
    .filter((record) => record !== '')
    .map((record) => {
      const lines = record.split('\n')
      const path = lines.find((line) => line.startsWith('SF:'))?.slice(3)
      const functionsFound = numberField(lines, 'FNF')
      const functionsHit = numberField(lines, 'FNH')
      const data = lines.filter((line) => line.startsWith('DA:')).map((line) => Number(line.split(',')[1]))
      const { linesFound, linesHit } = lineTotals(lines, data)
      if (path === undefined) throw new Error('Malformed lcov record: missing source or DA field')
      return Object.freeze({
        path,
        linesFound,
        linesHit,
        functionsFound,
        functionsHit,
      })
    })
}

function lineTotals(
  lines: readonly string[],
  data: readonly number[],
): {
  linesFound: number
  linesHit: number
} {
  if (data.length > 0) {
    return { linesFound: data.length, linesHit: data.filter((hits) => hits > 0).length }
  }
  const found = optionalNumberField(lines, 'LF')
  const hit = optionalNumberField(lines, 'LH')
  if (found === undefined || hit === undefined) {
    throw new Error('Malformed lcov record: missing source or DA field')
  }
  return { linesFound: found, linesHit: hit }
}

function optionalNumberField(lines: readonly string[], field: 'LF' | 'LH'): number | undefined {
  const value = lines.find((line) => line.startsWith(`${field}:`))?.slice(field.length + 1)
  if (value === undefined || !/^\d+$/u.test(value)) return undefined
  return Number(value)
}

function numberField(lines: readonly string[], field: 'FNF' | 'FNH'): number {
  const value = lines.find((line) => line.startsWith(`${field}:`))?.slice(field.length + 1)
  if (value === undefined || !/^\d+$/u.test(value)) throw new Error(`Malformed lcov record: missing ${field}`)
  return Number(value)
}
