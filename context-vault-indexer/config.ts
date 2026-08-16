// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const CONFIG_FILE_NAME = 'config.json'

/** Env var carrying the vault bearer token. Never read from, or written to, disk. */
export const TOKEN_ENV_VAR = 'CONTEXT_VAULT_TOKEN'

const DEFAULT_INTERVAL_MS = 30_000

export type ConfigFs = {
  readFile(path: string): string | null
  writeFile(path: string, contents: string): void
  rename(from: string, to: string): void
}

const RepoEntrySchema = z.object({
  repo: z.string().min(1),
  specDir: z.string().min(1),
})

/**
 * Non-strict on purpose: an unknown key (notably a `token` someone hand-added)
 * is stripped by parsing rather than rejected, so it can never survive into the
 * file the daemon rewrites on every registration.
 */
const ConfigSchema = z.object({
  pushUrl: z.url(),
  intervalMs: z.number().int().positive().default(DEFAULT_INTERVAL_MS),
  repos: z.array(RepoEntrySchema).default([]),
})

export type RepoEntry = z.infer<typeof RepoEntrySchema>
export type IndexerConfig = z.infer<typeof ConfigSchema>

export type ReadConfigResult =
  | { ok: true; config: IndexerConfig }
  | { ok: false; reason: 'missing' | 'unparseable' | 'invalid'; error: string }

export const configPathOf = (stateDir: string): string => `${stateDir}/${CONFIG_FILE_NAME}`

/**
 * Reads and validates the daemon config. Every failure is distinct and names
 * the file: the entrypoint exits on all three rather than falling back to
 * defaults, because a default push URL or an empty repo set looks healthy while
 * indexing nothing.
 */
export function readConfig(stateDir: string, fs: ConfigFs): ReadConfigResult {
  const path = configPathOf(stateDir)
  const raw = fs.readFile(path)
  if (raw === null) return { ok: false, reason: 'missing', error: `Config file not found: ${path}` }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'unparseable', error: `Config file is not valid JSON: ${path} (${message})` }
  }

  const validated = ConfigSchema.safeParse(parsed)
  if (!validated.success) {
    const issues = validated.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    return { ok: false, reason: 'invalid', error: `Config file is invalid: ${path} (${issues.join('; ')})` }
  }
  return { ok: true, config: validated.data }
}

/**
 * Atomic rewrite: temp file then rename, so a crash mid-write leaves the
 * previous config intact rather than a truncated one the next start rejects.
 * Serializes only schema fields, so a token that rode in on the object is
 * dropped instead of persisted.
 */
export function writeConfig(stateDir: string, config: IndexerConfig, fs: ConfigFs): void {
  const path = configPathOf(stateDir)
  const tmpPath = `${path}.tmp`
  const safe: IndexerConfig = {
    pushUrl: config.pushUrl,
    intervalMs: config.intervalMs,
    repos: config.repos.map((entry) => ({ repo: entry.repo, specDir: entry.specDir })),
  }
  fs.writeFile(tmpPath, `${JSON.stringify(safe, null, 2)}\n`)
  fs.rename(tmpPath, path)
}

export type ResolveTokenResult = { ok: true; token: string } | { ok: false; error: string }

/**
 * The token comes only from the environment. The error never echoes the value,
 * so a blank-but-present token cannot leak through a log line.
 */
export function resolveToken(env: Record<string, string | undefined>): ResolveTokenResult {
  const raw = env[TOKEN_ENV_VAR]
  if (raw === undefined || raw.trim() === '') {
    return { ok: false, error: `${TOKEN_ENV_VAR} is not set; refusing to run without a vault token` }
  }
  return { ok: true, token: raw }
}
