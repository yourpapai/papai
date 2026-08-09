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

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'
import { z } from 'zod'

import { buildOpencodeConfig } from '../../opencode-agent/src/openai-config.js'
import type { OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import { createOpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import type { OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import { proxiedSettings, startProviderProxy } from '../../opencode-agent/src/provider-proxy.js'
import { decodeAbort, decodeSessionId } from '../../opencode-agent/src/sdk-contract.js'

const REPLY_TEXT = '{"status":"spec","spec":"live round trip"}'

/** A provider's own usage block, which is where the token budget's numbers start. */
const USAGE = { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 }

const chunk = (delta: object, finish: string | null, usage?: object): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-live',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-5',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage === undefined ? {} : { usage }),
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
          usage: USAGE,
        })
      }
      return new Response(
        `${chunk({ role: 'assistant', content: REPLY_TEXT }, null)}${chunk({}, 'stop', USAGE)}data: [DONE]\n\n`,
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

/**
 * Whether a pid is alive, without signalling it.
 *
 * `kill -0` is the portable ask, and `ps` is how this file already reads process
 * state elsewhere: a tool child reparented to init is still `ps`-visible, which is
 * the whole finding below.
 */
const alive = (pid: number): boolean => Bun.spawnSync(['kill', '-0', String(pid)]).exitCode === 0

/** Pids of the direct children of `pid`, which for the server is its tool child. */
const childrenOf = (pid: number): number[] =>
  new TextDecoder()
    .decode(Bun.spawnSync(['ps', '-o', 'pid=', '--ppid', String(pid)]).stdout)
    .split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((child) => Number.isSafeInteger(child) && child > 0)

/**
 * The two measurements the wall-clock stop is built on, re-run against the pin.
 *
 * Driven **without a model**: `POST /session/:id/shell` spawns the same `bash -l -c`
 * child the bash *tool* does, it merely blocks until the command exits — so a `sleep`
 * is enough to hold a tool child open and no provider credentials are needed.
 *
 * What is being checked is not the response shape (`adapters.test.ts` has the
 * fixture) but the two facts a type cannot state, and a pin bump can change either:
 *
 *  1. an abort **kills the running tool child and leaves the server up**;
 *  2. `close()` — a bare `proc.kill()` on one pid on POSIX, which is what the SDK's
 *     `stop()` does — **kills the server and orphans the tool child**, reparented to
 *     init. A tool command is a session leader in its own process group, so no group
 *     kill aimed at the server reaches it.
 *
 * Together: `abort` is the stop and `close()` is the leak. If (2) ever stops being
 * true the leak is fixed upstream; if (1) stops being true the salvage has no fence
 * left and must not stage anything.
 */
const checkTheStop = async (openai: OpenAiSettings): Promise<boolean[]> => {
  const port = await reservePortForProbe()
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port,
    config: buildOpencodeConfig(openai),
    timeout: 60_000,
  })
  const client = createOpencodeClient({ baseUrl: server.url, directory: process.cwd() })
  const serverPid = serverPidOn(port)

  const created = await client.session.create({ body: { title: 'live-abort' }, query: { directory: process.cwd() } })
  const sessionId = decodeSessionId(created)

  // Held open, not awaited: the shell call blocks until the command exits, and the
  // whole point is to abort it while it is still running.
  const running = client.session.shell({
    path: { id: sessionId },
    body: { command: 'sleep 120', agent: 'build' },
    query: { directory: process.cwd() },
  })
  void running.catch(() => undefined)
  await Bun.sleep(3000)

  const toolChildren = childrenOf(serverPid)
  const results = [
    check('a tool command runs as a child of the server', toolChildren.length > 0, 'no child was spawned by `sleep`'),
    check('the abort envelope decodes as accepted', decodeAbort(await abortNow(client, sessionId)), 'abort refused'),
  ]

  await Bun.sleep(1000)
  results.push(
    check(
      'the abort killed the tool child',
      toolChildren.every((pid) => !alive(pid)),
      `${toolChildren.join(',')} still alive`,
    ),
    check('the abort left the server up, which is why it is not close()', alive(serverPid), 'the server went away'),
  )

  // Now the other half, on a second tool child: close the server and watch the child
  // survive it. This is the leak the production log was showing all along — the
  // runner's own cleanup printed `Terminate orphan process` for two `opencode`, two
  // `bun`, three `bash` children and a `curl` at the end of the failed run.
  const orphan = client.session.shell({
    path: { id: sessionId },
    body: { command: 'sleep 120', agent: 'build' },
    query: { directory: process.cwd() },
  })
  void orphan.catch(() => undefined)
  await Bun.sleep(3000)
  const doomed = childrenOf(serverPid)

  server.close()
  await Bun.sleep(2000)
  results.push(
    check('close() removed the server', !alive(serverPid), 'the server survived close()'),
    check(
      'close() orphaned the tool child rather than stopping it — the leak abort exists to avoid',
      doomed.length > 0 && doomed.some((pid) => alive(pid)),
      `close() happened to take ${doomed.join(',')} with it; re-record the finding`,
    ),
  )

  // Whatever survived is this check's own mess to clean up, not the runner's.
  for (const pid of doomed) Bun.spawnSync(['kill', '-9', String(pid)])
  return results
}

