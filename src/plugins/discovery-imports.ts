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
  hasNonDeterministicImportMetaRequire: boolean
}

type PendingPluginSource = {
  path: string
  fromRequire: boolean
}

type ReadPluginSourceGraphDeps = {
  isRelativePluginImport(specifier: string): boolean
  resolveEntryImport(fromFile: string, pluginDir: string, specifier: string): string
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
  let hasNonDeterministicImportMetaRequire = false

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
      if (specifier === null) {
        hasNonDeterministicImportMetaRequire = true
      } else {
        importMetaRequireSpecifiers.push(specifier)
      }
    }

    ts.forEachChild(node, visit)
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

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile('plugin-source.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
}

function makePendingVisitKey(current: PendingPluginSource): string {
  return `${current.path}::${current.fromRequire ? 'require' : 'import'}`
}

function readPluginDynamicImports(currentPath: string, source: string): string[] {
  try {
    return readLiteralDynamicImports(source)
  } catch {
    throw new Error(`Unresolvable plugin dynamic import in ${currentPath}`)
  }
}

function enqueueResolvedImport(
  pending: PendingPluginSource[],
  currentPath: string,
  pluginDir: string,
  specifier: string,
  fromRequire: boolean,
  deps: ReadPluginSourceGraphDeps,
): void {
  pending.push({ path: deps.resolveEntryImport(currentPath, pluginDir, specifier), fromRequire })
}

function addPendingStaticImports(
  pending: PendingPluginSource[],
  currentPath: string,
  pluginDir: string,
  specifiers: readonly string[],
  deps: ReadPluginSourceGraphDeps,
): void {
  for (const specifier of specifiers) {
    if (!deps.isRelativePluginImport(specifier)) {
      throw new Error(`Bare-module imports are not allowed in plugin entry graphs: ${specifier}`)
    }
    enqueueResolvedImport(pending, currentPath, pluginDir, specifier, false, deps)
  }
}

function addPendingRequireImports(
  pending: PendingPluginSource[],
  current: PendingPluginSource,
  pluginDir: string,
  specifiers: readonly string[],
  deps: ReadPluginSourceGraphDeps,
): void {
  for (const specifier of specifiers) {
    if (!deps.isRelativePluginImport(specifier)) {
      throw new Error(`Bare-module imports are not allowed in plugin entry graphs: ${specifier}`)
    }
    enqueueResolvedImport(pending, current.path, pluginDir, specifier, true, deps)
  }
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
  const result = collectImports(parseSource(source))
  if (result.hasNonDeterministicImportMetaRequire) {
    throw new Error('Unresolvable plugin import.meta.require in source')
  }

  return result.importMetaRequireSpecifiers
}

function readPluginImportMetaRequireSpecifiers(currentPath: string, source: string): string[] {
  try {
    return readLiteralImportMetaRequires(source)
  } catch {
    throw new Error(`Unresolvable plugin import.meta.require in ${currentPath}`)
  }
}

export function readPluginSourceGraph(
  entryPoint: string,
  pluginDir: string,
  deps: ReadPluginSourceGraphDeps,
  readFileSync: (path: string, encoding: 'utf-8') => string,
): string[] {
  const pending: PendingPluginSource[] = [{ path: entryPoint, fromRequire: false }]
  const visited = new Set<string>()
  const ordered: string[] = []

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue

    const visitKey = makePendingVisitKey(current)
    if (visited.has(visitKey)) continue

    visited.add(visitKey)
    if (!ordered.includes(current.path)) ordered.push(current.path)

    const source = readFileSync(current.path, 'utf-8')
    addPendingStaticImports(pending, current.path, pluginDir, readPluginDynamicImports(current.path, source), deps)
    addPendingRequireImports(
      pending,
      current,
      pluginDir,
      readPluginImportMetaRequireSpecifiers(current.path, source),
      deps,
    )
    addPendingStaticImports(pending, current.path, pluginDir, readStaticImportSpecifiers(source), deps)
  }

  return ordered.sort()
}
