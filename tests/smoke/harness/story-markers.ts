// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import ts from '@typescript/typescript6'

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
function isTestCall(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === 'test' || expression.text === 'it'
  if (ts.isPropertyAccessExpression(expression)) return isTestCall(expression.expression)
  if (ts.isCallExpression(expression)) return isTestCall(expression.expression)
  return false
}

function markerKey(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined || !ts.isCallExpression(argument)) return undefined
  if (!ts.isIdentifier(argument.expression) || argument.expression.text !== 'title') return undefined
  const [key] = argument.arguments
  return key !== undefined && ts.isStringLiteral(key) ? key.text : undefined
}

export function scanStoryMarkers(filePath: string, source: string): StoryMarkerScan {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const keys: string[] = []
  const violations: string[] = []

  const visit = (node: ts.Node, calleeOf: ts.CallExpression | undefined): void => {
    if (ts.isCallExpression(node) && node !== calleeOf && isTestCall(node.expression)) {
      const [first] = node.arguments
      const key = markerKey(first)
      if (key === undefined) {
        violations.push(`${filePath}: ${first === undefined ? '<no title argument>' : first.getText(sourceFile)}`)
      } else {
        keys.push(key)
      }
    }
    const innerCallee = ts.isCallExpression(node) && ts.isCallExpression(node.expression) ? node.expression : undefined
    ts.forEachChild(node, (child) => visit(child, innerCallee))
  }

  visit(sourceFile, undefined)
  return Object.freeze({ keys, violations })
}
