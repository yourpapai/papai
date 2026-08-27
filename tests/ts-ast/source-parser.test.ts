// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { childNodes, createSourceParser, walkNodes, withSourceParser } from '../../src/ts-ast/source-parser.js'

describe('createSourceParser', () => {
  test('parses a source to an oxc Program asynchronously', async () => {
    const parser = createSourceParser()
    const program = await parser.parse('a.ts', "import { a } from './a.js'\nconst x = a\n")
    expect(program.type).toBe('Program')
    expect(program.body).toHaveLength(2)
  })

  test('returns an error-tolerant partial program when the source does not parse', async () => {
    const parser = createSourceParser()
    const program = await parser.parse('broken.ts', 'changed without commit\n')
    expect(program.type).toBe('Program')
    expect(program.body).toHaveLength(0)
  })

  test('parseAll maps every file to its own program', async () => {
    const parser = createSourceParser()
    const parsed = await parser.parseAll(
      new Map([
        ['one.ts', 'const one = 1\n'],
        ['two.ts', 'const two = 2\nconst alsoTwo = 2\n'],
      ]),
    )
    expect([...parsed.keys()]).toEqual(['one.ts', 'two.ts'])
    expect(parsed.get('one.ts')?.body).toHaveLength(1)
    expect(parsed.get('two.ts')?.body).toHaveLength(2)
  })

  test('close resolves without work', async () => {
    await expect(createSourceParser().close()).resolves.toBeUndefined()
  })
})

describe('withSourceParser', () => {
  test('passes a working parser and resolves the result', async () => {
    const result = await withSourceParser((parser) => parser.parse('a.ts', 'const x = 1\n'))
    expect(result.type).toBe('Program')
  })
})

describe('oxc AST traversal helpers', () => {
  test('childNodes returns typed child nodes in field order', async () => {
    const parser = createSourceParser()
    const program = await parser.parse('a.ts', 'a.b(1)\n')
    const children = childNodes(program)
    expect(children).toHaveLength(1)
    expect(children[0]?.type).toBe('ExpressionStatement')
  })

  test('walkNodes visits every node in pre-order', async () => {
    const parser = createSourceParser()
    const program = await parser.parse('a.ts', 'a.b(1)\n')
    const visited: string[] = []
    walkNodes(program, (node) => {
      visited.push(node.type)
    })
    expect(visited).toEqual([
      'Program',
      'ExpressionStatement',
      'CallExpression',
      'MemberExpression',
      'Identifier',
      'Identifier',
      'Literal',
    ])
  })
})
