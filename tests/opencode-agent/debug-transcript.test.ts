// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import { loadConfig } from '../../opencode-agent/src/config.js'
import {
  createDebugTranscript,
  createRunTranscript,
  decryptTranscriptLine,
  TRANSCRIPT_DIR,
  TRANSCRIPT_FILE,
} from '../../opencode-agent/src/debug-transcript.js'
import type { Logger } from '../../opencode-agent/src/logger.js'

const workDir = await mkdtemp(path.join(tmpdir(), 'debug-transcript-'))

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))

const ROW: TranscriptRow = {
  time: '2026-08-09T12:00:00.000Z',
  tool: 'bash',
  status: 'completed',
  detail: 'bun test tests/retry.test.ts',
  durationMs: 3200,
}

const linesIn = (filePath: string): string[] =>
  readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)

/**
 * One line by index, `''` when the file was shorter than the test expected.
 *
 * A module-level helper because `??` inside a test body trips
 * `vitest(no-conditional-in-test)`; the length assertions beside each call are
 * what actually establish the line is there.
 */
const at = (lines: readonly string[], index: number): string => lines[index] ?? ''

describe('createDebugTranscript', () => {
  test('writes one <base64 nonce>.<base64 ciphertext> line per row, and round-trips', async () => {
    const filePath = path.join(workDir, 'round-trip.enc')
    const transcript = createDebugTranscript({ key: KEY, path: filePath, secrets: [] })

    transcript.write(ROW)
    transcript.write({ ...ROW, tool: 'read', detail: 'src/retry.ts', durationMs: null })
    await transcript.close()

    const lines = linesIn(filePath)
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/u)
    expect(await decryptTranscriptLine(KEY, at(lines, 0))).toEqual(ROW)
    expect((await decryptTranscriptLine(KEY, at(lines, 1))).detail).toBe('src/retry.ts')
  })

  test('uses a fresh nonce per line, so two identical rows encrypt differently', async () => {
    // Reused nonces are the one way AES-GCM fails catastrophically; the format
    // carries a random 12-byte nonce per line precisely so this cannot happen.
    const filePath = path.join(workDir, 'nonces.enc')
    const transcript = createDebugTranscript({ key: KEY, path: filePath, secrets: [] })

    transcript.write(ROW)
    transcript.write(ROW)
    await transcript.close()

    const lines = linesIn(filePath)
    expect(lines[0]).not.toBe(lines[1])
    expect(lines[0]?.split('.')[0]).not.toBe(lines[1]?.split('.')[0])
  })

  test('redacts a pipeline secret before encrypting, never after', async () => {
    // The transcript holds bash commands, and a bash command can hold a token
    // (`git push https://x:<token>@…`). Redaction by value, pre-encryption, so
    // even the key holder never reads it back.
    const secret = 'ghp_0123456789abcdefghij'
    const filePath = path.join(workDir, 'redacted.enc')
    const transcript = createDebugTranscript({ key: KEY, path: filePath, secrets: [secret] })

    transcript.write({ ...ROW, detail: `git push https://x:${secret}@github.com/acme/widgets` })
    await transcript.close()

    const row = await decryptTranscriptLine(KEY, at(linesIn(filePath), 0))
    expect(row.detail).toBe('git push https://x:[redacted]@github.com/acme/widgets')
    expect(readFileSync(filePath, 'utf8')).not.toContain(secret)
  })

  test('creates the empty file up front, so a crashed run leaves a findable artefact', () => {
    // A runner killed mid-turn must still leave the artefact where the workflow
    // looks for it, even if no event was ever observed.
    const filePath = path.join(workDir, 'up-front.enc')
    createDebugTranscript({ key: KEY, path: filePath, secrets: [] })

    expect(existsSync(filePath)).toBe(true)
    expect(linesIn(filePath)).toEqual([])
  })

  test('close() flushes writes that were never awaited', async () => {
    // `write` is deliberately synchronous for the caller — reporting must not
    // back-pressure the event drain — so flush-on-close is the whole contract.
    const filePath = path.join(workDir, 'flushed.enc')
    const transcript = createDebugTranscript({ key: KEY, path: filePath, secrets: [] })

    transcript.write(ROW)
    await transcript.close()

    expect(linesIn(filePath)).toHaveLength(1)
  })

  test('rejects a line under the wrong key', async () => {
    const filePath = path.join(workDir, 'wrong-key.enc')
    const transcript = createDebugTranscript({ key: KEY, path: filePath, secrets: [] })
    transcript.write(ROW)
    await transcript.close()

    const wrong = new Uint8Array(32).fill(9)
    await expect(decryptTranscriptLine(wrong, at(linesIn(filePath), 0))).rejects.toThrow()
  })
})

describe('createRunTranscript', () => {
  const KEY_B64 = Buffer.from(KEY).toString('base64')
  const ENV = {
    GITHUB_REPOSITORY: 'acme/widgets',
    GITHUB_TOKEN: 'tok',
    LLM_API_KEY: 'sk-test',
    LLM_BASE_URL: 'https://api.openai.com/v1',
    LLM_MODEL: 'gpt-5',
  }

  const recorder = (): { log: Logger; warns: string[] } => {
    const warns: string[] = []
    return {
      warns,
      log: {
        debug: (): void => {},
        info: (): void => {},
        warn: (_meta, message): void => void warns.push(message),
        error: (): void => {},
      },
    }
  }

  test('warns exactly once and writes no transcript when the key is unset', () => {
    // Keyless is the ordinary case: the run behaves exactly as it did before
    // the transcript existed, and says so once rather than per event.
    const { log, warns } = recorder()
    const transcript = createRunTranscript(loadConfig(ENV, workDir), [], log)

    expect(transcript).toBeNull()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('AGENT_LOG_KEY')
  })

  test('writes to <repoRoot>/.opencode-agent/debug-transcript.enc when keyed', async () => {
    // `AGENT_WORK_DIR`, already gitignored — a transcript on disk must never
    // become part of a commit the implement phase makes.
    const repoRoot = path.join(workDir, 'keyed-repo')
    const { log } = recorder()
    const transcript = createRunTranscript(loadConfig({ ...ENV, AGENT_LOG_KEY: KEY_B64 }, repoRoot), [], log)

    expect(transcript).not.toBeNull()
    transcript?.write(ROW)
    await transcript?.close()

    const lines = linesIn(path.join(repoRoot, TRANSCRIPT_DIR, TRANSCRIPT_FILE))
    expect(await decryptTranscriptLine(KEY, at(lines, 0))).toEqual(ROW)
  })
})
