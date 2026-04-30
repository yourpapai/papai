import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LinkageMode } from './consolidate-keywords-helpers.js'

const VALID_LINKAGES: readonly LinkageMode[] = ['single', 'average', 'complete']

export interface TuneParams {
  readonly threshold: number
  readonly minClusterSize: number
  readonly maxClusterSize: number
  readonly linkage: LinkageMode
  readonly gapThreshold: number
  readonly reembed: boolean
  readonly cacheDir: string
  readonly profileClustering: boolean
  readonly profileSizes: readonly number[]
}

function parseFiniteNumber(flag: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid numeric value for ${flag}: ${value}`)
  }
  return parsed
}

function parseLinkage(value: string): LinkageMode {
  if (value === 'single' || value === 'average' || value === 'complete') {
    return value
  }
  throw new Error(`Unsupported linkage '${value}'. Expected one of: ${VALID_LINKAGES.join(', ')}`)
}

function parsePositiveIntegerList(flag: string, value: string): readonly number[] {
  return value.split(',').map((raw) => {
    const parsed = Number(raw.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new TypeError(`Invalid positive integer value for ${flag}: ${raw}`)
    }
    return parsed
  })
}

const defaultTuneParams = (): TuneParams => ({
  threshold: 0.92,
  minClusterSize: 2,
  maxClusterSize: 0,
  linkage: 'single',
  gapThreshold: 0,
  reembed: false,
  cacheDir: join(tmpdir(), 'tune-embed-cache'),
  profileClustering: false,
  profileSizes: [],
})

type ParsedFlag = Readonly<{
  nextIndex: number
  params: TuneParams
}>

function parseFlag(args: readonly string[], index: number, params: TuneParams): ParsedFlag {
  const flag = args[index]
  const value = args[index + 1]
  if (flag === '--threshold' && value !== undefined) {
    return { nextIndex: index + 1, params: { ...params, threshold: parseFiniteNumber(flag, value) } }
  }
  if (flag === '--min-cluster-size' && value !== undefined) {
    return { nextIndex: index + 1, params: { ...params, minClusterSize: parseFiniteNumber(flag, value) } }
  }
  if (flag === '--max-cluster-size' && value !== undefined) {
    return { nextIndex: index + 1, params: { ...params, maxClusterSize: parseFiniteNumber(flag, value) } }
  }
  if (flag === '--linkage' && value !== undefined) {
    return { nextIndex: index + 1, params: { ...params, linkage: parseLinkage(value) } }
  }
  if (flag === '--gap-threshold' && value !== undefined) {
    return { nextIndex: index + 1, params: { ...params, gapThreshold: parseFiniteNumber(flag, value) } }
  }
  if (flag === '--re-embed') {
    return { nextIndex: index, params: { ...params, reembed: true } }
  }
  if (flag === '--profile-clustering') {
    return { nextIndex: index, params: { ...params, profileClustering: true } }
  }
  if (flag === '--profile-sizes' && value !== undefined) {
    return {
      nextIndex: index + 1,
      params: {
        ...params,
        profileClustering: true,
        profileSizes: parsePositiveIntegerList(flag, value),
      },
    }
  }
  return { nextIndex: index, params }
}

export function parseArgs(args: readonly string[]): TuneParams {
  let params = defaultTuneParams()
  for (let i = 0; i < args.length; i++) {
    const parsed = parseFlag(args, i, params)
    i = parsed.nextIndex
    params = parsed.params
  }
  return params
}
