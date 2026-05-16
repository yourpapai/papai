// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ReviewerIssueSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.string().min(1),
  file: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  suggestedFix: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const ReviewerIssuesSchema = z.object({
  round: z.number().int().nonnegative(),
  issues: z.array(ReviewerIssueSchema),
})

export const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
  needsPlanning: z.boolean(),
})

export type ReviewerIssue = z.infer<typeof ReviewerIssueSchema>
export type ReviewerIssues = z.infer<typeof ReviewerIssuesSchema>
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>

function parseJsonWithWrapperSupport<T>(text: string, schema: z.ZodType<T>, label: string): T {
  const trimmed = text.trim()

  try {
    return schema.parse(JSON.parse(trimmed))
  } catch {
    const candidates = extractJsonCandidates(trimmed)
    if (candidates.length !== 1) {
      throw new Error(`Expected exactly one JSON object for ${label}, found ${candidates.length}`)
    }

    return schema.parse(JSON.parse(candidates[0] ?? ''))
  }
}

function extractJsonCandidates(text: string): string[] {
  const fencedCandidates = extractFencedJsonCandidates(text)
  if (fencedCandidates.length > 0) {
    return fencedCandidates.filter((candidate) => isParseableJson(candidate))
  }

  return extractTopLevelJsonCandidates(text).filter((candidate) => isParseableJson(candidate))
}

function extractFencedJsonCandidates(text: string): string[] {
  const fencePattern = /```(?:json|jsonc)?\s*([\s\S]*?)```/gi
  const candidates: string[] = []

  for (const match of text.matchAll(fencePattern)) {
    const candidate = match[1]?.trim()
    if (candidate !== undefined && candidate.length > 0) {
      candidates.push(candidate)
    }
  }

  return candidates
}

function extractTopLevelJsonCandidates(text: string): string[] {
  const candidates: string[] = []

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== '{' && char !== '[') {
      continue
    }

    const candidate = readBalancedJson(text, index)
    if (candidate !== null) {
      candidates.push(candidate)
      index += candidate.length - 1
    }
  }

  return candidates
}

function readBalancedJson(text: string, start: number): string | null {
  const opening = text[start]
  if (opening !== '{' && opening !== '[') {
    return null
  }

  const stack: string[] = [opening === '{' ? '}' : ']']
  let inString = false
  let escaped = false

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }

      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      stack.push('}')
      continue
    }

    if (char === '[') {
      stack.push(']')
      continue
    }

    if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
      stack.pop()
      if (stack.length === 0) {
        return text.slice(start, index + 1).trim()
      }
    }
  }

  return null
}

function isParseableJson(candidate: string): boolean {
  try {
    JSON.parse(candidate)
    return true
  } catch {
    return false
  }
}

export function parseReviewerIssues(text: string): ReviewerIssues {
  return parseJsonWithWrapperSupport(text, ReviewerIssuesSchema, 'reviewer issues')
}

export function parseVerifierDecision(text: string): VerifierDecision {
  return parseJsonWithWrapperSupport(text, VerifierDecisionSchema, 'verifier decision')
}
