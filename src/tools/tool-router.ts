// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { logger } from '../logger.js'
import { getToolMetadata, type ToolClassification, type ToolDomain } from './tool-metadata.js'

const log = logger.child({ scope: 'tool-router' })

export type ToolRoutingIntent =
  | 'trivial'
  | 'task_read'
  | 'task_mutation'
  | 'memo'
  | 'recurring'
  | 'deferred'
  | 'web'
  | 'identity'
  | 'full'

export type ToolRoutingDecision = {
  intent: ToolRoutingIntent
  confidence: number
  reason: string
}

export type ToolRoutingResult = {
  tools: ToolSet
  decision: ToolRoutingDecision
  fullToolCount: number
  exposedToolCount: number
}

// Route only when deterministic keyword evidence is strong; otherwise keep all tools as a safe fallback.
const HIGH_CONFIDENCE = 0.65

const TRIVIAL_RE = /^(?:thanks|thank you|thx|ok|okay|cool|great|nice|hi|hello|hey)[!. ]*$/i
const URL_RE = /\bhttps?:\/\/\S+/i
const MEMO_RE = /\b(?:remember|memo|note that|personal note|save (?:this )?(?:note|memo))\b/i
const RECURRING_RE =
  /\b(?:recurring|repeat|repeating|every day|every week|every month|daily|weekly|monthly|pause recurring|resume recurring|skip recurring)\b/i
const DEFERRED_RE = /\b(?:remind me|notify me|alert me|later|tomorrow|briefing|daily brief|scheduled prompt)\b/i
const IDENTITY_RE = /\b(?:i am|i'm|my login is|link me|my username is|identity)\b/i
const MUTATION_RE =
  /\b(?:create|add|make|update|move|set|assign|delete|remove|close|resolve|reopen|comment|attach|upload|log work|vote|watch)\b/i
const READ_RE = /\b(?:list|show|find|search|what|which|status|details|comments?|history|who|where)\b/i

const READ_DOMAINS = new Set<ToolDomain>([
  'task',
  'project',
  'comment',
  'attachment',
  'work',
  'history',
  'query',
  'time',
])
const MUTATION_DOMAINS = new Set<ToolDomain>([
  'task',
  'project',
  'status',
  'label',
  'comment',
  'attachment',
  'work',
  'sprint',
  'collaboration',
  'identity',
  'time',
])
const MEMO_DOMAINS = new Set<ToolDomain>(['memo', 'time', 'web'])
const RECURRING_DOMAINS = new Set<ToolDomain>(['recurring', 'task', 'project', 'status', 'label', 'time'])
const DEFERRED_DOMAINS = new Set<ToolDomain>(['deferred', 'task', 'project', 'status', 'label', 'time', 'web'])
const WEB_DOMAINS = new Set<ToolDomain>(['web', 'task', 'project', 'memo', 'time'])
const IDENTITY_DOMAINS = new Set<ToolDomain>(['identity', 'collaboration', 'time'])

export function classifyToolRoutingIntent(userText: string): ToolRoutingDecision {
  log.debug({ textLength: userText.length }, 'classifyToolRoutingIntent')
  const text = userText.trim()
  if (text.length === 0) return { intent: 'trivial', confidence: 0.95, reason: 'empty-message' }
  if (TRIVIAL_RE.test(text)) return { intent: 'trivial', confidence: 0.95, reason: 'trivial-acknowledgement' }
  if (URL_RE.test(text)) return { intent: 'web', confidence: 0.9, reason: 'contains-public-url' }
  if (MEMO_RE.test(text)) return { intent: 'memo', confidence: 0.85, reason: 'memo-keyword' }
  if (RECURRING_RE.test(text)) return { intent: 'recurring', confidence: 0.85, reason: 'recurring-keyword' }
  if (IDENTITY_RE.test(text)) return { intent: 'identity', confidence: 0.8, reason: 'identity-keyword' }
  if (MUTATION_RE.test(text)) return { intent: 'task_mutation', confidence: 0.78, reason: 'mutation-keyword' }
  if (DEFERRED_RE.test(text)) return { intent: 'deferred', confidence: 0.78, reason: 'deferred-keyword' }
  if (READ_RE.test(text)) return { intent: 'task_read', confidence: 0.75, reason: 'read-keyword' }
  return { intent: 'full', confidence: 0.4, reason: 'uncertain-intent' }
}

function shouldKeepForIntent(intent: ToolRoutingIntent, metadata: ToolClassification | undefined): boolean {
  if (metadata === undefined) return intent === 'full'
  if (intent === 'full') return true
  if (intent === 'trivial') return false
  if (intent === 'task_read') return metadata.risk === 'read' && READ_DOMAINS.has(metadata.domain)
  if (intent === 'task_mutation') return MUTATION_DOMAINS.has(metadata.domain)
  if (intent === 'memo') return MEMO_DOMAINS.has(metadata.domain)
  if (intent === 'recurring') return RECURRING_DOMAINS.has(metadata.domain)
  if (intent === 'deferred') return DEFERRED_DOMAINS.has(metadata.domain)
  if (intent === 'web') return WEB_DOMAINS.has(metadata.domain)
  if (intent === 'identity') return IDENTITY_DOMAINS.has(metadata.domain)
  return true
}

function filterTools(fullTools: ToolSet, decision: ToolRoutingDecision): ToolSet {
  if (decision.intent === 'full' || decision.confidence < HIGH_CONFIDENCE) return fullTools
  const routedTools: ToolSet = {}
  for (const [name, tool] of Object.entries(fullTools)) {
    if (shouldKeepForIntent(decision.intent, getToolMetadata(name))) {
      routedTools[name] = tool
    }
  }
  return routedTools
}

export function routeToolsForMessage(userText: string, fullTools: ToolSet): ToolRoutingResult {
  log.debug({ textLength: userText.length, fullToolCount: Object.keys(fullTools).length }, 'routeToolsForMessage')
  const decision = classifyToolRoutingIntent(userText)
  const tools = filterTools(fullTools, decision)
  return {
    tools,
    decision,
    fullToolCount: Object.keys(fullTools).length,
    exposedToolCount: Object.keys(tools).length,
  }
}
