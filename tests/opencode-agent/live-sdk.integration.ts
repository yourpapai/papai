// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The contract check the unit tests cannot make: drive the real adapter against
 * a real `opencode serve`.
 *
 * Everything else in this suite injects a `connect` seam, so the SDK response
 * shapes were guessed for a long time and nothing noticed. The fixtures in
 * `adapters.test.ts` were recorded from this run; when the pinned SDK version
 * moves, run this to re-record them rather than guessing again.
 *
 * Not named `*.test.ts` on purpose — it needs the `opencode` CLI on PATH and
 * takes seconds, so it stays out of default discovery. Run it with:
 *
 *   bun run opencode-agent:test:live
 *
 * No model credentials are needed: a stub OpenAI-compatible endpoint stands in
 * for the provider, which is also what proves the generated config's custom
 * `baseUrl` is honoured end to end.
 */

import { z } from 'zod'

import { createOpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import type { OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'

const REPLY_TEXT = '{"status":"spec","spec":"live round trip"}'

const chunk = (delta: object, finish: string | null): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-live',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-5',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`

/** The smallest server that satisfies an OpenAI-compatible provider. */
const startStubProvider = (): { port: number; stop: () => void } => {
  const server = Bun.serve({
    port: 0,
    fetch: async (request): Promise<Response> => {
      const parsed = z.object({ stream: z.boolean().default(false) }).safeParse(await request.json())
      if (!parsed.success || !parsed.data.stream) {
        return Response.json({
          id: 'chatcmpl-live',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-5',
          choices: [{ index: 0, message: { role: 'assistant', content: REPLY_TEXT }, finish_reason: 'stop' }],
        })
      }
      return new Response(
        `${chunk({ role: 'assistant', content: REPLY_TEXT }, null)}${chunk({}, 'stop')}data: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })

  return {
    // Bun types `port` as optional; a TCP listener always has one.
    port: server.port ?? 0,
    stop: (): void => {
      void server.stop()
    },
  }
}

const check = (label: string, condition: boolean, detail: string): boolean => {
  process.stdout.write(`${condition ? '✓' : '✗'} ${label}${condition ? '' : ` — ${detail}`}\n`)
  return condition
}

const run = async (): Promise<number> => {
  const stub = startStubProvider()
  const openai = { apiKey: 'sk-stub', baseUrl: `http://127.0.0.1:${stub.port}`, model: 'gpt-5' }
  const agents: OpenCodeAgent[] = []
  const results: boolean[] = []

  try {
    // Two at once: the SDK ignores `port: 0` and falls back to its 4096 default,
    // so a shared-port bug shows up here and nowhere else.
    const [first, second] = await Promise.all([
      createOpenCodeAgent({ directory: process.cwd(), openai, sessionTitle: 'live-a' }),
      createOpenCodeAgent({ directory: process.cwd(), openai, sessionTitle: 'live-b' }),
    ])
    agents.push(first, second)

    results.push(
      check(
        'two concurrent servers boot on distinct ports',
        first.sessionId !== second.sessionId,
        'session ids collided',
      ),
      check('a session id is returned', first.sessionId.startsWith('ses_'), `got "${first.sessionId}"`),
    )

    const reply = await first.prompt({ prompt: 'hello', system: 'be terse' })
    results.push(
      check('the adapter decodes the reply text', reply.text === REPLY_TEXT, `got "${reply.text}"`),
      check('the reply carries the session id', reply.sessionId === first.sessionId, 'session id mismatch'),
    )
  } finally {
    await Promise.all(agents.map((agent) => agent.close()))
    stub.stop()
  }

  return results.every(Boolean) ? 0 : 1
}

process.exit(await run())
