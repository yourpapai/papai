// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Tokenizer as TokenizerType } from 'ai-tokenizer'

export type EncodingName = 'o200k_base' | 'cl100k_base'

const tokenizerCache = new Map<EncodingName, TokenizerType>()

const loadTokenizer = async (encoding: EncodingName): Promise<TokenizerType> => {
  const cached = tokenizerCache.get(encoding)
  if (cached !== undefined) return cached
  const { Tokenizer } = await import('ai-tokenizer')
  const encodingModule =
    encoding === 'o200k_base'
      ? await import('ai-tokenizer/encoding/o200k_base')
      : await import('ai-tokenizer/encoding/cl100k_base')
  const tokenizer = new Tokenizer(encodingModule)
  tokenizerCache.set(encoding, tokenizer)
  return tokenizer
}

/**
 * Synchronous wrapper used by the collector. On first call per encoding,
 * throws with a special marker so the caller can lazy-load via `prepareDefaultCountTokens`.
 */
export const defaultCountTokens = (text: string, encoding: EncodingName): number => {
  if (text.length === 0) return 0
  const tokenizer = tokenizerCache.get(encoding)
  if (tokenizer === undefined) {
    throw new Error(`tokenizer not loaded: ${encoding}`)
  }
  return tokenizer.count(text)
}

/**
 * Preload a tokenizer for the given encoding. Must be called before `collectContext`
 * uses the synchronous `defaultCountTokens`.
 */
export const prepareDefaultCountTokens = async (encoding: EncodingName): Promise<void> => {
  await loadTokenizer(encoding)
}
