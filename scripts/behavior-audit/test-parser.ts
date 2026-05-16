// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface TestCase {
  readonly name: string
  readonly fullPath: string
  readonly source: string
  readonly startLine: number
  readonly endLine: number
}

export interface ParsedTestFile {
  readonly filePath: string
  readonly tests: readonly TestCase[]
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function countNewlines(text: string, upTo: number): number {
  let count = 0
  for (let i = 0; i < upTo && i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return count
}

type Match = { readonly type: 'describe' | 'test'; readonly name: string; readonly index: number }

function collectMatches(content: string): readonly Match[] {
  const testPattern = /\b(it|test)\s*\(\s*(['"`])(.*?)\2\s*,/gu
  const describePattern = /\bdescribe\s*\(\s*(['"`])(.*?)\1\s*,/gu
  const matches: Match[] = []

  let m: RegExpExecArray | null = null
  while ((m = describePattern.exec(content)) !== null) {
    matches.push({ type: 'describe', name: m[2]!, index: m.index })
  }
  while ((m = testPattern.exec(content)) !== null) {
    matches.push({ type: 'test', name: m[3]!, index: m.index })
  }
  return [...matches].toSorted((a, b) => a.index - b.index)
}

function findEnclosingDescribes(matches: readonly Match[], testIndex: number, content: string): readonly string[] {
  const testMatch = matches[testIndex]!
  const enclosing: string[] = []
  for (const dm of matches) {
    if (dm.type !== 'describe') continue
    if (dm.index >= testMatch.index) break
    const dBrace = content.indexOf('{', dm.index)
    if (dBrace === -1) continue
    const dClose = findMatchingBrace(content, dBrace)
    if (dClose >= testMatch.index) {
      enclosing.push(dm.name)
    }
  }
  return enclosing
}

function matchToTestCase(match: Match, content: string, enclosings: readonly string[]): TestCase | null {
  const afterName = content.indexOf('{', match.index)
  if (afterName === -1) return null

  const closeBrace = findMatchingBrace(content, afterName)
  if (closeBrace === -1) return null

  return {
    name: match.name,
    fullPath: [...enclosings, match.name].join(' > '),
    source: content.slice(match.index, closeBrace + 1),
    startLine: countNewlines(content, match.index) + 1,
    endLine: countNewlines(content, closeBrace) + 1,
  }
}

export function parseTestFile(filePath: string, content: string): ParsedTestFile {
  const matches = collectMatches(content)
  const tests: TestCase[] = []

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!
    if (match.type === 'describe') continue
    const enclosings = findEnclosingDescribes(matches, i, content)
    const testCase = matchToTestCase(match, content, enclosings)
    if (testCase !== null) tests.push(testCase)
  }

  return { filePath, tests }
}
