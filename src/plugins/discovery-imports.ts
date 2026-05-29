// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import ts from 'typescript'

type ImportScanResult = {
  staticSpecifiers: string[]
  dynamicSpecifiers: string[]
  hasNonDeterministicDynamicImport: boolean
}

function readDynamicImportSpecifier(node: ts.CallExpression): string | null {
  const [argument] = node.arguments
  if (argument === undefined) return null
  if (ts.isStringLiteral(argument)) return argument.text
  if (ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text
  return null
}

function collectImports(sourceFile: ts.SourceFile): ImportScanResult {
  const staticSpecifiers: string[] = []
  const dynamicSpecifiers: string[] = []
  let hasNonDeterministicDynamicImport = false

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier
      if (ts.isStringLiteral(specifier)) {
        staticSpecifiers.push(specifier.text)
      }
    }

    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier
      if (specifier !== undefined && ts.isStringLiteral(specifier)) {
        staticSpecifiers.push(specifier.text)
      }
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = readDynamicImportSpecifier(node)
      if (specifier === null) {
        hasNonDeterministicDynamicImport = true
      } else {
        dynamicSpecifiers.push(specifier)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return { staticSpecifiers, dynamicSpecifiers, hasNonDeterministicDynamicImport }
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
