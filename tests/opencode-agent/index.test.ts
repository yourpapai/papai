// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import { loadConfig } from '../../opencode-agent/src/config.js'
import { TRANSCRIPT_DIR, TRANSCRIPT_FILE } from '../../opencode-agent/src/debug-transcript.js'
import { createOctokitApi } from '../../opencode-agent/src/github.js'
import { contain, runCli } from '../../opencode-agent/src/index.js'
import { createLogger, createPipelineLogger } from '../../opencode-agent/src/logger.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { OpenCodeAgentOptions } from '../../opencode-agent/src/opencode-adapter.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import { emptyCatalogue } from './test-helpers.js'

/**
 * The transcript's wiring through the CLI: created only when the run has a
 * key, closed — flushed — on the way out, and never visible in the public log.
 * The writer itself is covered in `debug-transcript.test.ts`; this file pins
 * the seams, which is where this workspace's features historically go missing.
 */

const workDir = await mkdtemp(path.join(tmpdir(), 'opencode-agent-index-'))

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

const KEY_B64 = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64')

const ENV = {
  GITHUB_REPOSITORY: 'acme/widgets',
  GITHUB_TOKEN: 'tok',
  LLM_API_KEY: 'sk-test',
  LLM_MODEL: 'gpt-5',
  LLM_BASE_URL: 'https://api.openai.com/v1',
  AGENT_SELF_LOGIN: 'agent-bot',
}

/** An event the guardrails drop — a run that boots nothing and posts nothing. */
const BOT_EVENT = {
  action: 'created',
  sender: { login: 'agent-bot', type: 'Bot' },
  issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
  comment: { id: 1, body: '/approve', author_association: 'OWNER' },
  repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'main' },
}

const writeEvent = async (name: string, payload: unknown): Promise<string> => {
  const filePath = path.join(workDir, `${name}.json`)
  await Bun.write(filePath, JSON.stringify(payload))
  return filePath
}

const transcriptPath = (repoRoot: string): string => path.join(repoRoot, TRANSCRIPT_DIR, TRANSCRIPT_FILE)

/**
 * Gives a temp repoRoot an `openspec/` tree so the D10 probe reports compliant
 * and the run proceeds past the stand-down door. These tests exercise the
 * transcript lifecycle, not the probe, so they opt into the compliant path
 * rather than plant the directory the probe would find on a real checkout.
 */
const compliantRoot = async (repoRoot: string): Promise<string> => {
  await mkdir(path.join(repoRoot, 'openspec'), { recursive: true })
  return repoRoot
}

/** A logger that records its lines, on a fixed clock so two runs compare equal. */
const recording = (level: 'info' | 'warn', config: ReturnType<typeof loadConfig>): { log: Logger; lines: string[] } => {
  const lines: string[] = []
  return { lines, log: createPipelineLogger(level, config, (line) => void lines.push(line)) }
}

