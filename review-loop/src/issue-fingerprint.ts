// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import type { ReviewerIssue } from './issue-schema.js'

const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

const stripLineReferences = (value: string): string =>
  value.replace(/\b(lines?|line)\s+\d+(?:\s*[-–]\s*\d+)?\b/giu, ' ')

export function computeIssueFingerprint(issue: ReviewerIssue): string {
  const source = [
    normalize(issue.file),
    normalize(issue.title),
    normalize(issue.summary),
    normalize(issue.whyItMatters),
    normalize(stripLineReferences(issue.evidence)),
  ].join('|')

  return createHash('sha256').update(source).digest('hex').slice(0, 16)
}
