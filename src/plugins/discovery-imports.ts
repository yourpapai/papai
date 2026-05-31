// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import ts from 'typescript'

type ImportScanResult = {
  staticSpecifiers: string[]
  dynamicSpecifiers: string[]
  importMetaRequireSpecifiers: string[]
  hasNonDeterministicDynamicImport: boolean
}

function readDynamicImportSpecifier(node: ts.CallExpression): string | null {
  const [argument] = node.arguments
  if (argument === undefined) return null
  if (ts.isStringLiteral(argument)) return argument.text
  if (ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text
  return null
}

function readImportDeclarationSpecifier(node: ts.ImportDeclaration): string | null {
  return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null
}

function readExportDeclarationSpecifier(node: ts.ExportDeclaration): string | null {
  return node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : null
}

function isImportMetaRequireCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'require' &&
    ts.isMetaProperty(node.expression.expression) &&
    node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.expression.name.text === 'meta'
  )
}

function collectImports(sourceFile: ts.SourceFile): ImportScanResult {
  const staticSpecifiers: string[] = []
  const dynamicSpecifiers: string[] = []
  const importMetaRequireSpecifiers: string[] = []
  let hasNonDeterministicDynamicImport = false

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const specifier = readImportDeclarationSpecifier(node)
      if (specifier !== null) staticSpecifiers.push(specifier)
    }

    if (ts.isExportDeclaration(node)) {
      const specifier = readExportDeclarationSpecifier(node)
      if (specifier !== null) staticSpecifiers.push(specifier)
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = readDynamicImportSpecifier(node)
      if (specifier === null) {
        hasNonDeterministicDynamicImport = true
      } else {
        dynamicSpecifiers.push(specifier)
      }
    }

    if (isImportMetaRequireCall(node)) {
      const specifier = readDynamicImportSpecifier(node)
      if (specifier !== null) importMetaRequireSpecifiers.push(specifier)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return { staticSpecifiers, dynamicSpecifiers, importMetaRequireSpecifiers, hasNonDeterministicDynamicImport }
}

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile('plugin-source.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
}

export function readStaticImportSpecifiers(source: string): string[] {
  return collectImports(parseSource(source)).staticSpecifiers
}

export function readLiteralDynamicImports(source: string): string[] {
  const result = collectImports(parseSource(source))
  if (result.hasNonDeterministicDynamicImport) {
    throw new Error('Unresolvable plugin dynamic import in source')
  }

  return result.dynamicSpecifiers
}

export function readLiteralImportMetaRequires(source: string): string[] {
  return collectImports(parseSource(source)).importMetaRequireSpecifiers
}
