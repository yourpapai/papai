import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyYouTrackError } from './classify-error.js'
import { youtrackFetch, type YouTrackConfig } from './client.js'
import { ProjectCustomFieldSchema, StateBundleSchema } from './schemas/bundle.js'

const log = logger.child({ scope: 'youtrack:bundle-cache' })

interface CachedBundleInfo {
  bundleId: string
  isShared: boolean
  fetchedAt: number
}

interface CachedFailure {
  fetchedAt: number
}

const BUNDLE_CACHE_TTL_MS = 5 * 60 * 1000
const FAILURE_CACHE_TTL_MS = 30 * 1000

const bundleCache = new Map<string, CachedBundleInfo>()
const failureCache = new Map<string, CachedFailure>()

const ProjectCustomFieldArraySchema = z.array(ProjectCustomFieldSchema)

export interface BundleInfo {
  bundleId: string
  isShared: boolean
}

function getCacheKey(config: YouTrackConfig, projectId: string): string {
  return `${config.baseUrl}|${projectId}`
}

function checkCachedSuccess(config: YouTrackConfig, projectId: string): BundleInfo | null {
  const cacheKey = getCacheKey(config, projectId)
  const cached = bundleCache.get(cacheKey)
  if (cached === undefined) return null

  const age = Date.now() - cached.fetchedAt
  if (age >= BUNDLE_CACHE_TTL_MS) {
    bundleCache.delete(cacheKey)
    return null
  }

  log.debug({ projectId, bundleId: cached.bundleId }, 'bundle cache hit')
  return { bundleId: cached.bundleId, isShared: cached.isShared }
}

function checkCachedFailure(config: YouTrackConfig, projectId: string): boolean {
  const cacheKey = getCacheKey(config, projectId)
  const cached = failureCache.get(cacheKey)
  if (cached === undefined) return false

  const age = Date.now() - cached.fetchedAt
  if (age >= FAILURE_CACHE_TTL_MS) {
    failureCache.delete(cacheKey)
    return false
  }

  log.debug({ projectId }, 'bundle cache failure hit')
  return true
}

async function fetchBundleInfo(config: YouTrackConfig, projectId: string): Promise<BundleInfo | null> {
  const fieldsData = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}/customFields`)

  const fields = ProjectCustomFieldArraySchema.parse(fieldsData)

  const stateField = fields.find((f) => f.field?.name === 'State' || f.field?.localizedName === 'State')

  if (stateField?.bundle === undefined) {
    log.warn({ projectId }, 'State field not found in project')
    return null
  }

  const bundleId = stateField.bundle.id

  const bundleData = await youtrackFetch(config, 'GET', `/api/admin/customFieldSettings/bundles/state/${bundleId}`)

  const bundle = StateBundleSchema.parse(bundleData)

  const projectCount = bundle.aggregated?.project?.length ?? 1
  const isShared = projectCount > 1

  return { bundleId, isShared }
}

export async function resolveStateBundle(config: YouTrackConfig, projectId: string): Promise<BundleInfo | null> {
  log.debug({ projectId }, 'resolveStateBundle')

  const cachedSuccess = checkCachedSuccess(config, projectId)
  if (cachedSuccess !== null) return cachedSuccess

  if (checkCachedFailure(config, projectId)) return null

  try {
    const result = await fetchBundleInfo(config, projectId)

    if (result === null) {
      failureCache.set(getCacheKey(config, projectId), { fetchedAt: Date.now() })
      return null
    }

    bundleCache.set(getCacheKey(config, projectId), { ...result, fetchedAt: Date.now() })
    log.info({ projectId, bundleId: result.bundleId, isShared: result.isShared }, 'bundle resolved and cached')
    return result
  } catch (error) {
    const classified = classifyYouTrackError(error, { projectId })
    log.error({ projectId, error: classified.message }, 'failed to resolve state bundle')
    failureCache.set(getCacheKey(config, projectId), { fetchedAt: Date.now() })
    return null
  }
}
