// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isMetaProperty,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
  SyntaxKind,
} from 'typescript/unstable/ast'
import type {
  CallExpression,
  ExportDeclaration,
  ImportDeclaration,
  Node,
  SourceFile,
  VariableDeclaration,
} from 'typescript/unstable/ast'

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

type RequireAliasSet = Set<string>

function readDynamicImportSpecifier(node: CallExpression): string | null {
  const [argument] = node.arguments
  if (argument === undefined) return null
  if (isStringLiteral(argument)) return argument.text
  if (isNoSubstitutionTemplateLiteral(argument)) return argument.text
  return null
}

function readImportDeclarationSpecifier(node: ImportDeclaration): string | null {
  return isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null
}

function readExportDeclarationSpecifier(node: ExportDeclaration): string | null {
  return node.moduleSpecifier !== undefined && isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null
}

function isImportMetaRequireCall(node: Node): node is CallExpression {
  return (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'require' &&
    isMetaProperty(node.expression.expression) &&
    node.expression.expression.keywordToken === SyntaxKind.ImportKeyword &&
    node.expression.expression.name.text === 'meta'
  )
}

function isRequireAliasDeclaration(node: Node): node is VariableDeclaration {
  return (
    isVariableDeclaration(node) &&
    isIdentifier(node.name) &&
    node.initializer !== undefined &&
    isPropertyAccessExpression(node.initializer) &&
    node.initializer.name.text === 'require' &&
    isMetaProperty(node.initializer.expression) &&
    node.initializer.expression.keywordToken === SyntaxKind.ImportKeyword &&
    node.initializer.expression.name.text === 'meta'
  )
}

function readRequireAlias(node: Node): string | null {
  if (!isRequireAliasDeclaration(node)) return null
  return isIdentifier(node.name) ? node.name.text : null
}

function isAliasedImportMetaRequireCall(node: Node, aliases: ReadonlySet<string>): node is CallExpression {
  return isCallExpression(node) && isIdentifier(node.expression) && aliases.has(node.expression.text)
}

function collectImportSpecifiers(
  node: Node,
  aliases: ReadonlySet<string>,
  specifiers: {
    staticSpecifiers: string[]
    dynamicSpecifiers: string[]
    importMetaRequireSpecifiers: string[]
  },
): { hasNonDeterministicDynamicImport: boolean; hasNonDeterministicImportMetaRequire: boolean } {
  let hasNonDeterministicDynamicImport = false
  let hasNonDeterministicImportMetaRequire = false

  if (isImportDeclaration(node)) {
    const specifier = readImportDeclarationSpecifier(node)
    if (specifier !== null) specifiers.staticSpecifiers.push(specifier)
  }

  if (isExportDeclaration(node)) {
    const specifier = readExportDeclarationSpecifier(node)
    if (specifier !== null) specifiers.staticSpecifiers.push(specifier)
  }

  if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
    const specifier = readDynamicImportSpecifier(node)
    if (specifier === null) hasNonDeterministicDynamicImport = true
    else specifiers.dynamicSpecifiers.push(specifier)
  }

  if (isImportMetaRequireCall(node) || isAliasedImportMetaRequireCall(node, aliases)) {
    const specifier = readDynamicImportSpecifier(node)
    if (specifier === null) hasNonDeterministicImportMetaRequire = true
    else specifiers.importMetaRequireSpecifiers.push(specifier)
  }

  return { hasNonDeterministicDynamicImport, hasNonDeterministicImportMetaRequire }
}

export function collectImports(sourceFile: SourceFile): ImportScanResult {
  const staticSpecifiers: string[] = []
  const dynamicSpecifiers: string[] = []
  const importMetaRequireSpecifiers: string[] = []
  const requireAliases: RequireAliasSet = new Set()
  let hasNonDeterministicDynamicImport = false
  let hasNonDeterministicImportMetaRequire = false

  function visit(node: Node): void {
    const requireAlias = readRequireAlias(node)
    if (requireAlias !== null) {
      requireAliases.add(requireAlias)
    }

    const result = collectImportSpecifiers(node, requireAliases, {
      staticSpecifiers,
      dynamicSpecifiers,
      importMetaRequireSpecifiers,
    })
    if (result.hasNonDeterministicDynamicImport) {
      hasNonDeterministicDynamicImport = true
    }
    if (result.hasNonDeterministicImportMetaRequire) {
      hasNonDeterministicImportMetaRequire = true
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)

  return {
    staticSpecifiers,
    dynamicSpecifiers,
    importMetaRequireSpecifiers,
    hasNonDeterministicDynamicImport,
    hasNonDeterministicImportMetaRequire,
  }
}
