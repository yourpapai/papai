// Block protected lint-config edits and inline suppression comments before write tools run

import fs from 'node:fs'
import path from 'node:path'

import * as ts from 'typescript'

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])
const COMMENTABLE_FILE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/u
const protectedLintConfig = '.oxlintrc.json'

const eslintDirective = ['eslint', 'disable'].join('-')
const oxlintDirective = ['oxlint', 'disable'].join('-')
const tsIgnoreDirective = ['@ts', 'ignore'].join('-')
const tsNoCheckDirective = ['@ts', 'nocheck'].join('-')

const suppressionMatchers = [
  {
    label: eslintDirective,
    pattern: new RegExp(`\\b${eslintDirective}(?:-next-line|-line)?\\b`, 'u'),
  },
  {
    label: oxlintDirective,
    pattern: new RegExp(`\\b${oxlintDirective}(?:-next-line|-line)?\\b`, 'u'),
  },
  {
    label: tsIgnoreDirective,
    pattern: new RegExp(`${tsIgnoreDirective}\\b`, 'u'),
  },
  {
    label: tsNoCheckDirective,
    pattern: new RegExp(`${tsNoCheckDirective}\\b`, 'u'),
  },
]

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {Record<string, number>} beforeCounts
 * @param {Record<string, number>} afterCounts
 * @returns {string[]}
 */
function findAddedLabels(beforeCounts, afterCounts) {
  return suppressionMatchers
    .filter(({ label }) => (afterCounts[label] ?? 0) > (beforeCounts[label] ?? 0))
    .map(({ label }) => label)
}

/**
 * @returns {Record<string, number>}
 */
function createEmptyCounts() {
  return Object.fromEntries(suppressionMatchers.map(({ label }) => [label, 0]))
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isCommentableFile(filePath) {
  return COMMENTABLE_FILE_PATTERN.test(filePath)
}

/**
 * @param {string} filePath
 * @returns {ts.LanguageVariant}
 */
function getLanguageVariant(filePath) {
  const normalized = filePath.toLowerCase()
  if (normalized.endsWith('.jsx') || normalized.endsWith('.tsx')) {
    return ts.LanguageVariant.JSX
  }
  return ts.LanguageVariant.Standard
}

/**
 * @param {string} source
 * @param {string} filePath
 * @returns {string[]}
 */
function extractComments(source, filePath) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, getLanguageVariant(filePath), source)
  const comments = []

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      comments.push(scanner.getTokenText())
    }
  }

  return comments
}

/**
 * @param {string} source
 * @param {string} filePath
 * @returns {Record<string, number>}
 */
function countSuppressions(source, filePath) {
  const counts = createEmptyCounts()
  if (!source) return counts

  for (const comment of extractComments(source, filePath)) {
    for (const { label, pattern } of suppressionMatchers) {
      const matches = comment.match(new RegExp(pattern.source, 'gu'))
      counts[label] += matches?.length ?? 0
    }
  }

  return counts
}

/**
 * @param {string} absPath
 * @returns {string}
 */
function readExistingContent(absPath) {
  if (!fs.existsSync(absPath)) return ''
  return fs.readFileSync(absPath, 'utf8')
}

/**
 * @param {Record<string, unknown>} edit
 * @returns {string | null}
 */
function getNewString(edit) {
  if (typeof edit.newString === 'string') return edit.newString
  if (typeof edit.new_string === 'string') return edit.new_string
  if (typeof edit.newText === 'string') return edit.newText
  if (typeof edit.new_text === 'string') return edit.new_text
  return null
}

/**
 * @param {Record<string, unknown>} edit
 * @returns {string | null}
 */
function getOldString(edit) {
  if (typeof edit.oldString === 'string') return edit.oldString
  if (typeof edit.old_string === 'string') return edit.old_string
  if (typeof edit.oldText === 'string') return edit.oldText
  if (typeof edit.old_text === 'string') return edit.old_text
  return null
}

/**
 * @param {string | undefined} toolName
 * @param {Record<string, unknown>} toolInput
 * @returns {string | null}
 */
function resolveToolName(toolName, toolInput) {
  if (typeof toolName === 'string' && EDIT_TOOLS.has(toolName)) {
    return toolName
  }

  if (Array.isArray(toolInput.edits) || Array.isArray(toolInput.changes)) {
    return 'multiedit'
  }

  if (typeof toolInput.content === 'string') {
    return 'write'
  }

  if (getOldString(toolInput) !== null || getNewString(toolInput) !== null) {
    return 'edit'
  }

  return null
}

