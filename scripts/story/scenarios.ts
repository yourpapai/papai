// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Node } from 'oxc-parser'

import { walkNodes, type ParsedProgram, type SourceParser } from '../../src/ts-ast/source-parser.js'

export type ExtractedStoryScenario = Readonly<{ id: string; checkpoints: readonly string[] }>

function checkpointChain(expression: Node, thenName: string): readonly string[] | undefined {
  if (expression.type === 'Identifier') {
    return expression.name === thenName ? ['then'] : undefined
  }
  if (expression.type === 'CallExpression') {
    return checkpointChain(expression.callee, thenName)
  }
  if (expression.type !== 'MemberExpression' || expression.computed) return undefined
  if (expression.property.type !== 'Identifier') return undefined
  const prefix = checkpointChain(expression.object, thenName)
  if (prefix === undefined) return undefined
  return [...prefix, expression.property.name]
}

function callbackThenName(callback: Node): string | undefined {
  if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') return undefined
  const [parameter] = callback.params
  if (parameter === undefined || parameter.type !== 'ObjectPattern') return undefined
  const binding = parameter.properties.find((property): boolean => {
    if (property.type !== 'Property' || property.key.type !== 'Identifier') return false
    return property.key.name === 'then'
  })
  if (binding === undefined) return undefined
  const value = binding.value
  if (value === null || value === undefined) return undefined
  if (value.type !== 'Identifier') return undefined
  return value.name
}

function scenarioCheckpoints(callback: Node): readonly string[] {
  const thenName = callbackThenName(callback)
  if (thenName === undefined) return []
  const found = new Set<string>()
  walkNodes(callback, (node) => {
    if (node.type !== 'CallExpression') return
    const chain = checkpointChain(node.callee, thenName)
    if (chain !== undefined && chain.length > 1) found.add(chain.join('.'))
  })
  const all = [...found]
  return all.filter((candidate) => !all.some((value) => value.startsWith(`${candidate}.`))).sort()
}

export type StoryScenarioSource = Readonly<{ path: string; bytes: Uint8Array }>

/**
 * Batch by design: every caller scans a whole file list, so one pass over the
 * batch serves every file.
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
  return [...parsed].flatMap(([filePath, program]) => readScenarios(program, filePath))
}

function readScenarios(program: ParsedProgram, filePath: string): readonly ExtractedStoryScenario[] {
  const scenarios: ExtractedStoryScenario[] = []
  walkNodes(program, (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return
    if (node.callee.name !== 'scenario' && node.callee.name !== 'executeScenario') return
    const [name, callback] = node.arguments
    if (name === undefined || name.type !== 'Literal' || typeof name.value !== 'string') {
      throw new Error(`Scenario name must be a string literal in ${filePath}`)
    }
    scenarios.push({
      id: `${filePath}#${name.value}`,
      checkpoints: callback === undefined ? [] : scenarioCheckpoints(callback),
    })
  })
  return scenarios
}
