// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isCallExpression, isIdentifier, isPropertyAccessExpression, isStringLiteral } from 'typescript/unstable/ast'
import type { CallExpression, Expression, Node, SourceFile } from 'typescript/unstable/ast'

import type { SourceParser } from '../../../src/ts-ast/source-parser.js'

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
function isTestCall(expression: Expression): boolean {
  if (isIdentifier(expression)) return expression.text === 'test' || expression.text === 'it'
  if (isPropertyAccessExpression(expression)) return isTestCall(expression.expression)
  if (isCallExpression(expression)) return isTestCall(expression.expression)
  return false
}

function markerKey(argument: Expression | undefined): string | undefined {
  if (argument === undefined || !isCallExpression(argument)) return undefined
  if (!isIdentifier(argument.expression) || argument.expression.text !== 'title') return undefined
  const [key] = argument.arguments
  return key !== undefined && isStringLiteral(key) ? key.text : undefined
}

export async function scanStoryMarkers(
  parser: SourceParser,
  filePath: string,
  source: string,
): Promise<StoryMarkerScan> {
  const sourceFile = await parser.parse(filePath, source)
  return readMarkers(sourceFile, filePath)
}

function readMarkers(sourceFile: SourceFile, filePath: string): StoryMarkerScan {
  const keys: string[] = []
  const violations: string[] = []

  const visit = (node: Node, calleeOf: CallExpression | undefined): void => {
    if (isCallExpression(node) && node !== calleeOf && isTestCall(node.expression)) {
      const [first] = node.arguments
      const key = markerKey(first)
      if (key === undefined) {
        violations.push(`${filePath}: ${first === undefined ? '<no title argument>' : first.getText(sourceFile)}`)
      } else {
        keys.push(key)
      }
    }
    const innerCallee = isCallExpression(node) && isCallExpression(node.expression) ? node.expression : undefined
    node.forEachChild((child) => visit(child, innerCallee))
  }

  visit(sourceFile, undefined)
  return Object.freeze({ keys, violations })
}
