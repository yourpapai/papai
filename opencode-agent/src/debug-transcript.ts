// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import type { TranscriptRow } from './activity-detail.js'
import type { PipelineConfig } from './config.js'
import type { Logger } from './logger.js'
import { redactSecrets } from './secrets.js'

/**
 * The maintainer-only run log: what the public Actions log deliberately
 * withholds, encrypted so that withholding is a choice the key holder makes
 * rather than a fact about the repository.
 *
 * The containment rule does not move here — it is *enforced* here.
 * `activity.ts` keeps bash commands, file paths and grep patterns out of the
 * world-readable CI log; this module is the one place they may go, and it goes
 * nowhere without `AGENT_LOG_KEY`. Two properties do the work:
 *
 *   - every line is encrypted with AES-256-GCM under a random per-line nonce,
 *     so the artefact on disk — and the GitHub artefact upload of it — reads as
 *     noise to anyone but the key holder;
 *   - `redactSecrets` runs **before** encryption, by value, so even the key
 *     holder never decrypts a pipeline credential back out of a bash command.
 *
 * WebCrypto (`crypto.subtle`), which Bun and Node ≥ 20 both provide, so this
 * adds no dependency. The format is one NDJSON line per activity:
 * `<base64 nonce>.<base64 ciphertext>`, decryptable line-by-line — which is
 * what lets a crashed run leave a *partial* transcript that still reads.
 */

/** Where the transcript lives: `AGENT_WORK_DIR`, already gitignored. */
export const TRANSCRIPT_DIR = '.opencode-agent'
export const TRANSCRIPT_FILE = 'debug-transcript.enc'

export interface DebugTranscript {
  /** Queues one encrypted line. Synchronous for the caller: reporting must not
   *  back-pressure the event drain it is reporting on. */
  write: (row: TranscriptRow) => void
  /** Flushes every queued write. Never rejects. */
  close: () => Promise<void>
}

const rowSchema = z.object({
  time: z.string(),
  tool: z.string(),
  status: z.string(),
  detail: z.string().nullable(),
  durationMs: z.number().nullable(),
})

/** AES-GCM's standard nonce size. Fresh per line — reuse is the one fatal misuse. */
const NONCE_BYTES = 12

/** A real `Uint8Array<ArrayBuffer>`, which is the only thing `crypto.subtle` accepts. */
const copiedBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

const importKey = (key: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', copiedBytes(key), 'AES-GCM', false, ['encrypt', 'decrypt'])

const encodeLine = async (key: CryptoKey, plaintext: string): Promise<string> => {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plaintext))
  return `${Buffer.from(nonce).toString('base64')}.${Buffer.from(ciphertext).toString('base64')}`
}

/**
 * Decrypts one transcript line. Exported for the tests and for anyone checking
 * an artefact by hand; the browser viewer reimplements these same three steps
 * (split on `.`, base64-decode, `crypto.subtle.decrypt`) so a maintainer needs
 * nothing installed to read one.
 */
export const decryptTranscriptLine = async (key: Uint8Array, line: string): Promise<TranscriptRow> => {
  const [nonce, ciphertext] = line.split('.')
  if (nonce === undefined || ciphertext === undefined) throw new Error('Not a transcript line: expected <nonce>.<ciphertext>')

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: copiedBytes(Buffer.from(nonce, 'base64')) },
    await importKey(key),
    copiedBytes(Buffer.from(ciphertext, 'base64')),
  )
  return rowSchema.parse(JSON.parse(new TextDecoder().decode(decrypted)))
}

export interface DebugTranscriptOptions {
  key: Uint8Array
  path: string
  /** Credential values stripped from every row before it is encrypted. */
  secrets: readonly string[]
}

/**
 * Creates the writer, and creates the file — empty — up front. The empty file
 * is a decision, not an implementation detail: a runner killed mid-turn leaves
 * the artefact where the workflow's upload step looks for it, and "the file
 * exists but has three lines" is a statement a missing file cannot make.
 *
 * Writes are queued on a promise chain and flushed by `close()`. A write that
 * fails — a disk that fills mid-run — is swallowed rather than raised: this is
 * a debugging aid riding on a run that has real work to do, and reporting must
 * never be able to fail the work it reports on.
 */
export const createDebugTranscript = (options: DebugTranscriptOptions): DebugTranscript => {
  mkdirSync(dirname(options.path), { recursive: true })
  writeFileSync(options.path, '', 'utf8')

  const key = importKey(options.key)
  let queue: Promise<void> = Promise.resolve()

  return {
    write: (row): void => {
      queue = queue.then(async () => {
        const plaintext = redactSecrets(JSON.stringify(row), options.secrets)
        appendFileSync(options.path, `${await encodeLine(await key, plaintext)}\n`, 'utf8')
      })
      queue = queue.catch(() => {})
    },
    close: (): Promise<void> => queue,
  }
}

/**
 * The run's transcript, or `null` — with exactly one warning — when no
 * `AGENT_LOG_KEY` is configured.
 *
 * Keyless is the ordinary case and must cost nothing: the public log is
 * unchanged and no file appears. The warning fires here, once, rather than per
 * observed event, and rather than silently — an operator who expected a
 * transcript and forgot the secret should learn that from the log, not from an
 * artefact that never arrived.
 */
export const createRunTranscript = (
  config: PipelineConfig,
  secrets: readonly string[],
  log: Logger,
): DebugTranscript | null => {
  if (config.logKey === null) {
    log.warn({}, 'AGENT_LOG_KEY is not set; no encrypted debug transcript will be written for this run')
    return null
  }

  return createDebugTranscript({
    key: config.logKey,
    path: join(config.repoRoot, TRANSCRIPT_DIR, TRANSCRIPT_FILE),
    secrets,
  })
}
