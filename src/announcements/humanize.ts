// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, Output, type LanguageModel } from 'ai'
import pLimit from 'p-limit'
import { z } from 'zod'

import { SUPPORTED_LOCALES, t, type Locale } from '../i18n/index.js'
import { buildChatModel } from '../llm-model-builder.js'
import { resolveAdminLlmConfig } from '../llm-providers/resolver.js'
import type { LlmConfigResult } from '../llm-providers/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'announcements:humanize' })

/** Sequential write-pass queue: one locale at a time, in locale order. */
const writeQueue = pLimit(1)

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

const EN_WRITE_SYSTEM_PROMPT = [
  'You turn a filtered list of changelog entries (a JSON array of {kind, text}) into a short, friendly release announcement for end users of a chat bot.',
  'Rules:',
  '- Write for non-technical users. Plain, warm, concise.',
  '- No jargon, config keys, module names, commit hashes, or scopes in parentheses.',
  '- Each item is one short line framed as a benefit: what the user can now do, or what annoyance is gone.',
  '- Group into sections with these exact headers when content exists: "✨ New", "⚡ Improvements", "🛠 Fixes". Omit a section entirely if it has no items.',
  '- Output only the announcement body. No preamble, no "here is", no version number.',
  'Example input:',
  '[{"kind":"new","text":"feat(telegram): pick up edited messages and update the task"},{"kind":"improvement","text":"perf: task list loads faster for large projects"},{"kind":"fix","text":"fix(memory): recall search returns stale results after compaction"}]',
  'Example output:',
  '✨ New',
  '- Changed your mind? Edit your message and the bot updates the task.',
  '',
  '⚡ Improvements',
  '- Your task lists open faster, even in big projects.',
  '',
  '🛠 Fixes',
  "- The bot's memory search always shows fresh results again.",
].join('\n')

const RU_WRITE_SYSTEM_PROMPT = [
  'You turn a filtered list of changelog entries (a JSON array of {kind, text}) into a short, friendly release announcement for end users of a chat bot.',
  'Write the announcement in Russian.',
  'Rules:',
  '- Write for non-technical users. Plain, warm, concise.',
  '- No jargon, config keys, module names, commit hashes, or scopes in parentheses.',
  '- Each item is one short line framed as a benefit: what the user can now do, or what annoyance is gone.',
  '- Group into sections with these exact headers when content exists: "✨ Новое", "⚡ Улучшения", "🛠 Исправления". Omit a section entirely if it has no items.',
  '- Output only the announcement body. No preamble, no "here is", no version number.',
  'Example input:',
  '[{"kind":"new","text":"feat(telegram): pick up edited messages and update the task"},{"kind":"improvement","text":"perf: task list loads faster for large projects"},{"kind":"fix","text":"fix(memory): recall search returns stale results after compaction"}]',
  'Example output:',
  '✨ Новое',
  '- Передумали? Отредактируйте сообщение — и бот обновит задачу.',
  '',
  '⚡ Улучшения',
  '- Списки задач открываются быстрее, даже в больших проектах.',
  '',
  '🛠 Исправления',
  '- Поиск по памяти бота снова всегда показывает свежие результаты.',
].join('\n')

/** Per-locale write-pass system prompts: output language + localized section headers. */
const WRITE_SYSTEM_PROMPTS: Record<Locale, string> = {
  en: EN_WRITE_SYSTEM_PROMPT,
  ru: RU_WRITE_SYSTEM_PROMPT,
}

export interface HumanizeChangelogDeps {
  resolveConfig: () => LlmConfigResult
  buildModel: (apiKey: string, baseUrl: string, modelName: string) => LanguageModel
  generate: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<{ text: string }>
  generateStructured: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<ClassifiedEntries>
  /** Locales to produce bodies for; write pass runs once per entry. Defaults to every supported locale. */
  locales?: readonly Locale[]
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

const localesOf = (deps: HumanizeChangelogDeps): readonly Locale[] => deps.locales ?? SUPPORTED_LOCALES

type OkLlmConfig = Extract<LlmConfigResult, { ok: true }>

type ClassifyOutcome = { model: LanguageModel; entries: ClassifiedEntries['entries'] } | null

async function runClassifyPass(
  rawSection: string,
  deps: HumanizeChangelogDeps,
  config: OkLlmConfig,
): Promise<ClassifyOutcome> {
  try {
    const model = deps.buildModel(config.main.apiKey, config.main.baseUrl, config.main.model)
    const classified = await deps.generateStructured({ model, system: CLASSIFY_SYSTEM_PROMPT, prompt: rawSection })
    return { model, entries: classified.entries }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Changelog humanization failed')
    return null
  }
}

function emptyReleaseNote(locales: readonly Locale[]): Partial<Record<Locale, string>> {
  const note: Partial<Record<Locale, string>> = {}
  for (const locale of locales) {
    note[locale] = t('announcements.emptyReleaseNote', locale)
  }
  return note
}

async function writeLocaleBody(
  locale: Locale,
  entries: ClassifiedEntries['entries'],
  model: LanguageModel,
  deps: HumanizeChangelogDeps,
  bodies: Partial<Record<Locale, string>>,
): Promise<void> {
  try {
    const { text } = await deps.generate({
      model,
      system: WRITE_SYSTEM_PROMPTS[locale],
      prompt: JSON.stringify(entries),
    })
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      log.warn({ locale }, 'Changelog humanization returned empty output for locale')
      return
    }
    bodies[locale] = trimmed
  } catch (error) {
    log.warn(
      { locale, error: error instanceof Error ? error.message : String(error) },
      'Changelog humanization failed for locale',
    )
  }
}

/**
 * Humanize the raw changelog via the CENTRAL/global LLM into one body per supported
 * locale. One classify pass selects the entries; the write pass runs once per locale
 * with per-locale failure isolation (a failed or empty locale is omitted with a warn,
 * never failing the whole result). Returns an empty map on any pre-write failure.
 */
export async function humanizeChangelog(
  rawSection: string,
  deps: HumanizeChangelogDeps = defaultDeps,
): Promise<Partial<Record<Locale, string>>> {
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
    return {}
  }
  const classified = await runClassifyPass(rawSection, deps, config)
  if (classified === null) return {}
  if (classified.entries.length === 0) return emptyReleaseNote(localesOf(deps))

  const bodies: Partial<Record<Locale, string>> = {}
  // writeQueue is pLimit(1): write passes run sequentially in locale order
  // (deliberate — no concurrency machinery for two calls; a later locale still
  // runs after an earlier one fails).
  await Promise.all(
    localesOf(deps).map((locale) =>
      writeQueue(() => writeLocaleBody(locale, classified.entries, classified.model, deps, bodies)),
    ),
  )
  return bodies
}
