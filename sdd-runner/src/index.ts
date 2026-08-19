// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { realSpawn } from '../../review-loop/src/spawn.js'
import { buildAuditReport } from './audit.js'
import { main } from './cli.js'
import type { CliHarness } from './cli.js'
import { parseCliArgs } from './cli.js'
import { makePrompterFor } from './composition-prompter.js'
import { discoverBranch, loadRunnerConfig } from './config.js'
import type { ExecGitFn } from './config.js'
import { readEvents } from './events.js'
import { buildResolveCost } from './gate-digest.js'
import { stdinIsInteractive } from './gate-session.js'
import type { Prompter } from './gate-session.js'
import { runGateReopen } from './gate.js'
import { createOpenSpecDriver } from './openspec-driver.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { runContinue, runGateResume, runResume, runStart } from './orchestrator.js'
import { createRenderer } from './renderer.js'
import type { Verbosity } from './renderer.js'
import { buildReport } from './report.js'
import type { ChangeDirSummary, ReportInput } from './report.js'
import { listPendingGates, loadRunState, resolveRunId } from './run-state.js'
import { registerTerminalTitle, TERMINAL_TITLE_RESTORE } from './terminal-title.js'

export const USAGE = [
  'sdd-runner — autonomous SDD pipeline',
  '',
  'Usage:',
  '  sdd-runner start <task-file> [--depth S|M|L] [--verbosity brief|normal|debug]',
  '  sdd-runner continue [runId]',
  '  sdd-runner resume <runId>',
  '  sdd-runner gate [resume <runId> [--confirm-all] [--extend] [--veto <id>=<redirect>]... [--abort]]',
  '  sdd-runner report <runId> [--pr]',
  '',
  'On a terminal, `gate resume <runId>` (or `continue`) opens an interactive gate session.',
  'Without a TTY, pass decision flags or hand-edit the gate file. Bare `gate` lists pending gates.',
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

async function buildHarness(verbosity: Verbosity = 'normal'): Promise<CliHarness> {
  const configPath = process.env['SDD_RUNNER_CONFIG'] ?? path.join(import.meta.dir, '..', 'config.json')
  const config = await loadRunnerConfig(configPath)
  const driver: OpenSpecDriver = createOpenSpecDriver({ exec: shellExec(config.repoRoot), cwd: config.repoRoot })
  const execGit = makeExecGit()
  const resolveCost = await buildResolveCost()
  const renderer = createRenderer(process.stdout, verbosity, { resolveCost })
  registerTitleIfTty(process.stdout)
  const orchestratorDeps = {
    config,
    spawn: realSpawn,
    execGit,
    driver,
    render: renderer.renderEvent,
    stdout: (line: string): void => {
      process.stdout.write(`${line}\n`)
    },
    interactive: (): boolean => stdinIsInteractive(),
    makePrompter: (): Prompter => makePrompterFor(stdinIsInteractive(), process.env),
  }
  return {
    runStart: (options) => runStart(orchestratorDeps, options),
    runResume: (runId, autonomy) => runResume(orchestratorDeps, runId, autonomy),
    runGateResume: async (runId, options) => {
      const resolved = await resolveRunId(config.workDir, runId)
      return runGateResume(orchestratorDeps, resolved, options)
    },
    runContinue: (runId, autonomy) => runContinue(orchestratorDeps, runId, autonomy),
    listPendingGates: () => listPendingGates(config.workDir),
    buildAuditReport: (runId) => resolveAndCall(config.workDir, runId, (r) => buildAuditReport(config.workDir, r)),
    runGateReopen: (runId, gateVersion) =>
      resolveAndCall(config.workDir, runId, (r) => runGateReopen(orchestratorDeps, config.workDir, r, gateVersion)),
    buildReport: (runId, pr) => buildRunReport(config, runId, pr, execGit),
    stdout: (line) => {
      process.stdout.write(`${line}\n`)
    },
  }
}

async function buildRunReport(
  config: { readonly repoRoot: string; readonly workDir: string },
  runId: string,
  pr: boolean,
  execGit: ExecGitFn,
): Promise<string> {
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
}

function registerTitleIfTty(stream: { readonly isTTY?: boolean; write(chunk: string): boolean }): void {
  if (stream.isTTY !== true) return
  registerTerminalTitle(
    (chunk: string): void => {
      stream.write(chunk)
    },
    (): string => TERMINAL_TITLE_RESTORE,
  )
}

async function resolveAndCall<T>(workDir: string, runId: string, fn: (resolved: string) => Promise<T>): Promise<T> {
  const resolved = await resolveRunId(workDir, runId)
  return fn(resolved)
}

export async function runEntry(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const cmd = parseCliArgs(argv)
  const verbosity = cmd.subcommand === 'start' || cmd.subcommand === 'gate' ? (cmd.verbosity ?? 'normal') : 'normal'
  const harness = await buildHarness(verbosity)
  const code = await main(argv, harness)
  process.exit(code)
}

if (import.meta.main) {
  void runEntry()
}
