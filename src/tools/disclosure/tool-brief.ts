// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { getToolMetadata } from '../tool-metadata.js'

export interface ToolBrief {
  name: string
  summary: string
  domain: string
}

const SUMMARY_CAP = 160

function firstSentence(description: string | undefined): string {
  if (description === undefined) return ''
  const trimmed = description.trim()
  if (trimmed === '') return ''
  const match = trimmed.match(/^.*?[.!?](\s|$)/su)
  const sentence = (match === null ? trimmed : match[0]).trim()
  return sentence.length > SUMMARY_CAP ? `${sentence.slice(0, SUMMARY_CAP - 1)}…` : sentence
}

export function buildBriefs(tools: ToolSet): ToolBrief[] {
  const briefs: ToolBrief[] = []
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    briefs.push({
      name,
      summary: firstSentence(t.description),
      domain: getToolMetadata(name)?.domain ?? 'other',
    })
  }
  return briefs
}
