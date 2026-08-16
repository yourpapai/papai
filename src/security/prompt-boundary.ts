// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { logger } from '../logger.js'

const MAX_CONTENT_LENGTH = 500

const BOUNDARY_TAG_PATTERN = /<\/?\s*external-data[^>]*>?/giu
const NEWLINE_PATTERN = /[\r\n]+/gu

/** Unpredictable per-process token; never logged and never derived from message content. */
const BOUNDARY_TOKEN = randomBytes(24).toString('hex')

logger.debug({ module: 'src/security/prompt-boundary' }, 'prompt boundary initialized with per-process token')

/**
 * Neutralize prompt-boundary forgery in untrusted text: strip `<external-data …>`
 * tag sequences (open, close, case-insensitive, with or without a closing angle
 * bracket), collapse newline runs into single spaces, trim, and cap the result.
 */
export function sanitizeExternalData(content: string | undefined): string {
  if (content === undefined) return ''
  return content.replace(BOUNDARY_TAG_PATTERN, '').replace(NEWLINE_PATTERN, ' ').trim().slice(0, MAX_CONTENT_LENGTH)
}

/**
 * Wrap untrusted external content in a tokenized `<external-data>` boundary the
 * model can authenticate against. Returns an empty string when nothing survives
 * sanitization, so callers never emit empty delimiters.
 */
export function wrapUntrusted(content: string | undefined, kind: string): string {
  const sanitized = sanitizeExternalData(content)
  if (sanitized === '') return ''
  return `<external-data token="${BOUNDARY_TOKEN}" kind="${kind}">${sanitized}</external-data>`
}
