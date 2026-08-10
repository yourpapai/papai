// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { realSpawn } from '../../review-loop/src/spawn.js'
import { main } from './cli.js'
import type { CliHarness } from './cli.js'
import { discoverBranch, loadRunnerConfig } from './config.js'
import type { ExecGitFn } from './config.js'
import { readEvents } from './events.js'
import { createOpenSpecDriver } from './openspec-driver.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { runGateResume, runResume, runStart } from './orchestrator.js'
import { createRenderer } from './renderer.js'
import { buildReport } from './report.js'
import type { ChangeDirSummary, ReportInput } from './report.js'
import { loadRunState } from './run-state.js'

export const USAGE = [
  'sdd-runner — autonomous SDD pipeline',
  '',
  'Usage:',
  '  sdd-runner start <task-file> [--depth S|M|L] [--wait] [--verbosity brief|normal|debug]',
  '  sdd-runner resume <runId>',
  '  sdd-runner gate resume <runId> [--confirm-all] [--abort]',
  '  sdd-runner report <runId> [--pr]',
].join('\n')

export async function readChangeSummary(repoRoot: string, changeName: string): Promise<ChangeDirSummary> {
  const changeDir = path.join(repoRoot, 'openspec', 'changes', changeName)
  let tasksDone = 0
  let tasksTotal = 0
  try {
    const tasksMd = await readFile(path.join(changeDir, 'tasks.md'), 'utf8')
    for (const line of tasksMd.split('\n')) {
      const checked = /^\s*- \[x\]/iu.test(line)
      const unchecked = /^\s*- \[ \]/iu.test(line)
      if (checked || unchecked) {
        tasksTotal += 1
        if (checked) tasksDone += 1
      }
    }
  } catch {
    // no tasks.md yet
  }
  const artifacts = await listArtifacts(changeDir)
  return { tasksDone, tasksTotal, artifacts }
}
async function listArtifacts(dir: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const perEntry = await Promise.all(
    entries.map((entry): Promise<string[]> => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return listArtifacts(full)
      return Promise.resolve(entry.name.endsWith('.md') ? [entry.name] : [])
    }),
  )
  return perEntry.flat()
}

function makeExecGit(): ExecGitFn {
  return (cwd, args) =>
    new Promise((resolve) => {
      execFile('git', [...args], { cwd }, (error, stdout, stderr) => {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? error?.message ?? '' })
      })
    })
}

function shellExec(
  driverCwd: string,
): (args: readonly string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return (args) =>
    new Promise((resolve) => {
      execFile(args[0] ?? 'openspec', [...args.slice(1)], { cwd: driverCwd }, (error, stdout, stderr) => {
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode })
      })
    })
}

async function buildHarness(): Promise<CliHarness> {
  const configPath = process.env['SDD_RUNNER_CONFIG'] ?? path.join(import.meta.dir, '..', 'config.json')
  const config = await loadRunnerConfig(configPath)
  const driver: OpenSpecDriver = createOpenSpecDriver({ exec: shellExec(config.repoRoot), cwd: config.repoRoot })
  const execGit = makeExecGit()
  const renderer = createRenderer(process.stdout, 'normal')
  const orchestratorDeps = {
    config,
    spawn: realSpawn,
    execGit,
    driver,
    render: renderer.renderEvent,
    stdout: (line: string): void => {
      process.stdout.write(`${line}\n`)
    },
  }
  return {
    runStart: (options) => runStart(orchestratorDeps, options),
    runResume: (runId) => runResume(orchestratorDeps, runId),
    runGateResume: (runId, options) => runGateResume(orchestratorDeps, runId, options),
    buildReport: async (runId, pr) => {
      const state = await loadRunState(config.workDir, runId)
      const branch = await discoverBranch(execGit, config.repoRoot)
      const input: ReportInput = {
        readEvents: () => readEvents(path.join(config.workDir, 'runs', runId, 'events.ndjson')),
        readChangeDir: () => readChangeSummary(config.repoRoot, state.changeName),
        execGit,
        runId,
        changeName: state.changeName,
        branch,
        pr,
      }
      return buildReport(input)
    },
    stdout: (line) => {
      process.stdout.write(`${line}\n`)
    },
  }
}

async function runEntry(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const harness = await buildHarness()
  const code = await main(argv, harness)
  process.exit(code)
}

if (import.meta.main) {
  void runEntry()
}
