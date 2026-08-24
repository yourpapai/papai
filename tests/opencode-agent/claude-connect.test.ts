// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createClaudeConfigDir,
  KILL_GRACE_MS,
  killGroup,
  spawnClaude,
  teardownClaude,
} from '../../opencode-agent/src/claude-connect.js'
import type {
  ClaudeChild,
  ClaudeChildProcess,
  GroupKillSeams,
  SpawnClaude,
} from '../../opencode-agent/src/claude-connect.js'
import { writeClaudeCredentialFiles } from '../../opencode-agent/src/claude-credential.js'

/**
 * How the CLI is started and addressed: the spawn contract, the child
 * environment, and the group-kill seam. Everything here runs against an
 * injected spawn — no `claude` binary, no network, per this workspace's rule.
 */

const CREDENTIAL = { name: 'ANTHROPIC_API_KEY' as const, value: 'sk-ant-api03-the-chosen-credential' }

const OAUTH_CREDENTIAL = { name: 'CLAUDE_CODE_OAUTH_TOKEN' as const, value: 'sk-ant-oat01-the-subscription-token' }

interface RecordedSpawn {
  argv: readonly string[]
  options: {
    detached: boolean
    shell: boolean
    env: Record<string, string>
    cwd: string
    stdio: unknown
  }
}

const blankRecording = (): RecordedSpawn => ({
  argv: [],
  options: { detached: false, shell: false, env: {}, cwd: '', stdio: '' },
})

/** A stdin that records what it was handed. */
interface RecordingStdin {
  written: string
  write(chunk: string): void
  end(): void
}

const recordingStdin = (): RecordingStdin => ({
  written: '',
  write(chunk: string): void {
    this.written += chunk
  },
  end(): void {},
})

