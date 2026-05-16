// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'

const log = logger.child({ scope: 'attachments:blob-store' })

export interface BlobStore {
  put(key: string, content: Buffer, contentType?: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  deleteMany(keys: readonly string[]): Promise<void>
}

/** Test-only in-memory implementation. */
export interface InMemoryBlobStore extends BlobStore {
  has(key: string): boolean
  size(): number
}

/**
 * In-memory BlobStore implementation. Useful for tests with no S3 backend.
 * @internal
 */
export function _createInMemoryBlobStore(): InMemoryBlobStore {
  const map = new Map<string, Buffer>()
  return {
    put(key, content) {
      map.set(key, Buffer.from(content))
      return Promise.resolve()
    },
    get(key) {
      const value = map.get(key)
      if (value === undefined) return Promise.reject(new Error(`InMemoryBlobStore: key not found: ${key}`))
      return Promise.resolve(Buffer.from(value))
    },
    delete(key) {
      map.delete(key)
      return Promise.resolve()
    },
    deleteMany(keys) {
      for (const key of keys) map.delete(key)
      return Promise.resolve()
    },
    has: (key) => map.has(key),
    size: () => map.size,
  }
}

const REQUIRED_S3_VARS = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const

export const isS3Configured = (): boolean => REQUIRED_S3_VARS.every((name) => (process.env[name]?.trim() ?? '') !== '')

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required S3 env var: ${name}`)
  }
  return value
}

const buildS3Client = (): Bun.S3Client => {
  const bucket = requireEnv('S3_BUCKET')
  const accessKeyId = requireEnv('S3_ACCESS_KEY_ID')
  const secretAccessKey = requireEnv('S3_SECRET_ACCESS_KEY')
  const endpoint = process.env['S3_ENDPOINT']
  const region = process.env['S3_REGION']
  const virtualHostedStyle = process.env['S3_FORCE_PATH_STYLE'] === 'true' ? false : undefined
  return new Bun.S3Client({
    bucket,
    accessKeyId,
    secretAccessKey,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(region === undefined ? {} : { region }),
    ...(virtualHostedStyle === undefined ? {} : { virtualHostedStyle }),
  })
}

export function createS3BlobStore(): BlobStore {
  const client = buildS3Client()
  const safeDelete = async (key: string): Promise<void> => {
    try {
      await client.file(key).delete()
    } catch (error) {
      log.warn({ key, error: error instanceof Error ? error.message : String(error) }, 'Blob delete failed, continuing')
    }
  }
  return {
    async put(key, content, contentType) {
      const file = client.file(key)
      const writeOpts = contentType === undefined ? undefined : { type: contentType }
      await file.write(content, writeOpts)
    },
    async get(key) {
      const file = client.file(key)
      const arrayBuffer = await file.arrayBuffer()
      return Buffer.from(arrayBuffer)
    },
    delete: safeDelete,
    async deleteMany(keys) {
      await Promise.all(keys.map(safeDelete))
    },
  }
}

let active: BlobStore | null = null

export function getBlobStore(): BlobStore {
  active ??= createS3BlobStore()
  return active
}

/**
 * Test/DI hook: install a custom blob store.
 * @internal
 */
export function _setBlobStore(store: BlobStore): void {
  active = store
}

/**
 * Test/DI hook: clear the cached blob store and force re-creation on next access.
 * @internal
 */
export function _resetBlobStore(): void {
  active = null
}

export function buildBlobKey(contextId: string, attachmentId: string): string {
  const prefix = process.env['S3_PREFIX'] ?? ''
  const head = prefix === '' ? '' : `${prefix.replace(/\/+$/, '')}/`
  return `${head}${contextId}/${attachmentId}`
}
