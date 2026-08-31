// Block protected lint-config edits and inline suppression comments before write tools run

import fs from 'node:fs'
import path from 'node:path'

import { parseSync } from 'oxc-parser'

const EDIT_TOOLS = new Set(['write', 'edit', 'multiedit'])
const COMMENTABLE_FILE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/u
const protectedLintConfig = '.oxlintrc.json'

const eslintDirective = ['eslint', 'disable'].join('-')
const oxlintDirective = ['oxlint', 'disable'].join('-')
const tsIgnoreDirective = ['@ts', 'ignore'].join('-')
const tsNoCheckDirective = ['@ts', 'nocheck'].join('-')
const tsExpectErrorDirective = ['@ts', 'expect', 'error'].join('-')

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
  {
    label: tsExpectErrorDirective,
    pattern: new RegExp(`${tsExpectErrorDirective}\\b`, 'u'),
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
 * Comment texts, plus whether the parse that produced them can be trusted to be complete.
 *
 * `oxc-parser` is a parser, not the lexer this check used before TypeScript 7 removed the
 * standalone scanner. It drops comments from text it cannot parse — a fragment beginning
 * mid-block yields `comments: []` with an error — so an empty list from an erroring parse is
 * NOT evidence that no suppression was added. Callers must treat `reliable: false` as
 * "re-measure lexically", never as "nothing found".
 *
 * @param {string} source
 * @param {string} filePath
 * @returns {{ comments: string[], reliable: boolean }}
 */
function extractComments(source, filePath) {
  try {
    const result = parseSync(filePath, source)
    return {
      comments: result.comments.map((comment) => comment.value),
      reliable: result.errors.length === 0,
    }
  } catch {
    return { comments: [], reliable: false }
  }
}

/**
 * Add every directive occurrence in `text` into `counts`, in place.
 *
 * @param {string} text
 * @param {Record<string, number>} counts
 * @returns {Record<string, number>}
 */
function countMatchesIn(text, counts) {
  for (const { label, pattern } of suppressionMatchers) {
    const matches = text.match(new RegExp(pattern.source, 'gu'))
    counts[label] += matches?.length ?? 0
  }
  return counts
}

/**
 * Count directives anywhere in the raw text, comment or not.
 *
 * Deliberately biased toward blocking: it is only reached for text the parser could not analyse,
 * where a false positive costs the author one rephrase and a false negative costs the repo an
 * unnoticed suppression.
 *
 * @param {string} source
 * @returns {Record<string, number>}
 */
function countLexically(source) {
  return countMatchesIn(source, createEmptyCounts())
}

/**
 * @param {string} source
 * @param {string} filePath
 * @returns {{ counts: Record<string, number>, reliable: boolean }}
 */
function analyzeSuppressions(source, filePath) {
  if (!source) return { counts: createEmptyCounts(), reliable: true }

  const { comments, reliable } = extractComments(source, filePath)
  if (!reliable) return { counts: countLexically(source), reliable: false }

  const counts = createEmptyCounts()
  for (const comment of comments) countMatchesIn(comment, counts)
  return { counts, reliable: true }
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
    const { counts: fragmentCounts } = analyzeSuppressions(fragment, filePath)
    for (const { label } of suppressionMatchers) {
      counts[label] += fragmentCounts[label] ?? 0
    }
  }

  return suppressionMatchers.filter(({ label }) => (counts[label] ?? 0) > 0).map(({ label }) => label)
}

/**
 * Suppression labels the edit ADDS, comparing the file on disk against the reconstructed result.
 *
 * Both sides must be measured the same way. A cleanly-parsed "before" compared against a
 * lexically-scanned "after" would report every directive the lexical scan sees in a string
 * literal as newly added, so when either side is unreliable both are re-measured lexically.
 *
 * @param {string} existingContent
 * @param {string} nextContent
 * @param {string} filePath
 * @returns {string[]}
 */
function findAddedLabelsForEdit(existingContent, nextContent, filePath) {
  const before = analyzeSuppressions(existingContent, filePath)
  const after = analyzeSuppressions(nextContent, filePath)
  if (before.reliable && after.reliable) return findAddedLabels(before.counts, after.counts)
  return findAddedLabels(countLexically(existingContent), countLexically(nextContent))
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
        : findAddedLabelsForEdit(existingContent, nextContent, absPath)

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
