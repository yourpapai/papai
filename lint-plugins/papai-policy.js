import fs from 'node:fs'

const eslintDirective = ['eslint', 'disable'].join('-')
const oxlintDirective = ['oxlint', 'disable'].join('-')
const tsIgnoreDirective = ['@ts', 'ignore'].join('-')
const tsNoCheckDirective = ['@ts', 'nocheck'].join('-')
const licenseHeaderLine = '// SPDX-License-Identifier: BUSL-1.1'
const svelteLicenseHeaderLine = '<!-- SPDX-License-Identifier: BUSL-1.1 -->'
const currentYear = new Date().getFullYear()
const copyrightLinePattern = /^\/\/ Copyright \(c\) (\d{4})(?:-(\d{4}))? Dmitriy Lazarev$/u
const svelteCopyrightLinePattern = /^<!-- Copyright \(c\) (\d{4})(?:-(\d{4}))? Dmitriy Lazarev -->$/u
const useLine = '// Use of this software is governed by the Business Source License 1.1.'
const svelteUseLine = '<!-- Use of this software is governed by the Business Source License 1.1. -->'
const detailsLine = '// See LICENSE in the project root for details.'
const svelteDetailsLine = '<!-- See LICENSE in the project root for details. -->'

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

function report(context, nodeOrLoc, message) {
  if ('type' in nodeOrLoc) {
    context.report({ node: nodeOrLoc, message })
    return
  }

  context.report({ loc: nodeOrLoc, message })
}

function isCurrentCopyrightLine(line) {
  const match = copyrightLinePattern.exec(line)
  if (!match) return false

  const startYear = Number.parseInt(match[1], 10)
  const endYear = match[2] === undefined ? startYear : Number.parseInt(match[2], 10)
  return startYear <= endYear && endYear === currentYear
}

function isCurrentSvelteCopyrightLine(line) {
  const match = svelteCopyrightLinePattern.exec(line)
  if (!match) return false

  const startYear = Number.parseInt(match[1], 10)
  const endYear = match[2] === undefined ? startYear : Number.parseInt(match[2], 10)
  return startYear <= endYear && endYear === currentYear
}

function hasFullJsHeader(lines, headerLineIndex) {
  return (
    lines[headerLineIndex] === licenseHeaderLine &&
    isCurrentCopyrightLine(lines[headerLineIndex + 1] ?? '') &&
    lines[headerLineIndex + 2] === useLine &&
    lines[headerLineIndex + 3] === detailsLine
  )
}

function hasFullSvelteHeader(lines, headerLineIndex) {
  return (
    lines[headerLineIndex] === svelteLicenseHeaderLine &&
    isCurrentSvelteCopyrightLine(lines[headerLineIndex + 1] ?? '') &&
    lines[headerLineIndex + 2] === svelteUseLine &&
    lines[headerLineIndex + 3] === svelteDetailsLine
  )
}

function sourceTextForHeaderCheck(context) {
  const filename = context.filename ?? context.getFilename?.()
  if (typeof filename === 'string' && filename.endsWith('.svelte') && fs.existsSync(filename)) {
    return fs.readFileSync(filename, 'utf8')
  }

  return context.sourceCode.text
}

function unwrapParameter(param) {
  if (param.type === 'TSParameterProperty') {
    return param.parameter
  }

  return param
}

function isOptionalIdentifier(node) {
  return node.type === 'Identifier' && node.optional === true
}

function reportOptionalParameterIfNeeded(context, param) {
  const candidate = unwrapParameter(param)

  if (isOptionalIdentifier(candidate)) {
    report(context, candidate, 'Avoid optional parameter syntax; require callers to pass explicit values instead.')
    return
  }

  if (candidate.type === 'AssignmentPattern' && isOptionalIdentifier(candidate.left)) {
    report(context, candidate.left, 'Avoid optional parameter syntax; require callers to pass explicit values instead.')
  }
}

function scanParameters(context, node) {
  for (const param of node.params) {
    reportOptionalParameterIfNeeded(context, param)
  }
}

