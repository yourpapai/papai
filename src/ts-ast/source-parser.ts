// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSync, visitorKeys, type Node, type Program } from 'oxc-parser'

/**
 * The AST-scanning seam: parse source text we already hold in memory.
 *
 * Parsing is in-process (`oxc-parser`, the same parser family Bun's own
 * transpiler uses), spawns no child process, and keeps the scanner contracts
 * independent of the TypeScript compiler API. The seam stays **async** even
 * though the underlying parse is synchronous: every caller is async today,
 * and keeping the promise boundary means a future parser swap cannot ripple
 * through call sites again.
 *
 * This module is a frozen story-enforcement input (listed by name in
 * `scripts/story/inputs.ts`), so it takes no repository imports beyond the
 * parser package and stays a single file — see the in-process-ast-scanning
 * design (D7) before splitting it.
 */

export type ParsedProgram = Program

export type SourceParser = {
  /** Parse one source. */
  parse(fileName: string, source: string): Promise<ParsedProgram>
  /** Parse a batch. */
  parseAll(sources: ReadonlyMap<string, string>): Promise<ReadonlyMap<string, ParsedProgram>>
  close(): Promise<void>
}

/**
 * Parse one source. Parse errors are *not* thrown: the scanner contracts are
 * error-tolerant by design — a corrupted story file yields no scenarios and
 * is caught by tree-hash comparison, a broken plugin source mis-scans the
 * same way it always did. oxc performs error recovery and hands back a
 * partial program.
 */
function parseSource(fileName: string, source: string): ParsedProgram {
  return parseSync(fileName, source).program
}

export function createSourceParser(): SourceParser {
  return {
    parse: (fileName, source) => Promise.resolve(parseSource(fileName, source)),

    parseAll: (sources) =>
      Promise.resolve(new Map([...sources].map(([fileName, source]) => [fileName, parseSource(fileName, source)]))),

    close: () => Promise.resolve(),
  }
}

/** Run `use` against a parser, for symmetry with the spawning predecessor. */
export function withSourceParser<T>(use: (parser: SourceParser) => Promise<T>): Promise<T> {
  return use(createSourceParser())
}

// ---------- shared oxc AST traversal ----------
// The three scanners (plugin entry graphs, story scenarios, story markers)
// walk the same oxc AST; these typed helpers live here so the frozen set
// stays one file. `visitorKeys` is oxc's own child map, so traversal covers
// exactly the nodes its Visitor covers.

function isNodeValue(value: unknown): value is Node {
  if (value === null || typeof value !== 'object') return false
  if (!('type' in value)) return false
  return typeof value.type === 'string' && value.type in visitorKeys
}

/** Child nodes of `node`, in field order. */
export function childNodes(node: Node): readonly Node[] {
  const out: Node[] = []
  for (const key of visitorKeys[node.type] ?? []) {
    const value: unknown = Reflect.get(node, key)
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNodeValue(item)) out.push(item)
      }
    } else if (isNodeValue(value)) {
      out.push(value)
    }
  }
  return out
}

/** Visit `node` and every descendant in source order (pre-order). */
export function walkNodes(node: Node, visit: (node: Node) => void): void {
  visit(node)
  for (const child of childNodes(node)) walkNodes(child, visit)
}

/** String value of a real string literal, or undefined for anything else. */
export function stringLiteralValue(node: Node): string | undefined {
  if (node.type !== 'Literal') return undefined
  return typeof node.value === 'string' ? node.value : undefined
}

/** String value of a template literal with no substitutions, else undefined. */
export function plainTemplateValue(node: Node): string | undefined {
  if (node.type !== 'TemplateLiteral') return undefined
  if (node.expressions.length > 0) return undefined
  return node.quasis.map((quasi) => quasi.value.raw).join('')
}
