// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Node } from 'oxc-parser'

import { plainTemplateValue, stringLiteralValue, walkNodes, type ParsedProgram } from '../ts-ast/source-parser.js'

/**
 * Reads what a single plugin source imports: static specifiers, literal dynamic
 * imports, and `import.meta.require` calls (including through a local alias).
 *
 * A non-literal specifier is reported as a flag rather than skipped. Plugin
 * entry graphs must be resolvable ahead of time, so an import the scanner
 * cannot pin down has to fail discovery instead of passing unnoticed — which is
 * why this reads a real syntax tree rather than a cheaper import scanner.
 */
export type ImportScanResult = {
  staticSpecifiers: string[]
  dynamicSpecifiers: string[]
  importMetaRequireSpecifiers: string[]
  hasNonDeterministicDynamicImport: boolean
  hasNonDeterministicImportMetaRequire: boolean
}

type ScanSink = {
  staticSpecifiers: string[]
  dynamicSpecifiers: string[]
  importMetaRequireSpecifiers: string[]
  requireAliases: Set<string>
  hasNonDeterministicDynamicImport: boolean
  hasNonDeterministicImportMetaRequire: boolean
}

/** `import.meta` as oxc shapes it: a MetaProperty with meta/property names. */
function isImportMeta(node: Node): boolean {
  return node.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta'
}

/** `import.meta.require` as a static member access. */
function isRequireMemberExpression(node: Node): boolean {
  if (node.type !== 'MemberExpression') return false
  if (node.computed || node.property.type !== 'Identifier') return false
  return node.property.name === 'require' && isImportMeta(node.object)
}

/** Literal or substitution-free-template specifier, else undefined. */
function literalSpecifier(node: Node): string | undefined {
  return stringLiteralValue(node) ?? plainTemplateValue(node)
}

function scanVariableDeclarator(node: Node, sink: ScanSink): void {
  if (node.type !== 'VariableDeclarator') return
  if (node.id.type !== 'Identifier' || node.init === null) return
  if (isRequireMemberExpression(node.init)) sink.requireAliases.add(node.id.name)
}

function scanModuleDeclaration(node: Node, sink: ScanSink): void {
  if (
    node.type !== 'ImportDeclaration' &&
    node.type !== 'ExportNamedDeclaration' &&
    node.type !== 'ExportAllDeclaration'
  ) {
    return
  }
  if (node.source === null) return
  const specifier = stringLiteralValue(node.source)
  if (specifier !== undefined) sink.staticSpecifiers.push(specifier)
}

function scanImportExpression(node: Node, sink: ScanSink): void {
  if (node.type !== 'ImportExpression') return
  const specifier = literalSpecifier(node.source)
  if (specifier === undefined) sink.hasNonDeterministicDynamicImport = true
  else sink.dynamicSpecifiers.push(specifier)
}

function scanRequireCall(node: Node, sink: ScanSink): void {
  if (node.type !== 'CallExpression') return
  const isAliasCall = node.callee.type === 'Identifier' && sink.requireAliases.has(node.callee.name)
  if (!isRequireMemberExpression(node.callee) && !isAliasCall) return
  const argument = node.arguments[0]
  if (argument === undefined) {
    sink.hasNonDeterministicImportMetaRequire = true
    return
  }
  const specifier = literalSpecifier(argument)
  if (specifier === undefined) sink.hasNonDeterministicImportMetaRequire = true
  else sink.importMetaRequireSpecifiers.push(specifier)
}

export function collectImports(program: ParsedProgram): ImportScanResult {
  const sink: ScanSink = {
    staticSpecifiers: [],
    dynamicSpecifiers: [],
    importMetaRequireSpecifiers: [],
    requireAliases: new Set<string>(),
    hasNonDeterministicDynamicImport: false,
    hasNonDeterministicImportMetaRequire: false,
  }

  walkNodes(program, (node) => {
    scanVariableDeclarator(node, sink)
    scanModuleDeclaration(node, sink)
    scanImportExpression(node, sink)
    scanRequireCall(node, sink)
  })

  return {
    staticSpecifiers: sink.staticSpecifiers,
    dynamicSpecifiers: sink.dynamicSpecifiers,
    importMetaRequireSpecifiers: sink.importMetaRequireSpecifiers,
    hasNonDeterministicDynamicImport: sink.hasNonDeterministicDynamicImport,
    hasNonDeterministicImportMetaRequire: sink.hasNonDeterministicImportMetaRequire,
  }
}
