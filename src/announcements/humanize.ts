// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, type LanguageModel } from 'ai'

import { resolveGlobalConfig, type EffectiveLlmConfigResult } from '../llm-config-resolver.js'
import { buildChatModel } from '../llm-model-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'announcements:humanize' })

const SYSTEM_PROMPT = [
  'You turn a raw software changelog into a short, friendly release announcement for end users of a chat bot.',
  'Rules:',
  '- Write for non-technical users. Plain, warm, concise.',
  '- Group into two sections with these exact headers when content exists: "✨ New" and "🛠 Fixes".',
  '- Keep only user-visible changes. Drop internal churn: build, ci, test, chore, refactor, deps, docs, formatting.',
  '- No commit hashes, no scopes in parentheses, no markdown headings larger than bold.',
  '- 1 short line per item. Omit a section entirely if it has no user-facing items.',
  '- Output only the announcement body. No preamble, no "here is", no version number.',
].join('\n')

export interface HumanizeChangelogDeps {
  resolveConfig: () => EffectiveLlmConfigResult
  buildModel: (apiKey: string, baseUrl: string, modelName: string) => LanguageModel
  generate: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<{ text: string }>
}

const defaultDeps: HumanizeChangelogDeps = {
  resolveConfig: resolveGlobalConfig,
  buildModel: buildChatModel,
  generate: async (opts) => {
    const result = await generateText(opts)
    return { text: result.text }
  },
}

/** Humanize the raw changelog via the CENTRAL/global LLM. Returns null on any failure. */
export async function humanizeChangelog(
  rawSection: string,
  deps: HumanizeChangelogDeps = defaultDeps,
): Promise<string | null> {
  const config = deps.resolveConfig()
  if (!config.ok) {
    log.warn(
      {
        type: config.type,
        source: config.source,
        missing: config.type === 'missing' ? config.missing : undefined,
      },
      'Central LLM not configured; skipping changelog humanization',
    )
    return null
  }
  try {
    const model = deps.buildModel(config.llmApiKey, config.llmBaseUrl, config.mainModel)
    const { text } = await deps.generate({ model, system: SYSTEM_PROMPT, prompt: rawSection })
    const trimmed = text.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Changelog humanization failed')
    return null
  }
}
