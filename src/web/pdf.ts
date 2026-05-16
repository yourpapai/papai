// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { extractText, getDocumentProxy } from 'unpdf'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'web:pdf' })

export interface PdfDeps {
  getDocumentProxy: typeof getDocumentProxy
  extractText: typeof extractText
}

const defaultDeps: PdfDeps = {
  getDocumentProxy,
  extractText,
}

export async function extractPdfText(bytes: Uint8Array, deps: PdfDeps = defaultDeps): Promise<string> {
  log.debug({ bytes: bytes.byteLength }, 'extractPdfText')

  const document = await deps.getDocumentProxy(bytes)
  const { text, totalPages } = await deps.extractText(document, { mergePages: true })

  log.info({ totalPages }, 'Extracted PDF text')
  return text.trim()
}
