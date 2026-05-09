import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { KEYWORD_VOCABULARY_PATH } from './config.js'

export function normalizeKeywordSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

export const KeywordVocabularyEntryCoreSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .transform((slug) => normalizeKeywordSlug(slug))
    .refine((slug) => slug.length > 0, 'Keyword slug cannot be empty after normalization'),
  description: z.string(),
})

export type KeywordVocabularyEntryCore = z.infer<typeof KeywordVocabularyEntryCoreSchema>

const KeywordVocabularyEntrySchema = KeywordVocabularyEntryCoreSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
})

const KeywordVocabularySchema = z.array(KeywordVocabularyEntrySchema)

export type KeywordVocabularyEntry = z.infer<typeof KeywordVocabularyEntrySchema>

export function stampVocabularyEntry(
  core: KeywordVocabularyEntryCore,
  now: string = new Date().toISOString(),
): KeywordVocabularyEntry {
  return { slug: core.slug, description: core.description, createdAt: now, updatedAt: now }
}

function normalizeKeywordVocabularyEntryGroup(
  entries: readonly [KeywordVocabularyEntry, ...KeywordVocabularyEntry[]],
): KeywordVocabularyEntry {
  const earliestCreatedAt = entries.reduce(
    (earliest, entry) => (entry.createdAt < earliest ? entry.createdAt : earliest),
    entries[0].createdAt,
  )
  const latestUpdatedAt = entries.reduce(
    (latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest),
    entries[0].updatedAt,
  )
  const longestDescriptionEntry = entries.reduce(
    (longest, entry) => (entry.description.length >= longest.description.length ? entry : longest),
    entries[0],
  )

  return {
    slug: entries[0].slug,
    description: longestDescriptionEntry.description,
    createdAt: earliestCreatedAt,
    updatedAt: latestUpdatedAt,
  }
}

export function normalizeKeywordVocabularyEntries(
  entries: readonly KeywordVocabularyEntry[],
): readonly KeywordVocabularyEntry[] {
  const groupedEntries = new Map<string, readonly KeywordVocabularyEntry[]>()
  for (const entry of entries) {
    const existingGroup = groupedEntries.get(entry.slug)
    if (existingGroup === undefined) {
      groupedEntries.set(entry.slug, [entry])
      continue
    }
    groupedEntries.set(entry.slug, [...existingGroup, entry])
  }

  return [...groupedEntries.values()]
    .flatMap((grouped) => {
      const firstEntry = grouped[0]
      if (firstEntry === undefined) {
        return []
      }
      return [normalizeKeywordVocabularyEntryGroup([firstEntry, ...grouped.slice(1)])]
    })
    .toSorted((left, right) => left.slug.localeCompare(right.slug))
}

async function writeKeywordVocabularyText(text: string): Promise<void> {
  const dir = dirname(KEYWORD_VOCABULARY_PATH)
  const tempPath = join(dir, `.${basename(KEYWORD_VOCABULARY_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true })
  await Bun.write(tempPath, text)
  await rename(tempPath, KEYWORD_VOCABULARY_PATH)
}

export async function loadKeywordVocabulary(): Promise<readonly KeywordVocabularyEntry[] | null> {
  const file = Bun.file(KEYWORD_VOCABULARY_PATH)
  if (!(await file.exists())) return null
  const text = await file.text()
  const parsed = normalizeKeywordVocabularyEntries(KeywordVocabularySchema.parse(JSON.parse(text)))
  const normalizedText = JSON.stringify(parsed, null, 2) + '\n'
  if (text !== normalizedText) {
    await writeKeywordVocabularyText(normalizedText)
  }
  return parsed
}

export async function saveKeywordVocabulary(entries: readonly KeywordVocabularyEntry[]): Promise<void> {
  const parsed = normalizeKeywordVocabularyEntries(KeywordVocabularySchema.parse(entries))
  await writeKeywordVocabularyText(JSON.stringify(parsed, null, 2) + '\n')
}
