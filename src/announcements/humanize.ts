// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'

import { buildChatModel } from '../llm-model-builder.js'
import { resolveAdminLlmConfig } from '../llm-providers/resolver.js'
import type { LlmConfigResult } from '../llm-providers/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'announcements:humanize' })

export const classifiedEntriesSchema = z.object({
  entries: z.array(
    z.object({
      kind: z.enum(['new', 'improvement', 'fix']),
      text: z.string(),
    }),
  ),
})

export type ClassifiedEntries = z.infer<typeof classifiedEntriesSchema>

const CLASSIFY_SYSTEM_PROMPT = [
  'You select which software changelog entries matter to end users of a chat bot.',
  'Rules:',
  '- Keep only changes a non-technical user would notice or benefit from: new capabilities, improvements to speed, reliability or usability, and bug fixes.',
  '- Drop internal changes: build, ci, test, chore, refactor, deps, docs, formatting, and other internal plumbing.',
  '- When in doubt, drop the entry.',
  '- For each kept entry set kind: "new" for a new capability, "improvement" when something works better or faster now, "fix" when a problem is gone.',
  '- Keep "text" close to the original entry. Do not rewrite for tone; that happens later.',
].join('\n')

export const EMPTY_RELEASE_NOTE = 'This release is all behind-the-scenes improvements — nothing new to learn.'

const SYSTEM_PROMPT = [
  'You turn a filtered list of changelog entries (a JSON array of {kind, text}) into a short, friendly release announcement for end users of a chat bot.',
  'Rules:',
  '- Write for non-technical users. Plain, warm, concise.',
  '- No jargon, config keys, module names, commit hashes, or scopes in parentheses.',
  '- Each item is one short line framed as a benefit: what the user can now do, or what annoyance is gone.',
  '- Group into sections with these exact headers when content exists: "✨ New", "⚡ Improvements", "🛠 Fixes". Omit a section entirely if it has no items.',
  '- Output only the announcement body. No preamble, no "here is", no version number.',
  'Example input:',
  '[{"kind":"new","text":"feat(telegram): pick up edited messages and update the task"},{"kind":"fix","text":"fix(memory): recall search returns stale results after compaction"}]',
  'Example output:',
  '✨ New',
  '- Changed your mind? Edit your message and the bot updates the task.',
  '',
  '🛠 Fixes',
  "- The bot's memory search always shows fresh results again.",
].join('\n')

export interface HumanizeChangelogDeps {
  resolveConfig: () => LlmConfigResult
  buildModel: (apiKey: string, baseUrl: string, modelName: string) => LanguageModel
  generate: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<{ text: string }>
  generateStructured: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<ClassifiedEntries>
}

const defaultDeps: HumanizeChangelogDeps = {
  resolveConfig: resolveAdminLlmConfig,
  buildModel: buildChatModel,
  generate: async (opts) => {
    const result = await generateText(opts)
    return { text: result.text }
  },
  generateStructured: async (opts) => {
    const result = await generateText({ ...opts, output: Output.object({ schema: classifiedEntriesSchema }) })
    return result.output
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
    const model = deps.buildModel(config.main.apiKey, config.main.baseUrl, config.main.model)
    const classified = await deps.generateStructured({ model, system: CLASSIFY_SYSTEM_PROMPT, prompt: rawSection })
    if (classified.entries.length === 0) return EMPTY_RELEASE_NOTE
    const { text } = await deps.generate({
      model,
      system: SYSTEM_PROMPT,
      prompt: JSON.stringify(classified.entries),
    })
    const trimmed = text.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Changelog humanization failed')
    return null
  }
}
