import { afterEach, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'

import { createLoggerMock } from '../utils/logger-mock.js'

type SpawnRecord = {
  command: string
  args: readonly string[]
}

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
}

const createMockChildProcess = (): MockChildProcess => {
  const process = new EventEmitter() as MockChildProcess
  process.stdout = new EventEmitter()
  process.stderr = new EventEmitter()
  return process
}

afterEach(() => {
  mock.restore()
})

test('startKaneoServer starts only kaneo service through compose', async () => {
  const spawnCalls: SpawnRecord[] = []
  const childProcess = createMockChildProcess()
  const logger = createLoggerMock()

  void mock.module('../../src/logger.js', () => ({
    getLogLevel: (): string => 'info',
    logger,
  }))

  void mock.module('child_process', () => ({
    spawn: (command: string, args: readonly string[]): MockChildProcess => {
      spawnCalls.push({ command, args })
      queueMicrotask(() => {
        childProcess.emit('close', 0)
      })
      return childProcess
    },
  }))

  const { startKaneoServer } = await import('./docker-lifecycle.js')

  await startKaneoServer()

  expect(spawnCalls).toHaveLength(1)
  expect(spawnCalls[0]).toEqual({
    command: 'docker',
    args: ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml', 'up', '-d', 'kaneo'],
  })
})
