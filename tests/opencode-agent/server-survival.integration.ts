// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Which commands run inside a job take that job's own OpenCode server down.
 *
 * Issue #239 approved a plan whose step 2 told the model to "run the live-run
 * experiments against the real `opencode` binary", inside the container whose
 * control plane *is* an `opencode serve` on loopback, with the `build` profile's
 * unrestricted `bash`. It failed three times: once on the turn deadline with two
 * live `opencode` processes and a `curl` left at teardown, and twice with the
 * server gone mid-turn. Which of those a given command causes was not knowable
 * from the CI logs — the runner is ephemeral and `activity.ts` keeps tool input
 * out of the log by design — so it stayed an inference.
 *
 * This turns it into a measurement. `POST /session/:id/shell` spawns the same
 * `bash -l -c` child the bash *tool* does, and blocks until it exits, so a
 * candidate command can be driven with **no model and no credentials** — which is
 * what makes this cheap enough to run on a laptop instead of burning an attempt on
 * a real issue. After each candidate the server is asked whether it is still
 * there, through the same probe `opencode-adapter.ts` uses on its failure path.
 *
 * Not a `*.test.ts`, for the reason `live-sdk.integration.ts` is not: it needs the
 * `opencode` CLI on PATH and spends real seconds. Run it with:
 *
 *   bun run opencode-agent:test:survival
 *
 * **What this deliberately does not test.** The remaining hypothesis for the two
 * socket deaths is that the model typed `pkill opencode` — the obvious cleanup
 * after an experiment hangs. Automating that means killing every `opencode` on the
 * host, including the one belonging to whoever is running this, so it stays a
 * hand-run check rather than a candidate here. If the rows below all come back
 * `alive`, that is the hypothesis left standing.
 */

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'

import { withDeadline } from '../../opencode-agent/src/deadline.js'
import { buildOpencodeConfig } from '../../opencode-agent/src/openai-config.js'
import type { OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import { decodeSessionId } from '../../opencode-agent/src/sdk-contract.js'

/**
 * No provider is ever contacted: every candidate is driven through the shell
 * endpoint, which runs a command rather than prompting. The placeholder is here
 * because `buildOpencodeConfig` needs one, and its unreachable host is the proof —
 * anything that tried to reach a model would fail loudly rather than quietly work.
 */
const SETTINGS: OpenAiSettings = {
  apiKey: 'unused-no-model-turn-in-this-probe',
  baseUrl: 'http://127.0.0.1:1/v1',
  model: 'unused',
  provider: 'openai',
}

/** Long enough to prove a command hangs, short enough to run the whole table. */
const COMMAND_TIMEOUT_MS = 20_000

/** The probe's own bound, matching the one the adapter's liveness check uses. */
const PROBE_TIMEOUT_MS = 5_000

interface Candidate {
  /** What the row is called in the report. */
  name: string
  /** Exactly what a `bash` tool call would carry. */
  command: string
  /** What this row is evidence about, printed beside the result. */
  asks: string
}

/**
 * The commands, in the order the failures happened.
 *
 * Each is something plan step 2 asks for in so many words, reduced to the
 * smallest command that can carry the same risk. Nothing here touches a process
 * it did not start.
 */
const CANDIDATES: readonly Candidate[] = [
  {
    name: 'baseline: a command that simply takes a while',
    command: 'sleep 5',
    asks: 'that a slow tool call is not by itself fatal — the control for every row below',
  },
  {
    name: 'a nested `opencode serve`, backgrounded',
    command: 'nohup opencode serve --hostname=127.0.0.1 --port=0 >/dev/null 2>&1 & sleep 3; echo started',
    asks: 'whether a second server can coexist with the pipeline’s own, or takes it down',
  },
  {
    name: 'a nested `opencode serve`, left in the foreground',
    command: 'opencode serve --hostname=127.0.0.1 --port=0',
    asks: 'run 1’s shape: a foreground child that never exits, holding the turn to its deadline',
  },
  {
    name: 'a foreground stdio process that never reads or exits',
    command: 'cat',
    asks: 'the same hang from the MCP-server direction — step 2’s fixture speaks stdio',
  },
]

interface Outcome {
  candidate: Candidate
  /** How the command itself ended, from this side of the socket. */
  command: 'returned' | 'timed out' | 'failed'
  /** Whether the server answered afterwards. This is the finding. */
  server: 'alive' | 'gone'
}

const main = async (): Promise<void> => {
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port: 0,
    config: buildOpencodeConfig(SETTINGS),
    timeout: 60_000,
  })
  const directory = process.cwd()
  const client = createOpencodeClient({ baseUrl: server.url, directory })
  const sessionId = decodeSessionId(await client.session.create({ body: { title: 'survival' }, query: { directory } }))

  console.log(`server up on ${server.url}, session ${sessionId}\n`)

  /**
   * The same question `OpenCodeConnection.alive` asks, for the same reason: any
   * answer at all means the server is up, and only a rejection is a `false`.
   */
  const alive = (): Promise<boolean> =>
    withDeadline(
      client.session.get({ path: { id: sessionId }, query: { directory } }),
      PROBE_TIMEOUT_MS,
      () => new Error('probe timed out'),
    ).then(
      () => true,
      () => false,
    )

  const run = async (candidate: Candidate): Promise<Outcome> => {
    console.log(`→ ${candidate.name}`)
    const command = await withDeadline(
      client.session.shell({
        path: { id: sessionId },
        body: { agent: 'build', command: candidate.command },
        query: { directory },
      }),
      COMMAND_TIMEOUT_MS,
      () => new Error('command timed out'),
    ).then(
      (): Outcome['command'] => 'returned',
      (error: unknown): Outcome['command'] =>
        error instanceof Error && error.message === 'command timed out' ? 'timed out' : 'failed',
    )

    return { candidate, command, server: (await alive()) ? 'alive' : 'gone' }
  }

  // `mapSeries` is the repo's answer to `await` in a loop, and the order matters
  // here for a second reason: a row that kills the server makes every row after it
  // meaningless, so they cannot overlap.
  const outcomes: Outcome[] = []
  await CANDIDATES.reduce(
    (chain, candidate) => chain.then(async () => void outcomes.push(await run(candidate))),
    Promise.resolve(),
  )

  console.log('\n--- results ---')
  for (const outcome of outcomes) {
    console.log(`${outcome.server === 'gone' ? '✗' : '✓'} server ${outcome.server}  |  command ${outcome.command}`)
    console.log(`   ${outcome.candidate.name}`)
    console.log(`   asks: ${outcome.candidate.asks}`)
  }

  const killers = outcomes.filter((outcome) => outcome.server === 'gone')
  console.log(
    killers.length === 0
      ? '\nNo candidate took the server down. The `pkill` hypothesis in this file’s header is what is left.'
      : `\n${killers.length} candidate(s) took the server down; the first is the one to fix.`,
  )

  server.close()
}

await main()