/** An async iterable that yields nothing, matching the interface's stream half. */
const emptyChunks = (): AsyncIterable<Uint8Array> => {
  const iterator: AsyncIterator<Uint8Array> = {
    next: (): Promise<IteratorResult<Uint8Array>> => Promise.resolve({ done: true, value: undefined }),
  }
  return { [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => iterator }
}

const fakeChild = (pid: number): ClaudeChildProcess & { stdin: RecordingStdin } => {
  const stdin = recordingStdin()
  return { pid, stdin, stdout: emptyChunks(), stderr: emptyChunks(), exited: Promise.resolve(0) }
}

/** A spawn seam that records what it was asked and hands back a placid child. */
const recordingSpawn =
  (recorded: RecordedSpawn, pid: number): SpawnClaude =>
  (binary, argv, options) => {
    recorded.argv = [binary, ...argv]
    recorded.options = {
      detached: options.detached,
      shell: options.shell,
      env: options.env,
      cwd: options.cwd,
      stdio: options.stdio,
    }
    return fakeChild(pid)
  }

/** The child's config dir, read back for assertions. */
const configDirOf = (child: ClaudeChild): string => {
  const dir = child.env['CLAUDE_CONFIG_DIR']
  if (dir === undefined) throw new Error('the child env carries no CLAUDE_CONFIG_DIR')
  return dir
}

const request = (
  env: Record<string, string | undefined> = {},
  configDir = createClaudeConfigDir(),
  credential: Parameters<typeof spawnClaude>[0]['credential'] = CREDENTIAL,
): Parameters<typeof spawnClaude>[0] => ({
  argv: ['--bare', '-p'],
  stdinPrompt: 'do the work',
  credential,
  workspace: '/runner/workspace',
  configDir,
  env: { PATH: '/usr/bin', ...env },
})

describe('the spawn contract', () => {
  test('spawns the CLI detached, no shell, as an argv vector, in the workspace', () => {
    const recorded = blankRecording()
    spawnClaude(request(), { spawn: recordingSpawn(recorded, 4242) })

    expect(recorded.argv).toEqual(['claude', '--bare', '-p'])
    expect(recorded.options.detached).toBe(true)
    expect(recorded.options.shell).toBe(false)
    expect(recorded.options.cwd).toBe('/runner/workspace')
    expect(recorded.options.stdio).toBe('pipe')
  })

  test('the prompt is written to stdin', () => {
    const child = fakeChild(1)
    spawnClaude(request(), {
      spawn: (): ClaudeChildProcess => child,
    })

    expect(child.stdin.written).toBe('do the work')
  })

  test('the child env carries the post-scrub environment plus exactly the chosen credential', () => {
    const recorded = blankRecording()
    const child = spawnClaude(
      request({
        LLM_BASE_URL: 'https://gateway.example/v1',
        AGENT_MCP_SERVERS: '{"index":{"headers":{"authorization":"Bearer mcp"}}}',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-not-the-chosen-one',
      }),
      { spawn: recordingSpawn(recorded, 4242) },
    )

    expect(recorded.options.env['PATH']).toBe('/usr/bin')
    expect(recorded.options.env['ANTHROPIC_API_KEY']).toBe(CREDENTIAL.value)
    // The gateway endpoint is stripped by name: the value-based scrub cannot
    // see a non-secret URL, and the endpoint must never ride this route's env.
    expect(recorded.options.env['LLM_BASE_URL']).toBeUndefined()
    // The whole-value scrub removes each embedded MCP credential but can never
    // remove the JSON carrier — and the knob is inert here (--bare runs no MCP).
    expect(recorded.options.env['AGENT_MCP_SERVERS']).toBeUndefined()
    // Only the chosen spelling is present, never the other one.
    expect(recorded.options.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(child.env).toEqual(recorded.options.env)
  })

  test('CLAUDE_CONFIG_DIR is the job-scoped dir the adapter created, under the tmp root and outside the workspace', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claude-connect-test-'))
    try {
      // One dir per job, created up front by the adapter — the --resume
      // session files of one job's turns live side by side in it, so a
      // per-spawn dir would break continuity by construction.
      const configDir = createClaudeConfigDir(root)
      const child = spawnClaude(request({}, configDir), { spawn: recordingSpawn(blankRecording(), 1) })

      expect(configDirOf(child)).toBe(configDir)
      expect(configDir).toStartWith(`${root}${path.sep}`)
      expect(existsSync(configDir)).toBe(true)
      expect(configDir).not.toContain('/runner/workspace')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the determinism knobs are constants, not env-tunable', () => {
    const recorded = blankRecording()
    spawnClaude(request({ DISABLE_AUTOUPDATER: '0' }), { spawn: recordingSpawn(recorded, 4242) })

    // An operator (or an injected environment) saying 0 does not un-pin the
    // version: two runners must run the same binary the workflow installed.
    expect(recorded.options.env['DISABLE_AUTOUPDATER']).toBe('1')
  })

  test('the OAuth spelling injects no Anthropic credential into the child env', () => {
    const recorded = blankRecording()
    spawnClaude(
      request(
        { ANTHROPIC_API_KEY: 'api-key-riding-along', CLAUDE_CODE_OAUTH_TOKEN: OAUTH_CREDENTIAL.value },
        createClaudeConfigDir(),
        OAUTH_CREDENTIAL,
      ),
      { spawn: recordingSpawn(recorded, 4242) },
    )

    // Under --bare the CLI never reads the env token, so the OAuth spelling's
    // carrier is the helper files, not the environment: neither spelling
    // reaches the child, whatever the scrubbed env carried in.
    expect(recorded.options.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(recorded.options.env['ANTHROPIC_API_KEY']).toBeUndefined()
  })

  test('no credential at all carries neither spelling and fails nowhere', () => {
    const recorded = blankRecording()
    const child = spawnClaude(request({ ANTHROPIC_API_KEY: 'left-behind' }, createClaudeConfigDir(), null), {
      spawn: recordingSpawn(recorded, 4242),
    })

    expect(recorded.options.env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(recorded.options.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(child.env['PATH']).toBe('/usr/bin')
  })
})

describe('writeClaudeCredentialFiles', () => {
  const modeOf = (file: string): number => statSync(file).mode & 0o777
  const freshDir = (): string => mkdtempSync(path.join(tmpdir(), 'claude-credential-files-'))

  test('the OAuth spelling materializes the helper script and the settings file naming it, nothing else', () => {
    const dir = freshDir()
    try {
      writeClaudeCredentialFiles(dir, OAUTH_CREDENTIAL)

      const helper = path.join(dir, 'credential.sh')
      expect(readFileSync(helper, 'utf8')).toBe(`#!/bin/sh\nprintf '%s' '${OAUTH_CREDENTIAL.value}'`)
      expect(modeOf(helper)).toBe(0o700)
      // The settings file carries a path only — the value lives in the script.
      expect(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'))).toEqual({
        apiKeyHelper: helper,
      })
      expect(modeOf(path.join(dir, 'settings.json'))).toBe(0o600)
      expect(readdirSync(dir).sort()).toEqual(['credential.sh', 'settings.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the API-key spelling writes nothing — env injection is that spelling’s mechanism', () => {
    const dir = freshDir()
    try {
      writeClaudeCredentialFiles(dir, CREDENTIAL)

      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an absent credential writes nothing', () => {
    const dir = freshDir()
    try {
      writeClaudeCredentialFiles(dir, null)

      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /** Runs a call that must refuse, handing back the error's message (or '' when it did not refuse). */
  const caughtMessage = (call: () => unknown): string => {
    try {
      call()
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  test('a token carrying a single quote is refused naming the variable, never the value', () => {
    const dir = freshDir()
    try {
      const message = caughtMessage((): unknown =>
        writeClaudeCredentialFiles(dir, { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: "sk-ant-oat01-quo'ted" }),
      )

      expect(message).toContain('CLAUDE_CODE_OAUTH_TOKEN')
      expect(message).not.toContain("quo'ted")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a token carrying a newline is refused naming the variable, never the value', () => {
    const dir = freshDir()
    try {
      const message = caughtMessage((): unknown =>
        writeClaudeCredentialFiles(dir, { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat01-line\nbroken' }),
      )

      expect(message).toContain('CLAUDE_CODE_OAUTH_TOKEN')
      expect(message).not.toContain('line\nbroken')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** Every signal a group kill delivered, as test-readable pairs. */
type SignalLog = Array<[target: number, signal: 'SIGTERM' | 'SIGKILL']>

/** A signal seam that records and always delivers. */
const alwaysDelivers =
  (calls: SignalLog): GroupKillSeams['signal'] =>
  (target, signal) =>
    void calls.push([target, signal])

/** A signal seam that records and finds the group already gone. */
const alwaysGone =
  (calls: SignalLog): GroupKillSeams['signal'] =>
  (target, signal) => {
    calls.push([target, signal])
    throw new Error('ESRCH: no such process')
  }

/** A signal seam that records, lands the SIGTERM, and finds the group dead before the SIGKILL. */
const diesDuringGrace = (calls: SignalLog): GroupKillSeams['signal'] => {
  let terminated = false
  return (target, signal) => {
    calls.push([target, signal])
    if (signal === 'SIGKILL' && terminated) throw new Error('ESRCH: no such process')
    terminated = true
  }
}

const settledSleep =
  (sleeps: number[]): GroupKillSeams['sleep'] =>
  (ms) => {
    sleeps.push(ms)
    return Promise.resolve()
  }

describe('killGroup', () => {
  test('a first signal that finds no live group reports false and escalates nothing', async () => {
    const calls: SignalLog = []

    expect(await killGroup(4242, { signal: alwaysGone(calls) })).toBe(false)
    expect(calls).toEqual([[-4242, 'SIGTERM']])
  })

  test('a delivered SIGTERM waits the named grace, then SIGKILLs the group, and reports true', async () => {
    const calls: SignalLog = []
    const sleeps: number[] = []

    expect(await killGroup(4242, { signal: alwaysDelivers(calls), sleep: settledSleep(sleeps) })).toBe(true)
    expect(calls).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ])
    expect(sleeps).toEqual([KILL_GRACE_MS])
  })

  test('a group that died from the SIGTERM during the grace still reports true', async () => {
    // First signal lands; by escalation time the group is gone — ESRCH on the
    // SIGKILL is the SIGTERM having worked, not a refusal.
    const calls: SignalLog = []

    expect(await killGroup(4242, { signal: diesDuringGrace(calls), sleep: () => Promise.resolve() })).toBe(true)
    expect(calls).toEqual([
      [-4242, 'SIGTERM'],
      [-4242, 'SIGKILL'],
    ])
  })
})

describe('teardownClaude', () => {
  test('is fire-and-forget: a grace timer that never resolves does not block it', async () => {
    const calls: SignalLog = []
    // A sleep that never settles stands in for the grace timer mid-wait.
    const never = new Promise<void>(() => {})
    const child = fakeChild(4242)
    const spawned = { process: child, configDir: '/tmp/gone-config', env: {} }

    await teardownClaude(spawned, { signal: alwaysDelivers(calls), sleep: () => never })

    expect(calls).toEqual([[-4242, 'SIGTERM']])
  })

  test('after the escalation settles, best-effort removes the config dir', async () => {
    const calls: SignalLog = []
    const removed: string[] = []
    const root = mkdtempSync(path.join(tmpdir(), 'claude-teardown-test-'))
    try {
      const spawned = spawnClaude(request({}, createClaudeConfigDir(root)), {
        spawn: recordingSpawn(blankRecording(), 4242),
      })
      expect(existsSync(spawned.configDir)).toBe(true)

      await teardownClaude(spawned, {
        signal: alwaysDelivers(calls),
        sleep: () => Promise.resolve(),
        removeDir: (target: string): void => {
          removed.push(target)
        },
      })
      await Bun.sleep(0)

      expect(removed).toEqual([spawned.configDir])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
