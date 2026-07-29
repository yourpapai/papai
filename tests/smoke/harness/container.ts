// tests/smoke/harness/container.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../src/logger.js'
import { type RunDocker, buildDockerRunArgs, parsePublishedPort, runDocker } from './docker.js'
import { PAPAI_E2E_IMAGE } from './image.js'

const log = logger.child({ scope: 'smoke:container' })

export const DEBUG_DEFAULT_PORT = 9100

const INSTANCE_CONFIG_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

export type PapaiContainer = {
  id: string
  webBaseUrl: string
  stop(): Promise<{ logs: string; exitCode: number }>
  remove(): Promise<void>
}

export type EnvOverrides = { adminUserId?: string; debugServer?: boolean }

export function buildContainerEnv(
  fakes: { llmBaseUrl: string; mattermostUrl: string },
  over: EnvOverrides = {},
): Record<string, string> {
  const env: Record<string, string> = {
    CHAT_PROVIDER: 'mattermost',
    ADMIN_USER_ID: over.adminUserId ?? 'admin-user-1',
    MATTERMOST_URL: fakes.mattermostUrl,
    MATTERMOST_BOT_TOKEN: 'smoke-bot-token',
    INSTANCE_CONFIG_KEY,
    LLM_API_KEY: 'smoke-llm-key',
    LLM_BASE_URL: fakes.llmBaseUrl,
    MAIN_MODEL: 'smoke-model',
    DEBUG_HOSTNAME: '0.0.0.0',
    SETTINGS_PUBLIC_BASE_URL: 'http://localhost:9100',
    // The image's `final` stage only chowns /data to the `bun` user (Dockerfile); the
    // app's default DB_PATH ('papai.db', relative to /app) is root-owned and unwritable.
    // Matches the precedent in docker-compose.yml and scripts/ci/docker-smoke-test.sh.
    DB_PATH: '/data/papai.db',
  }
  if (over.debugServer === true) env['DEBUG_SERVER'] = 'true'
  return env
}

export function settingsProbeUrl(webBaseUrl: string): string {
  return `${webBaseUrl}/settings`
}

export async function waitForSettings(
  webBaseUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const intervalMs = opts.intervalMs ?? 500
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(settingsProbeUrl(webBaseUrl))
      if (res.status === 200) return
    } catch {
      // container web server not bound yet; keep polling until the deadline.
    }
    if (Date.now() >= deadline) throw new Error(`GET /settings never returned 200 within ${timeoutMs}ms`)
    await Bun.sleep(intervalMs)
  }
}

async function containerLogs(id: string, run: RunDocker): Promise<string> {
  const { stdout, stderr } = await run(['logs', id])
  return `${stdout}${stderr}`
}

export async function removeContainer(id: string, run: RunDocker = runDocker): Promise<void> {
  await run(['rm', '-f', id])
}

export async function stopContainerWithSigterm(
  id: string,
  run: RunDocker = runDocker,
): Promise<{ logs: string; exitCode: number }> {
  await run(['kill', '-s', 'SIGTERM', id])
  const deadline = Date.now() + 15_000
  for (;;) {
    const running = await run(['inspect', '-f', '{{.State.Running}}', id])
    if (running.stdout.trim() === 'false') break
    if (Date.now() >= deadline) throw new Error(`container ${id} did not stop within 15s of SIGTERM`)
    await Bun.sleep(250)
  }
  const exit = await run(['inspect', '-f', '{{.State.ExitCode}}', id])
  const logs = await containerLogs(id, run)
  return { logs, exitCode: Number(exit.stdout.trim()) }
}

export async function startPapaiContainer(opts: {
  env: Record<string, string>
  run?: RunDocker
  readyTimeoutMs?: number
}): Promise<PapaiContainer> {
  const run = opts.run ?? runDocker
  const started = await run(
    buildDockerRunArgs({
      image: PAPAI_E2E_IMAGE,
      env: opts.env,
      detached: true,
      publishContainerPort: DEBUG_DEFAULT_PORT,
      addHostGateway: true,
    }),
  )
  if (started.code !== 0) throw new Error(`docker run failed: ${started.stderr}`)
  const id = started.stdout.trim()
  const portResult = await run(['port', id, String(DEBUG_DEFAULT_PORT)])
  if (portResult.code !== 0) {
    await removeContainer(id, run)
    throw new Error(`docker port failed: ${portResult.stderr}`)
  }
  const webBaseUrl = `http://127.0.0.1:${parsePublishedPort(portResult.stdout)}`
  try {
    await waitForSettings(webBaseUrl, { timeoutMs: opts.readyTimeoutMs ?? 60_000 })
  } catch (error) {
    const logs = await containerLogs(id, run)
    await removeContainer(id, run)
    throw new Error(
      `papai container not ready: ${error instanceof Error ? error.message : String(error)}\n--- logs ---\n${logs}`,
      {
        cause: error,
      },
    )
  }
  log.info({ id, webBaseUrl }, 'papai container ready')
  return {
    id,
    webBaseUrl,
    stop: () => stopContainerWithSigterm(id, run),
    remove: () => removeContainer(id, run),
  }
}

export async function runPapaiContainerToExit(opts: {
  env: Record<string, string>
  run?: RunDocker
}): Promise<{ logs: string; exitCode: number }> {
  const run = opts.run ?? runDocker
  const result = await run(
    buildDockerRunArgs({ image: PAPAI_E2E_IMAGE, env: opts.env, detached: false, addHostGateway: true }),
  )
  return { logs: `${result.stdout}${result.stderr}`, exitCode: result.code }
}
