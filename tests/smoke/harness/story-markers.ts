// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Node } from 'oxc-parser'

import {
  childNodes,
  stringLiteralValue,
  type ParsedProgram,
  type SourceParser,
} from '../../../src/ts-ast/source-parser.js'

/**
 * Tier 2/3 scenario files name their tests through a local `title()` helper that
 * reads the registry, so an unregistered scenario has no title to use — unless
 * an author bypasses the helper and passes a literal. `violations` is what makes
 * that bypass fail a test instead of going unnoticed.
 */
export type StoryMarkerScan = Readonly<{ keys: readonly string[]; violations: readonly string[] }>

/**
 * Matches `test(...)`, `test.skip(...)`, and `test.skipIf(cond)(...)`, plus the
 * same shapes under bun:test's `it` alias. No scenario file uses `it` today, but
 * an unrecognized declarator is a *silent* miss — neither a key nor a violation —
 * which is the exact blind spot this scanner exists to remove.
 */
function isTestCall(expression: Node): boolean {
  if (expression.type === 'Identifier') return expression.name === 'test' || expression.name === 'it'
  if (expression.type === 'MemberExpression') return isTestCall(expression.object)
  if (expression.type === 'CallExpression') return isTestCall(expression.callee)
  return false
}

function markerKey(argument: Node | undefined): string | undefined {
  if (argument === undefined || argument.type !== 'CallExpression') return undefined
  if (argument.callee.type !== 'Identifier' || argument.callee.name !== 'title') return undefined
  const [key] = argument.arguments
  if (key === undefined) return undefined
  return stringLiteralValue(key)
}

export async function scanStoryMarkers(
  parser: SourceParser,
  filePath: string,
  source: string,
): Promise<StoryMarkerScan> {
  const program = await parser.parse(filePath, source)
  return readMarkers(program, filePath, source)
}

function readMarkers(program: ParsedProgram, filePath: string, source: string): StoryMarkerScan {
  const keys: string[] = []
  const violations: string[] = []

  const visit = (node: Node, calleeOf: Node | undefined): void => {
    if (node.type === 'CallExpression' && node !== calleeOf && isTestCall(node.callee)) {
      const [first] = node.arguments
      const key = markerKey(first)
      if (key === undefined) {
        violations.push(
          `${filePath}: ${first === undefined ? '<no title argument>' : source.slice(first.start, first.end)}`,
        )
      } else {
        keys.push(key)
      }
    }
    const innerCallee =
      node.type === 'CallExpression' && node.callee.type === 'CallExpression' ? node.callee : undefined
    for (const child of childNodes(node)) visit(child, innerCallee)
  }

  visit(program, undefined)
  return Object.freeze({ keys, violations })
}
