// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const STRING_DELIMITER_SET = new Set(["'", '"', '`'])
const WHITESPACE_SET = new Set([' ', '\t', '\n', '\r'])

type QuotedText = { value: string; endIndex: number }
type TemplateExpression = { startIndex: number; endIndex: number }

function readQuotedText(source: string, startIndex: number): QuotedText | null {
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

function readTemplateLiteral(
  source: string,
  startIndex: number,
): { endIndex: number; expressions: TemplateExpression[] } | null {
  if (source[startIndex] !== '`') return null

  let index = startIndex + 1
  const expressions: TemplateExpression[] = []
  while (index < source.length) {
    const current = source[index]
    if (current === undefined) break
    if (current === '\\') {
      index += 2
      continue
    }
    if (current === '`') {
      return { endIndex: index + 1, expressions }
    }
    if (current === '$' && source[index + 1] === '{') {
      const expressionEnd = readBalancedExpression(source, index + 2)
      if (expressionEnd === null) return null
      expressions.push({ startIndex: index + 2, endIndex: expressionEnd - 1 })
      index = expressionEnd
      continue
    }

    index += 1
  }

  return null
}

function readBalancedExpression(source: string, startIndex: number): number | null {
  let depth = 1
  let index = startIndex

  while (index < source.length) {
    const nextTriviaIndex = skipTrivia(source, index)
    if (nextTriviaIndex !== index) {
      index = nextTriviaIndex
      continue
    }

    const current = source[index]
    if (current === undefined) break

    const template = current === '`' ? readTemplateLiteral(source, index) : null
    if (template !== null) {
      index = template.endIndex
      continue
    }

    const quoted = readQuotedText(source, index)
    if (quoted !== null) {
      index = quoted.endIndex
      continue
    }

    if (current === '{') {
      depth += 1
      index += 1
      continue
    }

    if (current === '}') {
      depth -= 1
      index += 1
      if (depth === 0) return index
      continue
    }

    index += 1
  }

  return null
}

function readStringLikeEnd(source: string, startIndex: number): number | null {
  const template = readTemplateLiteral(source, startIndex)
  if (template !== null) return template.endIndex
  return readQuotedText(source, startIndex)?.endIndex ?? null
}

function advancePastTriviaOrString(source: string, index: number): number | null {
  const nextTriviaIndex = skipTrivia(source, index)
  if (nextTriviaIndex !== index) return nextTriviaIndex

  if (source[index] === '`') return null

  const quoted = readQuotedText(source, index)
  if (quoted !== null) return quoted.endIndex

  return null
}

function appendTemplateExpressionImports(source: string, index: number, specifiers: string[]): number | null {
  const template = readTemplateLiteral(source, index)
  if (template === null) return null

  for (const expression of template.expressions) {
    specifiers.push(...collectDynamicImports(source.slice(expression.startIndex, expression.endIndex)))
  }

  return template.endIndex
}

function readDynamicImportCall(source: string, index: number): { specifier: string; endIndex: number } | null {
  if (!source.startsWith('import', index)) return null

  let cursor = skipTrivia(source, index + 'import'.length)
  if (source[cursor] !== '(') return null

  cursor = skipTrivia(source, cursor + 1)

  const argument = readQuotedText(source, cursor)
  if (argument === null) {
    throw new Error('Unresolvable plugin dynamic import in source')
  }

  cursor = skipTrivia(source, argument.endIndex)
  if (source[cursor] !== ')') {
    throw new Error('Unresolvable plugin dynamic import in source')
  }

  return { specifier: argument.value, endIndex: cursor + 1 }
}

function collectDynamicImports(source: string): string[] {
  const specifiers: string[] = []

  for (let index = 0; index < source.length; ) {
    const nextIndex = advancePastTriviaOrString(source, index)
    if (nextIndex !== null) {
      index = nextIndex
      continue
    }

    const templateEndIndex = appendTemplateExpressionImports(source, index, specifiers)
    if (templateEndIndex !== null) {
      index = templateEndIndex
      continue
    }

    const dynamicImport = readDynamicImportCall(source, index)
    if (dynamicImport === null) {
      index += 1
      continue
    }

    specifiers.push(dynamicImport.specifier)
    index = dynamicImport.endIndex
  }

  return specifiers
}

function readStaticImportSpecifier(source: string, startIndex: number): { specifier: string; endIndex: number } | null {
  if (!source.startsWith('import', startIndex)) return null

  let cursor = skipTrivia(source, startIndex + 'import'.length)
  const quoted = readQuotedText(source, cursor)
  if (quoted !== null) return { specifier: quoted.value, endIndex: quoted.endIndex }

  const fromIndex = source.indexOf('from', cursor)
  if (fromIndex === -1) return null
  const between = source.slice(cursor, fromIndex)
  if (between.includes(';') || between.includes('\n')) return null

  cursor = skipTrivia(source, fromIndex + 'from'.length)
  const fromQuoted = readQuotedText(source, cursor)
  if (fromQuoted === null) return null

  return { specifier: fromQuoted.value, endIndex: fromQuoted.endIndex }
}

function readStaticExportFromSpecifier(
  source: string,
  startIndex: number,
): { specifier: string; endIndex: number } | null {
  if (!source.startsWith('export', startIndex)) return null

  const fromIndex = source.indexOf('from', startIndex + 'export'.length)
  if (fromIndex === -1) return null
  const between = source.slice(startIndex + 'export'.length, fromIndex)
  if (between.includes(';') || between.includes('\n')) return null

  const cursor = skipTrivia(source, fromIndex + 'from'.length)
  const quoted = readQuotedText(source, cursor)
  if (quoted === null) return null

  return { specifier: quoted.value, endIndex: quoted.endIndex }
}

export function readStaticImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []

  for (let index = 0; index < source.length; ) {
    const nextTriviaIndex = skipTrivia(source, index)
    if (nextTriviaIndex !== index) {
      index = nextTriviaIndex
      continue
    }

    const stringLikeEnd = readStringLikeEnd(source, index)
    if (stringLikeEnd !== null) {
      index = stringLikeEnd
      continue
    }

    const staticImport = readStaticImportSpecifier(source, index)
    if (staticImport !== null) {
      specifiers.push(staticImport.specifier)
      index = staticImport.endIndex
      continue
    }

    const staticExport = readStaticExportFromSpecifier(source, index)
    if (staticExport !== null) {
      specifiers.push(staticExport.specifier)
      index = staticExport.endIndex
      continue
    }

    index += 1
  }

  return specifiers
}

function skipTrivia(source: string, startIndex: number): number {
  let index = startIndex

  while (index < source.length) {
    if (WHITESPACE_SET.has(source[index] ?? '')) {
      index += 1
      continue
    }

    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2)
      if (commentEnd === -1) return index
      index = commentEnd + 2
      continue
    }

    if (source.startsWith('//', index)) {
      const newlineIndex = source.indexOf('\n', index + 2)
      index = newlineIndex === -1 ? source.length : newlineIndex + 1
      continue
    }

    break
  }

  return index
}

export function readLiteralDynamicImports(source: string): string[] {
  return collectDynamicImports(source)
}
