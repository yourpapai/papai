// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { McpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'
import {
  applyRedactions,
  BLOCK_PREFIX,
  isBlockedResult,
  MAX_REDACTION_INPUT_CHARS,
  parseFindings,
  redactText,
  sizeGuard,
} from '../../src/mcp-server/redaction.js'

const cfg: McpRedactionConfig = {
  model_url: 'https://model.example.com/v1',
  api_key: 'k',
  model_name: 'redactor',
  timeout_ms: 5000,
}

function modelResponse(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Mimics native fetch: rejects immediately for an already-aborted signal (via
// `throwIfAborted`, which throws synchronously inside the executor and rejects the
// promise), otherwise rejects once the signal later fires. Kept outside any `test()`
// body per vitest(no-conditional-in-test).
function abortAwareHttpFetch(_url: string, init: RequestInit | undefined): Promise<Response> {
  const signal = init?.signal
  return new Promise<Response>((_resolve, reject) => {
    signal?.throwIfAborted()
    signal?.addEventListener('abort', () => {
      reject(new Error('aborted'))
    })
  })
}

describe('parseFindings', () => {
  test('parses {string,redacted} objects, drops <2-char values', () => {
    expect(parseFindings('[{"string":"John Doe","redacted":"name"},{"string":"a","redacted":"x"}]')).toEqual([
      { value: 'John Doe', label: 'NAME' },
    ])
  })

  test('tolerates prose/markdown around the JSON array', () => {
    expect(parseFindings('Here:\n```json\n[{"string":"a@b.com","redacted":"email"}]\n```')).toEqual([
      { value: 'a@b.com', label: 'EMAIL' },
    ])
  })

  test('throws when no array present', () => {
    expect(() => parseFindings('no json here')).toThrow()
  })
})

describe('applyRedactions', () => {
  test('replaces longest matches first', () => {
    const out = applyRedactions('John Doe met John', [
      { value: 'John', label: 'NAME' },
      { value: 'John Doe', label: 'NAME' },
    ])
    expect(out).toBe('[NAME] met [NAME]')
  })
})

describe('redactText', () => {
  test('redacts using model findings', async () => {
    const httpFetch = mock().mockResolvedValue(modelResponse([{ string: 'a@b.com', redacted: 'email' }]))
    const out = await redactText('contact a@b.com', 'PROMPT', cfg, httpFetch, undefined)
    expect(out).toBe('contact [EMAIL]')
  })

  test('fails closed to a block marker on model error', async () => {
    const httpFetch = mock().mockResolvedValue(new Response('nope', { status: 500 }))
    const out = await redactText('secret', 'PROMPT', cfg, httpFetch, undefined)
    expect(isBlockedResult(out)).toBe(true)
    expect(out.startsWith(BLOCK_PREFIX)).toBe(true)
  })

  test('fails closed when model content is empty', async () => {
    const httpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const out = await redactText('secret', 'PROMPT', cfg, httpFetch, undefined)
    expect(isBlockedResult(out)).toBe(true)
  })

  test('sends an OpenAI-compatible chat/completions request', async () => {
    const httpFetch = mock().mockResolvedValue(modelResponse([]))
    await redactText('hello', 'PROMPT', cfg, httpFetch, undefined)
    expect(httpFetch).toHaveBeenCalledWith(
      'https://model.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'redactor',
          temperature: 0,
          messages: [
            { role: 'system', content: 'PROMPT' },
            { role: 'user', content: 'hello' },
          ],
        }),
      }),
    )
  })

  test('fails closed on oversize input without calling the internal model', async () => {
    const httpFetch = mock().mockResolvedValue(modelResponse([]))
    const oversized = 'x'.repeat(MAX_REDACTION_INPUT_CHARS + 1)
    const out = await redactText(oversized, 'PROMPT', cfg, httpFetch, undefined)
    expect(isBlockedResult(out)).toBe(true)
    expect(out.startsWith(BLOCK_PREFIX)).toBe(true)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('still redacts normal-size input', async () => {
    const httpFetch = mock().mockResolvedValue(modelResponse([{ string: 'a@b.com', redacted: 'email' }]))
    const out = await redactText('contact a@b.com', 'PROMPT', cfg, httpFetch, undefined)
    expect(out).toBe('contact [EMAIL]')
  })

  test('short-circuits on an already-aborted parent signal without a completed model call', async () => {
    const httpFetch = mock(abortAwareHttpFetch)
    const controller = new AbortController()
    controller.abort()
    const out = await redactText('secret', 'PROMPT', cfg, httpFetch, controller.signal)
    expect(isBlockedResult(out)).toBe(true)
  })
})

describe('sizeGuard', () => {
  test('returns text unchanged under threshold', () => {
    expect(sizeGuard('short', 100)).toBe('short')
  })

  test('truncates with a note over threshold', () => {
    const out = sizeGuard('x'.repeat(50), 10)
    expect(out.length).toBeLessThan(50)
    expect(out).toContain('truncated')
  })
})
