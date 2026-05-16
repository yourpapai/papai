// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

export interface InventoryPackageJson {
  readonly workspaces: readonly string[] | undefined
  readonly scripts: Readonly<Record<string, string>> | undefined
}

const ignoredBaseDirectories = ['.git', 'node_modules', '.turbo']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isStringRecord = (value: unknown): value is Readonly<Record<string, string>> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string')

const normalizeRelativePath = (value: string): string => value.split(path.sep).join('/')

const isWithinRelativeDirectory = (relativePath: string, directoryPath: string): boolean => {
  if (directoryPath.length === 0 || directoryPath === '.') {
    return false
  }

  if (relativePath === directoryPath) {
    return true
  }

  return relativePath.startsWith(`${directoryPath}/`)
}

export const resolveOutputRoot = (repoRoot: string, outputDir: string): string => {
  if (path.isAbsolute(outputDir)) {
    return outputDir
  }

  return path.join(repoRoot, outputDir)
}

export const extractCapabilityStrings = (source: string): readonly string[] =>
  [...source.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)'/gu)].flatMap((match) => {
    const value = match[1]
    return value === undefined || value.length === 0 ? [] : [value]
  })

export const extractToolKeys = (source: string): readonly string[] =>
  [...source.matchAll(/tools\[(?:'|")([a-z_]+)(?:'|")\]\s*=|tools\.([a-z_]+)\s*=/gu)].flatMap((match) => {
    const bracketKey = match[1]
    if (bracketKey !== undefined) {
      return bracketKey.includes('_') ? [bracketKey] : []
    }

    const dottedKey = match[2]
    if (dottedKey !== undefined) {
      return dottedKey.includes('_') ? [dottedKey] : []
    }

    return []
  })

export const ignoredDirectoryPaths = (repoRoot: string, outputDir: string): readonly string[] => {
  const outputRoot = resolveOutputRoot(repoRoot, outputDir)
  const relativeOutputPath = normalizeRelativePath(path.relative(repoRoot, outputRoot))

  return relativeOutputPath.startsWith('..') || path.isAbsolute(relativeOutputPath)
    ? ignoredBaseDirectories
    : [...ignoredBaseDirectories, relativeOutputPath]
}

export const shouldIgnoreRelativePath = (relativePath: string, ignoredDirectories: readonly string[]): boolean =>
  ignoredDirectories.some((directoryPath) => isWithinRelativeDirectory(relativePath, directoryPath))

export const shouldIgnoreAbsoluteDirectory = (absolutePath: string, repoRoot: string, outputDir: string): boolean => {
  const relativePath = normalizeRelativePath(path.relative(repoRoot, absolutePath))
  return shouldIgnoreRelativePath(relativePath, ignoredDirectoryPaths(repoRoot, outputDir))
}

export const parseInventoryPackageJson = (packageJsonText: string): Readonly<InventoryPackageJson> => {
  const parsed = JSON.parse(packageJsonText) as unknown
  if (!isRecord(parsed)) {
    throw new Error('package.json must be an object')
  }

  return {
    workspaces: isStringArray(parsed['workspaces']) ? parsed['workspaces'] : undefined,
    scripts: isStringRecord(parsed['scripts']) ? parsed['scripts'] : undefined,
  }
}

export const filterInputPaths = (
  relativePaths: readonly string[],
  repoRoot: string,
  outputDir: string,
): readonly string[] => {
  const ignoredDirectories = ignoredDirectoryPaths(repoRoot, outputDir)
  return relativePaths.filter((relativePath) => !shouldIgnoreRelativePath(relativePath, ignoredDirectories))
}
