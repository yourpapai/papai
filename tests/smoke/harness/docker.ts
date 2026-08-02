// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/harness/docker.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fileURLToPath } from 'node:url'

export type DockerResult = { code: number; stdout: string; stderr: string }
export type RunDocker = (args: string[], opts?: { input?: string }) => Promise<DockerResult>

export async function runDocker(args: string[], opts: { input?: string } = {}): Promise<DockerResult> {
  const proc = Bun.spawn(['docker', ...args], {
    stdin: opts.input === undefined ? 'ignore' : new TextEncoder().encode(opts.input),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  return { code, stdout, stderr }
}

export function repoRoot(): string {
  // this file lives at tests/smoke/harness/docker.ts; three levels up is the repo root.
  return fileURLToPath(new URL('../../../', import.meta.url))
}

export type DockerRunSpec = {
  image: string
  env: Record<string, string>
  detached: boolean
  publishContainerPort?: number
  addHostGateway?: boolean
}

export function buildDockerRunArgs(spec: DockerRunSpec): string[] {
  const args: string[] = ['run', spec.detached ? '-d' : '--rm']
  if (spec.addHostGateway === true) args.push('--add-host=host.docker.internal:host-gateway')
  if (spec.publishContainerPort !== undefined) args.push('-p', `127.0.0.1::${spec.publishContainerPort}`)
  for (const [key, value] of Object.entries(spec.env)) args.push('-e', `${key}=${value}`)
  args.push(spec.image)
  return args
}

export function parsePublishedPort(dockerPortStdout: string): number {
  const firstLine = dockerPortStdout.split('\n').find((line) => line.trim().length > 0)
  if (firstLine === undefined) throw new Error(`docker port produced no output: ${JSON.stringify(dockerPortStdout)}`)
  const port = Number(firstLine.trim().split(':').at(-1))
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Could not parse published port from: ${firstLine}`)
  return port
}

export async function isDockerAvailable(run: RunDocker = runDocker): Promise<boolean> {
  try {
    const { code } = await run(['version'])
    return code === 0
  } catch {
    return false
  }
}
