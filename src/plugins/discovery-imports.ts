// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const STRING_DELIMITER_SET = new Set(["'", '"', '`'])
const WHITESPACE_SET = new Set([' ', '\t', '\n', '\r'])

function readQuotedText(source: string, startIndex: number): { value: string; endIndex: number } | null {
  const quote = source[startIndex]
  if (quote === undefined || !STRING_DELIMITER_SET.has(quote)) return null

  let value = ''
  let index = startIndex + 1

  while (index < source.length) {
    const current = source[index]
    if (current === undefined) break
    if (current === '\\') {
      const escaped = source[index + 1]
      if (escaped === undefined) return null
      value += escaped
      index += 2
      continue
    }
    if (current === quote) {
      return { value, endIndex: index + 1 }
    }

    value += current
    index += 1
  }

  return null
}

function skipWhitespace(source: string, startIndex: number): number {
  let index = startIndex
  while (WHITESPACE_SET.has(source[index] ?? '')) {
    index += 1
  }
  return index
}

export function readLiteralDynamicImports(source: string): string[] {
  const specifiers: string[] = []

  for (let index = 0; index < source.length; ) {
    const quoted = readQuotedText(source, index)
    if (quoted !== null) {
      index = quoted.endIndex
      continue
    }

    if (!source.startsWith('import', index)) {
      index += 1
      continue
    }

    let cursor = skipWhitespace(source, index + 'import'.length)
    if (source[cursor] !== '(') {
      index += 1
      continue
    }

    cursor = skipWhitespace(source, cursor + 1)

    const argument = readQuotedText(source, cursor)
    if (argument === null) {
      throw new Error('Unresolvable plugin dynamic import in source')
    }

    cursor = skipWhitespace(source, argument.endIndex)
    if (source[cursor] !== ')') {
      throw new Error('Unresolvable plugin dynamic import in source')
    }

    specifiers.push(argument.value)
    index = cursor + 1
  }

  return specifiers
}
