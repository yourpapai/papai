import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { embedSlugBatch } from './consolidate-keywords-agent.js'
import { hashText } from './fingerprints.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'

const EmbeddingEntrySchema = z.object({
  slug: z.string(),
  raw: z.array(z.number()),
  normalized: z.array(z.number()),
})

const EmbeddingCacheSchema = z.object({
  model: z.string(),
  providerIdentity: z.string(),
  slugFingerprint: z.string(),
  entries: z.array(EmbeddingEntrySchema),
})

type EmbeddingCache = z.infer<typeof EmbeddingCacheSchema>

function buildSlugFingerprint(vocabulary: readonly KeywordVocabularyEntry[]): string {
  const slugs = vocabulary.map((e) => e.slug).join('\n')
  return hashText(slugs)
}

function normalizeVector(vec: readonly number[]): readonly number[] {
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (mag === 0) return vec
  return vec.map((v) => v / mag)
}

async function loadEmbeddingCache(
  cachePath: string,
  model: string,
  providerIdentity: string,
  vocabulary: readonly KeywordVocabularyEntry[],
): Promise<{
  readonly raw: readonly (readonly number[])[]
  readonly normalized: readonly (readonly number[])[]
} | null> {
  const file = Bun.file(cachePath)
  if (!(await file.exists())) return null

  const raw: unknown = JSON.parse(await file.text())
  const parsed = EmbeddingCacheSchema.safeParse(raw)
  if (!parsed.success) return null

  const cache = parsed.data
  if (cache.model !== model) return null
  if (cache.providerIdentity !== providerIdentity) return null
  if (cache.slugFingerprint !== buildSlugFingerprint(vocabulary)) return null

  const rawMap = new Map<string, readonly number[]>()
  const normMap = new Map<string, readonly number[]>()
  for (const entry of cache.entries) {
    rawMap.set(entry.slug, entry.raw)
    normMap.set(entry.slug, entry.normalized)
  }

  if (rawMap.size !== vocabulary.length) return null

  return {
    raw: vocabulary.map((e) => rawMap.get(e.slug) ?? []),
    normalized: vocabulary.map((e) => normMap.get(e.slug) ?? []),
  }
}

async function saveEmbeddingCache(
  cachePath: string,
  model: string,
  providerIdentity: string,
  vocabulary: readonly KeywordVocabularyEntry[],
  embeddings: readonly (readonly number[])[],
): Promise<void> {
  const entries = vocabulary.map((entry, i) => ({
    slug: entry.slug,
    raw: [...(embeddings[i] ?? [])],
    normalized: [...normalizeVector(embeddings[i] ?? [])],
  }))

  const cache: EmbeddingCache = {
    model,
    providerIdentity,
    slugFingerprint: buildSlugFingerprint(vocabulary),
    entries,
  }

  const dir = dirname(cachePath)
  const tempPath = join(dir, `.${basename(cachePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  await mkdir(dir, { recursive: true })
  await Bun.write(tempPath, JSON.stringify(cache))
  await rename(tempPath, cachePath)
}

export interface EmbeddingData {
  readonly raw: readonly (readonly number[])[]
  readonly normalized: readonly (readonly number[])[]
}

export interface GetOrEmbedDeps {
  readonly embedSlugBatch: typeof embedSlugBatch
  readonly providerIdentity?: string
  readonly log: Pick<typeof console, 'log'>
}

export async function getOrEmbed(
  cachePath: string | null,
  model: string,
  vocabulary: readonly KeywordVocabularyEntry[],
  deps: GetOrEmbedDeps,
  forceReembed: boolean = false,
): Promise<EmbeddingData> {
  const providerIdentity = deps.providerIdentity ?? 'default'
  if (cachePath !== null && !forceReembed) {
    const cached = await loadEmbeddingCache(cachePath, model, providerIdentity, vocabulary)
    if (cached !== null) {
      deps.log.log(`[embedding-cache] Reusing cached embeddings (${vocabulary.length} slugs)`)
      return cached
    }
  }

  deps.log.log(`[embedding-cache] Embedding ${vocabulary.length} slugs...`)
  const slugInputs = vocabulary.map((e) => `${e.slug}: ${e.description}`)
  const embeddings = await deps.embedSlugBatch(slugInputs)

  if (cachePath !== null) {
    deps.log.log(`[embedding-cache] Saving embeddings to ${cachePath}`)
    await saveEmbeddingCache(cachePath, model, providerIdentity, vocabulary, embeddings)
  }

  return {
    raw: embeddings,
    normalized: embeddings.map((e) => normalizeVector(e)),
  }
}