function rootLogicalExpression(node) {
  let current = node

  while (
    current.parent &&
    current.parent.type === 'LogicalExpression' &&
    (current.parent.operator === '||' || current.parent.operator === '&&')
  ) {
    current = current.parent
  }

  return current
}

function isControlFlowCondition(node) {
  const root = rootLogicalExpression(node)
  const parent = root.parent

  if (!parent) {
    return false
  }

  return (
    (parent.type === 'IfStatement' && parent.test === root) ||
    (parent.type === 'WhileStatement' && parent.test === root) ||
    (parent.type === 'DoWhileStatement' && parent.test === root) ||
    (parent.type === 'ForStatement' && parent.test === root) ||
    (parent.type === 'ConditionalExpression' && parent.test === root)
  )
}

const parameterVisitorNodeTypes = [
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
  'TSConstructorType',
  'TSDeclareFunction',
  'TSFunctionType',
]

function createParameterVisitors(context) {
  return Object.fromEntries(
    parameterVisitorNodeTypes.map((nodeType) => [
      nodeType,
      (node) => {
        scanParameters(context, node)
      },
    ]),
  )
}

const noInlineSuppressionComments = {
  meta: {
    type: 'problem',
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          for (const matcher of suppressionMatchers) {
            if (matcher.pattern.test(comment.value)) {
              report(
                context,
                comment.loc,
                `Avoid inline suppression comments (${matcher.label}); fix the underlying issue instead.`,
              )
              break
            }
          }
        }
      },
    }
  },
}

const requireLicenseHeader = {
  meta: {
    type: 'problem',
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const lines = sourceTextForHeaderCheck(context).split('\n')
        const headerLineIndex = lines[0]?.startsWith('#!') === true ? 1 : 0
        const hasFullHeader = hasFullJsHeader(lines, headerLineIndex) || hasFullSvelteHeader(lines, headerLineIndex)

        if (!hasFullHeader) {
          report(context, node, 'Files must start with the full BUSL-1.1 license header.')
        }
      },
    }
  },
}

const noOptionalTypeSyntax = {
  meta: {
    type: 'problem',
    schema: [],
  },
  create(context) {
    return {
      ...createParameterVisitors(context),
      PropertyDefinition(node) {
        if (node.optional === true) {
          report(context, node, 'Avoid optional property syntax; model absence explicitly instead.')
        }
      },
      TSMethodSignature(node) {
        if (node.optional === true) {
          report(context, node, 'Avoid optional method syntax; model absence explicitly instead.')
        }

        scanParameters(context, node)
      },
      TSPropertySignature(node) {
        if (node.optional === true) {
          report(context, node, 'Avoid optional property syntax; model absence explicitly instead.')
        }
      },
    }
  },
}

const noDefaultValueSyntax = {
  meta: {
    type: 'problem',
    schema: [],
  },
  create(context) {
    return {
      AssignmentPattern(node) {
        report(context, node, 'Avoid default-value syntax; require explicit values and branch deliberately instead.')
      },
    }
  },
}

const noFallbackExpressions = {
  meta: {
    type: 'problem',
    schema: [],
  },
  create(context) {
    return {
      AssignmentExpression(node) {
        if (node.operator === '||=' || node.operator === '??=') {
          report(context, node, 'Avoid fallback assignment operators; branch explicitly instead.')
        }
      },
      LogicalExpression(node) {
        if (node.parent && node.parent.type === 'LogicalExpression' && node.parent.operator === node.operator) {
          return
        }

        if (node.operator === '??') {
          report(context, node, 'Avoid nullish fallback expressions; branch explicitly instead.')
          return
        }

        if (node.operator === '||' && !isControlFlowCondition(node)) {
          report(context, node, 'Avoid value fallback expressions with ||; branch explicitly instead.')
        }
      },
    }
  },
}

export default {
  meta: {
    name: 'papai-policy',
  },
  rules: {
    'require-license-header': requireLicenseHeader,
    'no-inline-suppression-comments': noInlineSuppressionComments,
    'no-optional-type-syntax': noOptionalTypeSyntax,
    'no-default-value-syntax': noDefaultValueSyntax,
    'no-fallback-expressions': noFallbackExpressions,
  },
}
