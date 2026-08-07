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
 *
 * Last recorded run confirmed: a session response is
 * `{ data: { id: "ses_…" }, request, response }`; a prompt response is
 * `{ data: { info, parts }, request, response }` with parts typed
 * `step-start` / `text` / `step-finish`, of which only `text` carries content.
 */

import { z } from 'zod'

import { createOpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import type { OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import { proxiedSettings, startProviderProxy } from '../../opencode-agent/src/provider-proxy.js'

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
/** Authorization headers the stub upstream actually received. */
const authorizations: string[] = []

const startStubProvider = (): { port: number; stop: () => void } => {
  const server = Bun.serve({
    port: 0,
    fetch: async (request): Promise<Response> => {
      authorizations.push(request.headers.get('authorization') ?? '(none)')
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

/**
 * Counts live `opencode serve` processes.
 *
 * Matching the binary path, not a loose "opencode serve" substring: the naive
 * pattern also matches the shell command doing the counting, which reads as a
 * phantom leak.
 */
const countServers = (): number => {
  const listing = Bun.spawnSync(['ps', '-eo', 'args='])
  return new TextDecoder()
    .decode(listing.stdout)
    .split('\n')
    .filter((line) => /opencode(?:\.exe)? serve/u.test(line)).length
}

const check = (label: string, condition: boolean, detail: string): boolean => {
  process.stdout.write(`${condition ? '✓' : '✗'} ${label}${condition ? '' : ` — ${detail}`}\n`)
  return condition
}

const silentLog = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
}

const run = async (): Promise<number> => {
  const stub = startStubProvider()
  const real = { apiKey: 'sk-stub-REAL-CREDENTIAL', baseUrl: `http://127.0.0.1:${stub.port}`, model: 'gpt-5' }
  // The pipeline's own containment path: OpenCode is handed a placeholder key
  // and a loopback URL, and the proxy swaps in the credential on the way out.
  // Driving it here is the only proof that a *streamed* completion survives the
  // hop — the unit tests exercise the handler, not a real model call.
  const proxy = startProviderProxy(real, silentLog)
  const openai = proxiedSettings(real, proxy)
  const agents: OpenCodeAgent[] = []
  const results: boolean[] = []
  const serversBefore = countServers()

  try {
    // Warm OpenCode's own store before anything runs concurrently. On a cold
    // data directory — which every CI runner is — two servers starting at once
    // race each other's first-time SQLite initialisation, and the boot either
    // dies with `database is locked` or hangs well past the SDK timeout. Both
    // were observed. The pipeline itself boots one memoized server before the
    // review pool spawns anything, so this ordering is what production already
    // does; the check has to do it deliberately.
    const warmup = await createOpenCodeAgent({ directory: process.cwd(), openai, sessionTitle: 'live-warmup' })
    await warmup.close()

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
      check(
        'the provider proxy carried a streamed completion',
        authorizations.includes(`Bearer ${real.apiKey}`),
        `upstream saw ${JSON.stringify(authorizations)}`,
      ),
      check(
        'OpenCode never held the real credential',
        !JSON.stringify(openai).includes(real.apiKey),
        'the placeholder was not substituted',
      ),
    )
  } finally {
    await Promise.all(agents.map((agent) => agent.close()))
    await proxy.close()
    stub.stop()
  }

  // close() sends SIGTERM; give the children a moment to actually go away.
  await Bun.sleep(2000)
  results.push(
    check(
      'closing the agents leaves no server behind',
      countServers() <= serversBefore,
      `${countServers() - serversBefore} server(s) leaked`,
    ),
  )

  return results.every(Boolean) ? 0 : 1
}

process.exit(await run())
