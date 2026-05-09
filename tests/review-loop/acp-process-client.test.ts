import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync as readFileSyncNode, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createAcpProcessClient } from '../../review-loop/src/acp-process-client.js'
import { handlePermissionRequest } from '../../review-loop/src/acp-process-client.js'
import { bootstrapAgentSession } from '../../review-loop/src/agent-session.js'

const tempDirs: string[] = []
const missingExecutable = 'definitely-not-a-real-command-xyz'

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 5000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}

async function waitForAvailableCommand(
  session: { availableCommands: string[] },
  client: { waitForSessionUpdates(): Promise<void> },
  command: string,
): Promise<void> {
  await withTimeout(
    (async (): Promise<void> => {
      while (!session.availableCommands.includes(command)) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0)
        })
        await client.waitForSessionUpdates()
      }
    })(),
    `timed out waiting for available command ${command}`,
  )
}

describe('ACP process client', () => {
  test('defaults permission requests to reject when no handler is configured', () => {
    const response = handlePermissionRequest(
      {
        command: 'bun',
        args: [],
        cwd: '/repo',
        transcriptPath: '/tmp/transcript.ndjson',
      },
      {
        sessionId: 'sess_fake',
        toolCall: {
          toolCallId: 'call_1',
          title: 'Edit queue.ts',
          kind: 'edit',
          status: 'pending',
          locations: [{ path: '/repo/src/queue.ts' }],
          rawInput: { path: '/repo/src/queue.ts' },
        },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ],
      },
    )

    expect(response).toEqual({
      outcome: {
        outcome: 'selected',
        optionId: 'reject',
      },
    })
  })

  test('falls back to reject when the permission handler returns an invalid option', () => {
    const response = handlePermissionRequest(
      {
        command: 'bun',
        args: [],
        cwd: '/repo',
        transcriptPath: '/tmp/transcript.ndjson',
        selectPermissionOptionId: () => 'not-an-option',
      },
      {
        sessionId: 'sess_fake',
        toolCall: {
          toolCallId: 'call_1',
          title: 'Edit queue.ts',
          kind: 'edit',
          status: 'pending',
          locations: [{ path: '/repo/src/queue.ts' }],
          rawInput: { path: '/repo/src/queue.ts' },
        },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ],
      },
    )

    expect(response).toEqual({
      outcome: {
        outcome: 'selected',
        optionId: 'reject',
      },
    })
  })

  test('initializes the subprocess, creates a session, and collects text replies', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const scenarioPath = path.join(tempDir, 'reviewer-scenario.json')
    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    writeFileSync(
      scenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [{ text: '{"round":1,"issues":[]}' }],
          emitAvailableCommandsUpdate: true,
        },
        null,
        2,
      ),
    )

    const client = await createAcpProcessClient({
      command: 'bun',
      args: ['tests/review-loop/fake-agent.ts'],
      cwd: process.cwd(),
      env: { ...process.env, ACP_SCENARIO_FILE: scenarioPath },
      transcriptPath,
    })

    const session = await bootstrapAgentSession(client, {
      cwd: process.cwd(),
      previousSessionId: null,
      sessionConfig: { mode: 'review' },
    })

    await waitForAvailableCommand(session, client, 'review-code')
    expect(session.availableCommands).toEqual(['review-code'])

    const reply = await session.promptText('/review-code review the current diff')
    expect(reply.stopReason).toBe('end_turn')
    expect(reply.text).toContain('"issues":[]')
    expect(readFileSyncNode(transcriptPath, 'utf8')).toContain('"method":"session/set_config_option"')
    expect(readFileSyncNode(transcriptPath, 'utf8')).toContain('"sessionUpdate":"agent_message_chunk"')

    await client.close()
  })

  test('does not wait for command advertisements when the agent omits them', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const scenarioPath = path.join(tempDir, 'reviewer-scenario.json')
    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    writeFileSync(
      scenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [{ text: '{"round":1,"issues":[]}' }],
          emitAvailableCommandsUpdate: false,
        },
        null,
        2,
      ),
    )

    const client = await createAcpProcessClient({
      command: 'bun',
      args: ['tests/review-loop/fake-agent.ts'],
      cwd: process.cwd(),
      env: { ...process.env, ACP_SCENARIO_FILE: scenarioPath },
      transcriptPath,
    })

    const session = await withTimeout(
      bootstrapAgentSession(client, {
        cwd: process.cwd(),
        previousSessionId: null,
        sessionConfig: {},
      }),
      'bootstrapAgentSession timed out waiting for unavailable commands',
    )

    expect(session.availableCommands).toEqual([])

    const reply = await session.promptText('review the current diff')
    expect(reply.stopReason).toBe('end_turn')
    expect(reply.text).toContain('"issues":[]')

    await client.close()
  })

  test('surfaces subprocess startup failures as bootstrap errors', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    await expect(
      withTimeout(
        createAcpProcessClient({
          command: missingExecutable,
          args: [],
          cwd: process.cwd(),
          transcriptPath,
        }),
        'createAcpProcessClient timed out waiting for subprocess startup failure',
      ),
    ).rejects.toThrow(`ACP subprocess failed: Executable not found in $PATH: "${missingExecutable}"`)
  })

  test('collects every prompt chunk when notifications interleave', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const scenarioPath = path.join(tempDir, 'reviewer-scenario.json')
    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    writeFileSync(
      scenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [
            {
              chunks: ['{"round":', '1,', '"issues":[]}'],
              interleaveAvailableCommandsUpdate: true,
            },
          ],
        },
        null,
        2,
      ),
    )

    const client = await createAcpProcessClient({
      command: 'bun',
      args: ['tests/review-loop/fake-agent.ts'],
      cwd: process.cwd(),
      env: { ...process.env, ACP_SCENARIO_FILE: scenarioPath },
      transcriptPath,
    })

    const session = await bootstrapAgentSession(client, {
      cwd: process.cwd(),
      previousSessionId: null,
      sessionConfig: {},
    })

    const reply = await session.promptText('/review-code review the current diff')
    expect(reply.text).toBe('{"round":1,"issues":[]}')
    expect(reply.stopReason).toBe('end_turn')

    await client.close()
  })

  test('fails fast when the subprocess exits during a prompt', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const scenarioPath = path.join(tempDir, 'reviewer-scenario.json')
    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    writeFileSync(
      scenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [{ text: 'partial', exitDuringPrompt: true }],
        },
        null,
        2,
      ),
    )

    const client = await createAcpProcessClient({
      command: 'bun',
      args: ['tests/review-loop/fake-agent.ts'],
      cwd: process.cwd(),
      env: { ...process.env, ACP_SCENARIO_FILE: scenarioPath },
      transcriptPath,
    })

    const session = await bootstrapAgentSession(client, {
      cwd: process.cwd(),
      previousSessionId: null,
      sessionConfig: {},
    })

    await expect(
      withTimeout(
        session.promptText('/review-code review the current diff'),
        'promptText timed out waiting for subprocess exit',
      ),
    ).rejects.toThrow('ACP subprocess exited with code 1')
  })

  test('forces shutdown when the subprocess ignores SIGTERM', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const scenarioPath = path.join(tempDir, 'reviewer-scenario.json')
    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    writeFileSync(
      scenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [{ text: '{"round":1,"issues":[]}' }],
          ignoreSigtermOnShutdown: true,
        },
        null,
        2,
      ),
    )

    const client = await createAcpProcessClient({
      command: 'bun',
      args: ['tests/review-loop/fake-agent.ts'],
      cwd: process.cwd(),
      env: { ...process.env, ACP_SCENARIO_FILE: scenarioPath },
      transcriptPath,
    })

    await withTimeout(client.close(), 'client.close timed out waiting for forced shutdown')
  })
})
