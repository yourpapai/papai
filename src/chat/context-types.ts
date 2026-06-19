// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** One section of the LLM context window, with an optional nested breakdown. */
export type ContextSection = {
  label: string
  tokens: number
} & Partial<{
  detail: string
  children: ContextSection[]
}>

/** Snapshot of the LLM context window for a given conversation. */
export type ContextSnapshot = {
  modelName: string
  sections: ContextSection[]
  totalTokens: number
  /** Model's context window if known, null for unrecognized models. */
  maxTokens: number | null
  /** True when token counts came from a char/4 fallback because tokenization failed. */
  approximate: boolean
}

/** One field inside a Discord-style embed. */
export type EmbedField = {
  name: string
  value: string
} & Partial<{ inline: boolean }>

/** Options for sending a structured embed (Discord-only today). */
export type EmbedOptions = {
  title: string
  description: string
} & Partial<{
  fields: EmbedField[]
  footer: string
  color: number
}>