/**
 * @param {string} source
 * @param {Record<string, unknown>} edit
 * @returns {string | null}
 */
function applyEdit(source, edit) {
  const oldString = getOldString(edit)
  const newString = getNewString(edit)
  if (!oldString || newString === null) return null
  if (!source.includes(oldString)) return null

  if (edit.replaceAll === true || edit.replace_all === true) {
    return source.split(oldString).join(newString)
  }

  const index = source.indexOf(oldString)
  return source.slice(0, index) + newString + source.slice(index + oldString.length)
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} toolInput
 * @param {string} existingContent
 * @returns {string | null}
 */
function buildResultingContent(toolName, toolInput, existingContent) {
  if (toolName === 'write') {
    return typeof toolInput.content === 'string' ? toolInput.content : null
  }

  if (toolName === 'edit') {
    return applyEdit(existingContent, toolInput)
  }

  if (toolName !== 'multiedit') return null

  const edits = Array.isArray(toolInput.edits)
    ? toolInput.edits
    : Array.isArray(toolInput.changes)
      ? toolInput.changes
      : null
  if (!edits) return null

  let current = existingContent
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') return null
    const updated = applyEdit(current, edit)
    if (updated === null) return null
    current = updated
  }
  return current
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} toolInput
 * @returns {string[]}
 */
function getPayloadFragments(toolName, toolInput) {
  if (toolName === 'write') {
    return typeof toolInput.content === 'string' ? [toolInput.content] : []
  }

  if (toolName === 'edit') {
    const next = getNewString(toolInput)
    return next === null ? [] : [next]
  }

  if (toolName !== 'multiedit') return []

  const edits = Array.isArray(toolInput.edits)
    ? toolInput.edits
    : Array.isArray(toolInput.changes)
      ? toolInput.changes
      : []

  return edits.flatMap((edit) => {
    if (!edit || typeof edit !== 'object') return []
    const next = getNewString(edit)
    return next === null ? [] : [next]
  })
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} toolInput
 * @param {string} filePath
 * @returns {string[]}
 */
function findPayloadLabels(toolName, toolInput, filePath) {
  const counts = createEmptyCounts()

  for (const fragment of getPayloadFragments(toolName, toolInput)) {
    const fragmentCounts = countSuppressions(fragment, filePath)
    for (const { label } of suppressionMatchers) {
      counts[label] += fragmentCounts[label] ?? 0
    }
  }

  return suppressionMatchers.filter(({ label }) => (counts[label] ?? 0) > 0).map(({ label }) => label)
}

/**
 * @param {string} absPath
 * @param {string} cwd
 * @returns {boolean}
 */
function isProtectedLintConfig(absPath, cwd) {
  return path.resolve(cwd, protectedLintConfig) === absPath
}

/**
 * @param {{ tool_name?: string, tool_input: Record<string, unknown> & { file_path?: string }, cwd: string }} ctx
 * @returns {BlockResult | null}
 */
export function enforceWritePolicy(ctx) {
  try {
    const { tool_name, tool_input, cwd } = ctx
    const resolvedToolName = resolveToolName(tool_name, tool_input)
    if (!resolvedToolName) return null

    const filePath = tool_input.file_path
    if (typeof filePath !== 'string' || filePath.length === 0) return null

    const absPath = path.resolve(cwd, filePath)
    const relPath = path.relative(cwd, absPath).replace(/\\/gu, '/')

    if (isProtectedLintConfig(absPath, cwd)) {
      return {
        decision: 'block',
        reason:
          `Cannot modify \`${protectedLintConfig}\`.\n\n` +
          `Repo-wide lint policy is protected by hooks. Fix the underlying code instead of loosening the rules.`,
      }
    }

    if (!isCommentableFile(absPath)) return null

    const existingContent = readExistingContent(absPath)
    const nextContent = buildResultingContent(resolvedToolName, tool_input, existingContent)

    const addedLabels =
      nextContent === null
        ? findPayloadLabels(resolvedToolName, tool_input, absPath)
        : findAddedLabels(countSuppressions(existingContent, absPath), countSuppressions(nextContent, absPath))

    if (addedLabels.length === 0) return null

    return {
      decision: 'block',
      reason:
        `Cannot add inline lint suppression comments to \`${relPath}\`.\n\n` +
        `Blocked markers: ${addedLabels.map((label) => `\`${label}\``).join(', ')}\n\n` +
        `Fix the underlying issue instead of suppressing the rule.`,
    }
  } catch {
    return null
  }
}
