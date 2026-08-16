// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { logger } from '../logger.js'

const MAX_CONTENT_LENGTH = 500
/**
 * Generous pre-cap on untrusted input before the iterative strip loop: each
 * nested split-tag layer costs one extra full-string regex pass, so unbounded
 * input would be quadratic. The output is capped at 500 regardless.
 */
const MAX_INPUT_LENGTH = 10_000

const BOUNDARY_TAG_PATTERN = /<\s*\/?\s*external-data[^>]*>?/giu
const NEWLINE_PATTERN = /[\r\n]+/gu
/**
 * Unicode format (Cf) and control (Cc) characters except whitespace: invisible,
 * exploitable to forge boundary tags. `\s` members are kept so the tag pattern's
 * `\s*` and the newline collapse keep handling them (stripping `\r\n\t` here
 * would join words that used to be space-separated).
 */
const FORMAT_CHAR_PATTERN = /(?=[\p{Cc}\p{Cf}])[^\s]/gu

/** Unpredictable per-process token; never logged and never derived from message content. */
const BOUNDARY_TOKEN = randomBytes(24).toString('hex')

logger.debug({ module: 'src/security/prompt-boundary' }, 'prompt boundary initialized with per-process token')

/**
 * Neutralize prompt-boundary forgery in untrusted text: strip `<external-data …>`
 * tag sequences (open, close, case-insensitive, with or without a closing angle
 * bracket) repeatedly until stable, so removing one tag cannot reassemble
 * another from the surrounding text. Then collapse newline runs into single
 * spaces, trim, and cap the result.
 */
export function sanitizeExternalData(content: string | undefined): string {
  if (content === undefined) return ''
  let stripped = content.replace(FORMAT_CHAR_PATTERN, '').slice(0, MAX_INPUT_LENGTH)
  let previous: string
  do {
    previous = stripped
    stripped = stripped.replace(BOUNDARY_TAG_PATTERN, '')
  } while (stripped !== previous)
  return stripped.replace(NEWLINE_PATTERN, ' ').trim().slice(0, MAX_CONTENT_LENGTH)
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
