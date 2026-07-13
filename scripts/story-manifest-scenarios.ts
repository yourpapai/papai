// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import ts from 'typescript'

export type ExtractedStoryScenario = Readonly<{ id: string; checkpoints: readonly string[] }>

function checkpointChain(expression: ts.Expression, thenName: string): readonly string[] | undefined {
  if (ts.isIdentifier(expression)) return expression.text === thenName ? ['then'] : undefined
  if (ts.isCallExpression(expression)) return checkpointChain(expression.expression, thenName)
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  const prefix = checkpointChain(expression.expression, thenName)
  return prefix === undefined ? undefined : [...prefix, expression.name.text]
}

function callbackThenName(callback: ts.Expression): string | undefined {
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined
  const parameter = callback.parameters[0]
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return undefined
  const binding = parameter.name.elements.find((element) => {
    const property = element.propertyName
    return property === undefined
      ? ts.isIdentifier(element.name) && element.name.text === 'then'
      : ts.isIdentifier(property) && property.text === 'then'
  })
  return binding !== undefined && ts.isIdentifier(binding.name) ? binding.name.text : undefined
}

function scenarioCheckpoints(callback: ts.Expression): readonly string[] {
  const thenName = callbackThenName(callback)
  if (thenName === undefined) return []
  const found = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const chain = checkpointChain(node.expression, thenName)
      if (chain !== undefined && chain.length > 1) found.add(chain.join('.'))
    }
    ts.forEachChild(node, visit)
  }
  visit(callback)
  const all = [...found]
  return all.filter((candidate) => !all.some((value) => value.startsWith(`${candidate}.`))).sort()
}

export function extractStoryScenarios(filePath: string, bytes: Uint8Array): readonly ExtractedStoryScenario[] {
  if (!filePath.endsWith('.story.test.ts')) return []
  const source = ts.createSourceFile(filePath, new TextDecoder().decode(bytes), ts.ScriptTarget.Latest, true)
  const scenarios: ExtractedStoryScenario[] = []
  const visit = (node: ts.Node): void => {
    const isScenarioCall =
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'scenario' || node.expression.text === 'executeScenario')
    if (isScenarioCall) {
      const name = node.arguments[0]
      if (name === undefined || !ts.isStringLiteral(name)) {
        throw new Error(`Scenario name must be a string literal in ${filePath}`)
      }
      const callback = node.arguments[1]
      scenarios.push({
        id: `${filePath}#${name.text}`,
        checkpoints: callback === undefined ? [] : scenarioCheckpoints(callback),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return scenarios
}
