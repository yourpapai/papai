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
import { parseSddArgs } from './cli.js'
import { discoverBranch, loadRunnerConfig } from './config.js'
import type { ExecGitFn } from './config.js'
import { readEvents } from './events.js'
import type { EventInput } from './events.js'
import { buildResolveCost } from './gate-digest.js'
import type { OrchestratorDeps } from './gate-digest.js'
import { runGateReopen, latestSettledGateVersion } from './gate.js'
import type { LiveViewWiring } from './live-view.js'
import { wireLiveView } from './live-view.js'
import { createOpenSpecDriver } from './openspec-driver.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { runContinue, runGateResume, runResume, runStart } from './orchestrator.js'
import { stdinIsInteractive } from './prompter.js'
import { createRenderer } from './renderer.js'
import type { Verbosity } from './renderer.js'
import { buildReport } from './report.js'
import type { ChangeDirSummary, ReportInput } from './report.js'
import { loadRunState, resolveRunId } from './run-state.js'
import { executeSessionTarget } from './session-flow.js'
import type { SessionFlowDeps } from './session-flow.js'
import { requestCalmStop, stopRun } from './stop-controller.js'
import { registerTerminalTitle, TERMINAL_TITLE_RESTORE } from './terminal-title.js'
import { createRunScreenSession } from './tui-run-session.js'
import { runSessionPicker } from './tui-session-picker.js'

export const USAGE = [
  'sdd — autonomous SDD pipeline',
  '',
  'Usage:',
  '  sdd [<task-file> | <run-id>] [--depth S|M|L] [--pr] [--reopen [<n>]] [--config <path>]',
  '  sdd stop [<run-id>]',
  '',
  'A task file starts a run; a run id routes by its state (gate decision, resume, report).',
  'No target opens the session screen on a terminal — a loop, not a launcher: pick a run',
  '(Enter/s/r), start one from a typed description (n), and every finished action returns',
  'to the refreshed list; only an explicit quit (q) exits. Non-terminals keep the',
  'list-and-exit contract. Gate decisions: the TUI on a terminal; else hand-edit the gate file.',
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

/** Mode-decided live view for this process: Ink run screen on a TTY, lines otherwise. */
function harnessLiveView(lineRender: (event: EventInput) => void): LiveViewWiring {
  return wireLiveView(
    { stdout: { isTTY: process.stdout.isTTY }, stdin: { isTTY: process.stdin.isTTY } },
    process.env,
    lineRender,
    ({ runDir, logPath }) =>
      createRunScreenSession({
        logPath,
        requestCalmStop: (): void => {
          requestCalmStop(runDir)
        },
        hardExit: (code): void => {
          process.exit(code)
        },
      }),
  )
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

async function buildHarness(verbosity: Verbosity = 'normal', configOverride?: string): Promise<CliHarness> {
  const configPath =
    configOverride ?? process.env['SDD_RUNNER_CONFIG'] ?? path.join(import.meta.dir, '..', 'config.json')
  const config = await loadRunnerConfig(configPath)
  const driver: OpenSpecDriver = createOpenSpecDriver({ exec: shellExec(config.repoRoot), cwd: config.repoRoot })
  const execGit = makeExecGit()
  const resolveCost = await buildResolveCost()
  const renderer = createRenderer(process.stdout, verbosity, { resolveCost })
  const live = harnessLiveView(renderer.renderEvent)
  registerTitleIfTty(process.stdout)
  const orchestratorDeps: OrchestratorDeps = {
    config,
    spawn: realSpawn,
    execGit,
    driver,
    ...(live.mode === 'tui'
      ? {
          liveEvents: live.liveEvents,
          mountRunScreen: live.mountRunScreen,
          unmountRunScreen: live.unmountRunScreen,
        }
      : { render: live.render }),
    stdout: harnessStdout,
    interactive: (): boolean => stdinIsInteractive(),
  }
  return harnessMembers(config, orchestratorDeps, execGit)
}

function harnessMembers(
  config: { readonly workDir: string; readonly repoRoot: string },
  orchestratorDeps: OrchestratorDeps,
  execGit: ExecGitFn,
): CliHarness {
  const members: CliHarness = {
    workDir: config.workDir,
    runStart: (options) => runStart(orchestratorDeps, options),
    runResume: (runId, autonomy) => runResume(orchestratorDeps, runId, autonomy),
    runGateResume: async (runId) => {
      const resolved = await resolveRunId(config.workDir, runId)
      return runGateResume(orchestratorDeps, resolved, {})
    },
    runContinue: (runId, autonomy) => runContinue(orchestratorDeps, runId, autonomy),
    requestCalmStop: (runId) => stopRun(config.workDir, runId),
    runGateReopen: (runId, gateVersion) =>
      resolveAndCall(config.workDir, runId, (r) => runGateReopen(orchestratorDeps, config.workDir, r, gateVersion)),
    buildReport: (runId, pr) => buildRunReport(config, runId, pr, execGit),
    stdout: harnessStdout,
    interactive: (): boolean => stdinIsInteractive(),
    latestSettledGateVersion: (runId) =>
      resolveAndCall(config.workDir, runId, (r) => latestSettledGateVersion(config.workDir, r)),
  }
  return { ...members, sessionLoop: sessionLoopOf(config, orchestratorDeps, members, execGit) }
}

type DepthOverride = Parameters<typeof runStart>[1] extends { depthOverride?: infer D } ? D : never

function sessionFlowDepsOf(members: CliHarness): SessionFlowDeps {
  return {
    runGateResume: (runId) => members.runGateResume(runId),
    runResume: (runId) => members.runResume(runId),
    buildReport: (runId) => members.buildReport(runId, false),
    requestCalmStop: (runId) => members.requestCalmStop(runId),
    reopenGate: async (runId) => {
      const version = await members.latestSettledGateVersion?.(runId)
      if (version === undefined || version === null) throw new Error(`run ${runId} has no settled gate to reopen`)
      await members.runGateReopen(runId, version)
    },
    stdout: members.stdout,
  }
}

function sessionLoopOf(
  config: { readonly workDir: string; readonly repoRoot: string },
  orchestratorDeps: OrchestratorDeps,
  members: CliHarness,
  execGit: ExecGitFn,
): (options: { readonly initial: 'list' | 'create'; readonly depth?: DepthOverride }) => Promise<void> {
  return async (options): Promise<void> => {
    await runSessionPicker({
      workDir: config.workDir,
      ...(options.initial === 'list' ? {} : { initial: options.initial }),
      execute: (action) => executeSessionTarget(action, sessionFlowDepsOf(members)),
      buildReport: (runId) => buildRunReport(config, runId, false, execGit),
      createRun: async (taskText): Promise<void> => {
        const started = await runStart(orchestratorDeps, {
          taskText,
          ...(options.depth === undefined ? {} : { depthOverride: options.depth }),
        })
        members.stdout(`started ${started.runId}`)
      },
    })
  }
}

function harnessStdout(line: string): void {
  process.stdout.write(`${line}\n`)
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
  const parsed = parseSddArgs(argv)
  const harness = await buildHarness('normal', parsed.configPath)
  const code = await main(argv, harness)
  process.exit(code)
}

if (import.meta.main) {
  void runEntry()
}
