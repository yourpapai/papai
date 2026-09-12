// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createClaudeConfigDir,
  EMPTY_MCP_CONFIG_NAME,
  writeClaudeEmptyMcpConfig,
} from '../../opencode-agent/src/claude-config-dir.js'
import { spawnClaude } from '../../opencode-agent/src/claude-connect.js'
import type { ClaudeChild, ClaudeChildProcess, SpawnClaude } from '../../opencode-agent/src/claude-connect.js'
import { KILL_GRACE_MS, killGroup, teardownClaude } from '../../opencode-agent/src/claude-kill.js'
import type { GroupKillSeams } from '../../opencode-agent/src/claude-kill.js'

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
  profile?: NonNullable<Parameters<typeof spawnClaude>[0]['profile']>,
): Parameters<typeof spawnClaude>[0] => ({
  argv: profile === 'native' ? ['--setting-sources', '', '-p'] : ['--bare', '-p'],
  stdinPrompt: 'do the work',
  credential,
  ...(profile === undefined ? {} : { profile }),
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
        AGENT_CLAUDE_ENV: '{"CLAUDE_CODE_MAX_OUTPUT_TOKENS":"16000"}',
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
    // The knob's own raw document is the same carrier class: a value embedded
    // inside it is invisible to the whole-value scrub, so the name is stripped.
    expect(recorded.options.env['AGENT_CLAUDE_ENV']).toBeUndefined()
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

  test('the native profile re-adds exactly the OAuth token — the symmetric mirror of the API-key rule', () => {
    const recorded = blankRecording()
    spawnClaude(
      request(
        { ANTHROPIC_API_KEY: 'api-key-riding-along', CLAUDE_CODE_OAUTH_TOKEN: 'not-the-chosen-one-either' },
        createClaudeConfigDir(),
        OAUTH_CREDENTIAL,
        'native',
      ),
      { spawn: recordingSpawn(recorded, 4242) },
    )

    // One rule, spelled twice (design D3): strip both spellings, re-add
    // exactly the profile's credential. On native that is the OAuth token —
    // the CLI's native path reads the env spelling — and never the API key,
    // never both, whatever the scrubbed env carried in.
    expect(recorded.options.env['CLAUDE_CODE_OAUTH_TOKEN']).toBe(OAUTH_CREDENTIAL.value)
    expect(recorded.options.env['ANTHROPIC_API_KEY']).toBeUndefined()
  })

  test('a mismatched pair injects nothing: bare with the OAuth spelling, native with the API key', () => {
    // The guard refuses both-set, and the adapter derives the profile from
    // the spelling, so no production path builds either shape; the rule is
    // pinned anyway so the mismatch can never smuggle a credential through.
    const bareWithOAuth = blankRecording()
    spawnClaude(request({}, createClaudeConfigDir(), OAUTH_CREDENTIAL, 'bare'), {
      spawn: recordingSpawn(bareWithOAuth, 4242),
    })
    expect(bareWithOAuth.options.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(bareWithOAuth.options.env['ANTHROPIC_API_KEY']).toBeUndefined()

    const nativeWithApiKey = blankRecording()
    spawnClaude(request({ ANTHROPIC_API_KEY: 'stray' }, createClaudeConfigDir(), CREDENTIAL, 'native'), {
      spawn: recordingSpawn(nativeWithApiKey, 4242),
    })
    expect(nativeWithApiKey.options.env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(nativeWithApiKey.options.env['ANTHROPIC_API_KEY']).toBeUndefined()
  })

  test('the native profile with no credential carries neither spelling, for the census and negative legs', () => {
    const recorded = blankRecording()
    spawnClaude(request({ ANTHROPIC_API_KEY: 'left-behind' }, createClaudeConfigDir(), null, 'native'), {
      spawn: recordingSpawn(recorded, 4242),
    })

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

describe('the custom child environment', () => {
  test('customEnv entries ride the child environment', () => {
    const recorded = blankRecording()
    const child = spawnClaude(
      {
        ...request(),
        customEnv: { CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1', CLAUDE_CODE_SUBAGENT_MODEL: 'claude-haiku-4-5' },
      },
      { spawn: recordingSpawn(recorded, 4242) },
    )

    expect(recorded.options.env['CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING']).toBe('1')
    expect(recorded.options.env['CLAUDE_CODE_SUBAGENT_MODEL']).toBe('claude-haiku-4-5')
    expect(child.env).toEqual(recorded.options.env)
  })

  test('the route’s own values win for the injected names — the merge order proven', () => {
    // The knob's refused set makes these entries unreachable through the
    // parser; the fold sits between the name strip and the credential re-add
    // so the route's values win by construction anyway — the defence in depth
    // behind the rule (design D3 of `claude-route-custom-env`).
    const req = request()
    const recorded = blankRecording()
    spawnClaude(
      {
        ...req,
        customEnv: {
          DISABLE_AUTOUPDATER: '0',
          CLAUDE_CONFIG_DIR: '/operator/chosen/dir',
          ANTHROPIC_API_KEY: 'operator-chosen-credential',
        },
      },
      { spawn: recordingSpawn(recorded, 4242) },
    )

    expect(recorded.options.env['DISABLE_AUTOUPDATER']).toBe('1')
    expect(recorded.options.env['CLAUDE_CONFIG_DIR']).toBe(req.configDir)
    expect(recorded.options.env['ANTHROPIC_API_KEY']).toBe(CREDENTIAL.value)
  })

  test('a request without customEnv yields an env byte-identical to the pre-change build', () => {
    // The unset knob is the ordinary case: the exact key set and values the
    // route always built, and nothing more.
    const recorded = blankRecording()
    const child = spawnClaude(
      request({
        LLM_BASE_URL: 'https://gateway.example/v1',
        AGENT_MCP_SERVERS: '{"index":{"headers":{"authorization":"Bearer mcp"}}}',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-not-the-chosen-one',
      }),
      { spawn: recordingSpawn(recorded, 4242) },
    )

    expect(recorded.options.env).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: CREDENTIAL.value,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CONFIG_DIR: child.configDir,
    })
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

describe('the empty-MCP document writer', () => {
  // The native profile's neutralization needs one JSON file naming zero
  // servers, written into the job-scoped config dir at boot (design D2) —
  // inert content beside the session files, with the dir's own lifetime.

  test('writes one JSON file naming zero servers into the config dir, returning its path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claude-empty-mcp-test-'))
    try {
      const configDir = createClaudeConfigDir(root)
      expect(readdirSync(configDir)).toEqual([])

      const target = writeClaudeEmptyMcpConfig(configDir)

      expect(target).toBe(path.join(configDir, EMPTY_MCP_CONFIG_NAME))
      expect(existsSync(target)).toBe(true)
      const written = readdirSync(configDir)
      expect(written).toEqual([EMPTY_MCP_CONFIG_NAME])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the content is inert: one object whose mcpServers map is empty', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claude-empty-mcp-test-'))
    try {
      const target = writeClaudeEmptyMcpConfig(createClaudeConfigDir(root))
      const parsed = JSON.parse(readFileSync(target, 'utf8')) as unknown

      // Exactly one key, naming zero servers: nothing here can connect,
      // wherever the CLI is run from.
      expect(parsed).toEqual({ mcpServers: {} })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('overwriting is idempotent — the same doc twice writes the same bytes', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'claude-empty-mcp-test-'))
    try {
      const configDir = createClaudeConfigDir(root)
      const first = readFileSync(writeClaudeEmptyMcpConfig(configDir), 'utf8')
      const second = readFileSync(writeClaudeEmptyMcpConfig(configDir), 'utf8')

      expect(second).toBe(first)
      expect(readdirSync(configDir)).toEqual([EMPTY_MCP_CONFIG_NAME])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

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