describe('runCli transcript lifecycle', () => {
  test('a keyless run warns exactly once and writes no file', async () => {
    const repoRoot = await compliantRoot(path.join(workDir, 'keyless'))
    const eventPath = await writeEvent('keyless', BOT_EVENT)
    const config = loadConfig({ ...ENV }, repoRoot)
    const { log, lines } = recording('info', config)

    await runCli({
      modelCatalogue: emptyCatalogue,
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment', '--repo-root', repoRoot],
      env: { ...ENV },
      logger: log,
    })

    const warns = lines.filter((line) => line.includes('AGENT_LOG_KEY'))
    expect(warns).toHaveLength(1)
    expect(existsSync(transcriptPath(repoRoot))).toBe(false)
  })

  test('a keyed run leaves the transcript file and scrubs the key from the environment', async () => {
    const repoRoot = await compliantRoot(path.join(workDir, 'keyed'))
    const eventPath = await writeEvent('keyed', BOT_EVENT)
    const live = { ...ENV, AGENT_LOG_KEY: KEY_B64 }

    await runCli({
      modelCatalogue: emptyCatalogue,
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment', '--repo-root', repoRoot],
      env: live,
      logger: createLogger({ level: 'error', sink: () => {} }),
    })

    // Created up front, so even this guardrail-dropped run — the shortest run
    // there is — leaves the artefact where the workflow looks for it.
    expect(existsSync(transcriptPath(repoRoot))).toBe(true)
    // The key is a credential like any other: the OpenCode server inherits this
    // environment wholesale, so it must not survive in it.
    expect(Object.hasOwn(live, 'AGENT_LOG_KEY')).toBe(false)
  })

  test('the public log is the same keyed as keyless, apart from the one startup warn', async () => {
    // The containment rule at the seam that matters: turning the transcript on
    // must not add a single line of detail to the world-readable log.
    const eventPath = await writeEvent('identical', BOT_EVENT)

    const runWith = async (extra: Record<string, string>, name: string): Promise<string[]> => {
      const repoRoot = await compliantRoot(path.join(workDir, name))
      const config = loadConfig({ ...ENV, ...extra }, repoRoot)
      const { log, lines } = recording('info', config)
      await runCli({
        modelCatalogue: emptyCatalogue,
        argv: ['--event-path', eventPath, '--event-name', 'issue_comment', '--repo-root', repoRoot],
        env: { ...ENV, ...extra },
        logger: log,
      })
      return lines
    }

    const keyless = await runWith({}, 'identical-keyless')
    const keyed = await runWith({ AGENT_LOG_KEY: KEY_B64 }, 'identical-keyed')

    // Compared without the timestamps, which are the one thing two runs may
    // legitimately differ by.
    const timeless = (lines: string[]): string[] =>
      lines
        .filter((line) => !line.includes('AGENT_LOG_KEY'))
        .map((line) => line.replace(/"time":"[^"]*"/u, '"time":""'))

    expect(timeless(keyless)).toEqual(timeless(keyed))
  })
})

describe('contain transcript wiring', () => {
  const EVENT: TriggerEvent = {
    kind: 'issue',
    eventName: 'issues',
    action: 'opened',
    senderLogin: 'maintainer',
    senderType: 'User',
    authorAssociation: 'OWNER',
    issueNumber: 42,
    issueTitle: 't',
    issueBody: 'b',
    isPullRequest: false,
    commentBody: null,
    commentId: null,
    repositoryOwner: 'acme',
    defaultBranch: 'master',
  }

  test('hands the transcript sink to the session it builds', async () => {
    // The recurring bug in this workspace is a correct piece never wired in:
    // the sink has to reach `OpenCodeAgentOptions` or no event ever lands.
    const seen: OpenCodeAgentOptions[] = []
    const rows: TranscriptRow[] = []
    const run = await contain({
      config: loadConfig(ENV, workDir),
      event: EVENT,
      log: createLogger({ level: 'error', sink: () => {} }),
      run: () => Promise.resolve({ command: '', exitCode: 0, stdout: '', stderr: '' }),
      options: { argv: [], env: {} },
      github: createOctokitApi({
        token: 'tok',
        owner: 'acme',
        repo: 'widgets',
        secrets: [],
        fetch: (): Promise<Response> =>
          Promise.resolve(
            new Response(JSON.stringify({ login: 'maintainer', id: 42 }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ),
      }),
      transcript: { write: (row) => void rows.push(row) },
      createAgent: (agentOptions) => {
        seen.push(agentOptions)
        return Promise.resolve({
          sessionId: 's',
          prompt: () => Promise.resolve({ text: '', sessionId: 's' }),
          tokensUsed: () => Promise.resolve(0),
          abort: () => Promise.resolve(true),
          close: () => Promise.resolve(),
        })
      },
    })

    await run.agent.get()
    // The opencode route always has one; the claude route's null is gated the
    // same way in index.ts's teardown.
    await run.proxy?.close()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.transcript).toBeDefined()
  })
})
