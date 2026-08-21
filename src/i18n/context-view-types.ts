// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** `/context` view texts; section labels keyed by stable section id. Split out of `types.ts` to keep it small. */
export interface ContextViewTexts {
  sections: {
    system_prompt: string
    base_instructions: string
    custom_instructions: string
    provider_addendum: string
    memory_context: string
    summary: string
    known_entities: string
    conversation_history: string
    tools: string
  }
  /** Slot `{count}` receives the fact/entity count. */
  factSingular: string
  /** Count-of-2-to-4 form; identical to `factPlural` in locales without a paucal (en). */
  factPaucal: string
  factPlural: string
  /** Slot `{count}` receives the history message count. */
  messageSingular: string
  /** Count-of-2-to-4 form; identical to `messagePlural` in locales without a paucal (en). */
  messagePaucal: string
  messagePlural: string
  /** Slots `{active}`/`{available}` receive the disclosed/full tool counts. */
  progressiveDisclosure: string
  headerWord: string
  tokensUnit: string
  sectionColumnHeader: string
  tokensColumnHeader: string
  tokenSuffix: string
  approximateMarker: string
  approximateFooter: string
}
