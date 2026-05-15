import { spawn } from 'child_process'

import { logger } from '../../src/logger.js'

const log = logger.child({ scope: 'e2e:docker' })

let dockerStarted = false

export function startKaneoServer(): Promise<void> {
  if (dockerStarted) {
    log.info('Docker already started, skipping')
    return Promise.resolve()
  }

  log.info('Starting Kaneo server via Docker Compose')

  const dockerUp = spawn(
    'docker',
    ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml', 'up', '-d', 'kaneo'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    dockerUp.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    dockerUp.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    dockerUp.on('close', (code) => {
      if (code === 0) {
        log.info('Kaneo server started successfully')
        dockerStarted = true
        resolve()
      } else {
        log.error({ code, stderr }, 'Failed to start Kaneo server')
        reject(new Error(`Docker compose up failed with code ${code}: ${stderr}`))
      }
    })

    dockerUp.on('error', (error) => {
      log.error({ error: error.message }, 'Failed to spawn docker compose')
      reject(error)
    })
  })
}

export function stopKaneoServer(): Promise<void> {
  if (!dockerStarted) {
    log.info('Docker not started by this process, skipping stop')
    return Promise.resolve()
  }

  log.info('Stopping Kaneo server')

  const dockerDown = spawn(
    'docker',
    ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.test.yml', 'down', '-v'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  return new Promise((resolve) => {
    let stderr = ''

    dockerDown.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    dockerDown.on('close', (code) => {
      if (code === 0) {
        log.info('Kaneo server stopped successfully')
      } else {
        log.warn({ code, stderr }, 'Kaneo server stop completed with warnings')
      }
      dockerStarted = false
      resolve()
    })

    dockerDown.on('error', (error) => {
      log.error({ error: error.message }, 'Failed to stop Kaneo server')
      dockerStarted = false
      resolve()
    })
  })
}

export function isDockerStarted(): boolean {
  return dockerStarted
}