/** The abort call, kept out of the sequence above so it reads as one step. */
const abortNow = (client: ReturnType<typeof createOpencodeClient>, sessionId: string): Promise<unknown> =>
  client.session.abort({ path: { id: sessionId }, query: { directory: process.cwd() } })

/** The server's pid, read from whoever is listening on the port it was given. */
const serverPidOn = (port: number): number => {
  const listing = Bun.spawnSync(['sh', '-c', `lsof -ti tcp:${port} -sTCP:LISTEN || true`])
  const pid = Number.parseInt(new TextDecoder().decode(listing.stdout).trim().split('\n')[0] ?? '', 10)
  return Number.isSafeInteger(pid) ? pid : 0
}

/** A free port, the way the adapter reserves one — see `opencode-connect.ts`. */
const reservePortForProbe = async (): Promise<number> => {
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: (): void => {} } })
  const port = probe.port
  probe.stop(true)
  await Bun.sleep(50)
  return port
}

const silentLog = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
}

/** Captures what the progress reporter said, so a real run can be checked. */
const progressLines: Array<{ meta: unknown; message: string }> = []
const progressLog = {
  debug: (): void => {},
  info: (meta: unknown, message: string): void => void progressLines.push({ meta, message }),
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
    const warmup = await createOpenCodeAgent({
      directory: process.cwd(),
      openai,
      sessionTitle: 'live-warmup',
      log: silentLog,
    })
    await warmup.close()

    // Two at once: the SDK ignores `port: 0` and falls back to its 4096 default,
    // so a shared-port bug shows up here and nowhere else.
    const [first, second] = await Promise.all([
      createOpenCodeAgent({ directory: process.cwd(), openai, sessionTitle: 'live-a', log: progressLog }),
      createOpenCodeAgent({ directory: process.cwd(), openai, sessionTitle: 'live-b', log: silentLog }),
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
    // Read straight after the prompt, with no wait: the budget checks it at
    // exactly this moment, so a figure that needs the event stream to catch up
    // would be a budget that reads zero on the run that spent the tokens.
    const spentTokens = await first.tokensUsed()
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
      check('the event stream reported progress', progressLines.length > 0, 'nothing was logged during a real turn'),
      check(
        'the session reports what it spent, which is what the budget enforces on',
        spentTokens > 0,
        `session.get reported ${spentTokens} tokens after a prompt the stub billed at ${USAGE.total_tokens}`,
      ),
      check(
        'progress carried no model output',
        !JSON.stringify(progressLines).includes(REPLY_TEXT),
        `a reply leaked into ${JSON.stringify(progressLines).slice(0, 200)}`,
      ),
    )

    // The two measurements the wall-clock stop is built on, on their own server so
    // that closing it does not disturb the agents above.
    results.push(...(await checkTheStop(openai)))
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
