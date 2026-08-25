// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  isArrowFunction,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isStringLiteral,
} from 'typescript/unstable/ast'
import type { Expression, Node, SourceFile } from 'typescript/unstable/ast'

import type { SourceParser } from '../../src/ts-ast/source-parser.js'

export type ExtractedStoryScenario = Readonly<{ id: string; checkpoints: readonly string[] }>

function checkpointChain(expression: Expression, thenName: string): readonly string[] | undefined {
  if (isIdentifier(expression)) return expression.text === thenName ? ['then'] : undefined
  if (isCallExpression(expression)) return checkpointChain(expression.expression, thenName)
  if (!isPropertyAccessExpression(expression)) return undefined
  const prefix = checkpointChain(expression.expression, thenName)
  return prefix === undefined ? undefined : [...prefix, expression.name.text]
}

function callbackThenName(callback: Expression): string | undefined {
  if (!isArrowFunction(callback) && !isFunctionExpression(callback)) return undefined
  const parameter = callback.parameters[0]
  if (parameter === undefined || !isObjectBindingPattern(parameter.name)) return undefined
  // TypeScript 7 types a binding element's `name` as optional, unlike 6.x.
  const binding = parameter.name.elements.find((element) => {
    const property = element.propertyName
    if (property !== undefined) return isIdentifier(property) && property.text === 'then'
    return element.name !== undefined && isIdentifier(element.name) && element.name.text === 'then'
  })
  const name = binding?.name
  return name !== undefined && isIdentifier(name) ? name.text : undefined
}

function scenarioCheckpoints(callback: Expression): readonly string[] {
  const thenName = callbackThenName(callback)
  if (thenName === undefined) return []
  const found = new Set<string>()
  const visit = (node: Node): void => {
    if (isCallExpression(node)) {
      const chain = checkpointChain(node.expression, thenName)
      if (chain !== undefined && chain.length > 1) found.add(chain.join('.'))
    }
    node.forEachChild(visit)
  }
  visit(callback)
  const all = [...found]
  return all.filter((candidate) => !all.some((value) => value.startsWith(`${candidate}.`))).sort()
}

export type StoryScenarioSource = Readonly<{ path: string; bytes: Uint8Array }>

/**
 * Batch by design: every caller scans a whole file list, and one parse round
 * trip for the batch is markedly cheaper than one per file.
 */
export async function extractStoryScenarios(
  parser: SourceParser,
  files: readonly StoryScenarioSource[],
): Promise<readonly ExtractedStoryScenario[]> {
  const decoder = new TextDecoder()
  const sources = new Map(
    files.filter((file) => file.path.endsWith('.story.test.ts')).map((file) => [file.path, decoder.decode(file.bytes)]),
  )
  if (sources.size === 0) return []
  const parsed = await parser.parseAll(sources)
  return [...parsed].flatMap(([filePath, source]) => readScenarios(source, filePath))
}

function readScenarios(source: SourceFile, filePath: string): readonly ExtractedStoryScenario[] {
  const scenarios: ExtractedStoryScenario[] = []
  const visit = (node: Node): void => {
    const isScenarioCall =
      isCallExpression(node) &&
      isIdentifier(node.expression) &&
      (node.expression.text === 'scenario' || node.expression.text === 'executeScenario')
    if (isScenarioCall) {
      const name = node.arguments[0]
      if (name === undefined || !isStringLiteral(name)) {
        throw new Error(`Scenario name must be a string literal in ${filePath}`)
      }
      const callback = node.arguments[1]
      scenarios.push({
        id: `${filePath}#${name.text}`,
        checkpoints: callback === undefined ? [] : scenarioCheckpoints(callback),
      })
    }
    node.forEachChild(visit)
  }
  source.forEachChild(visit)
  return scenarios
}
