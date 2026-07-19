// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { STORIES_DIR } from './config.js'

export function formatDateStamp(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveBranchName(): string {
  return process.env['BEHAVIOR_AUDIT_PUBLISH_BRANCH'] ?? 'audit-output'
}

export function resolveTagName(): string {
  return process.env['BEHAVIOR_AUDIT_PUBLISH_TAG'] ?? 'audit-output-latest'
}

export function buildCommitMessage(dateStamp: string): string {
  return `chore(audit): snapshot for ${dateStamp}`
}

export function resolveStoriesPath(): string {
  return STORIES_DIR
}

export interface GitOps {
  run(args: readonly string[]): Promise<void>
  branchExists(): Promise<boolean>
  checkoutOrphan(branch: string): Promise<void>
  worktreePath(): Promise<string>
}

export interface PublishDeps {
  readonly storiesPath: string
  readonly dateStamp: string
  readonly gitOps: GitOps
  readonly log: Pick<Console, 'log' | 'error'>
}

export interface PublishResult {
  readonly exitCode: number
  readonly commitMessage: string | null
}

export async function runPublish(input: PublishDeps): Promise<PublishResult> {
  let entries: readonly string[]
  try {
    entries = await readdir(input.storiesPath)
  } catch {
    input.log.error(`Error: no audit output to publish (${input.storiesPath} does not exist)`)
    return { exitCode: 1, commitMessage: null }
  }
  if (entries.length === 0) {
    input.log.error(`Error: no audit output to publish (${input.storiesPath} is empty)`)
    return { exitCode: 1, commitMessage: null }
  }

  const branch = resolveBranchName()
  const tag = resolveTagName()
  const commitMessage = buildCommitMessage(input.dateStamp)
  const worktreePath = await input.gitOps.worktreePath()

  // Always recreate a fresh orphan branch so the published history contains
  // only the `stories/` snapshot, never the workflow's checkout lineage.
  // `git checkout --orphan` keeps the inherited index populated; `git rm -rf .`
  // clears both the index and the working tree so the only thing we commit is
  // the freshly written `stories/` directory below.
  //
  // CI's fetch step (`git fetch ... audit-output:audit-output`) materialises
  // `refs/heads/audit-output` locally before we run; `git checkout --orphan`
  // refuses to overwrite an existing ref, so delete it first. The delete is
  // best-effort: on a first run (or a worktree where the branch was never
  // created) the call fails and we swallow it.
  await input.gitOps.run(['branch', '-D', branch]).catch(() => {
    // ignore — branch may not exist on first run
  })
  await input.gitOps.checkoutOrphan(branch)
  await input.gitOps.run(['rm', '-rf', '.'])

  await rm(join(worktreePath, 'stories'), { recursive: true, force: true })
  await mkdir(join(worktreePath, 'stories'), { recursive: true })

  await Promise.all(
    entries.map((entry) => copyFile(join(input.storiesPath, entry), join(worktreePath, 'stories', entry))),
  )

  await input.gitOps.run(['add', 'stories'])
  await input.gitOps.run(['commit', '-m', commitMessage])
  await input.gitOps.run(['tag', '-f', tag, 'HEAD'])

  input.log.log(`Published ${entries.length} entries to ${branch} (tag ${tag}) at ${input.dateStamp}`)
  return { exitCode: 0, commitMessage }
}

export class RealGitOps implements GitOps {
  constructor(
    private readonly worktree: string,
    private readonly branch: string,
  ) {}

  async run(args: readonly string[]): Promise<void> {
    const proc = Bun.spawn(['git', ...args], {
      cwd: this.worktree,
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const [code, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
    if (code !== 0) {
      throw new Error(`git ${args.join(' ')} exited ${code}: ${stderrText.trim()}`)
    }
  }

  async branchExists(): Promise<boolean> {
    const proc = Bun.spawn(['git', 'ls-remote', '--heads', 'origin', this.branch], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    const stderrText = await new Response(proc.stderr).text()
    const code = await proc.exited
    if (code !== 0) {
      throw new Error(`git ls-remote --heads origin ${this.branch} exited ${code}: ${stderrText.trim()}`)
    }
    return out.trim().length > 0
  }

  async checkoutOrphan(branch: string): Promise<void> {
    await this.run(['checkout', '--orphan', branch])
  }

  worktreePath(): Promise<string> {
    return Promise.resolve(this.worktree)
  }
}

async function publishSnapshotMain(): Promise<number> {
  const dateStamp = formatDateStamp(new Date())
  const branch = resolveBranchName()
  const worktree = process.env['BEHAVIOR_AUDIT_WORKTREE_DIR'] ?? '.audit-worktree'
  const ops = new RealGitOps(worktree, branch)
  const result = await runPublish({
    storiesPath: resolveStoriesPath(),
    dateStamp,
    gitOps: ops,
    log: console,
  })
  if (result.exitCode !== 0) return result.exitCode
  const pushProc = Bun.spawn(
    ['git', 'push', '--force', 'origin', `${branch}:${branch}`, `refs/tags/${resolveTagName()}`],
    {
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  await pushProc.exited
  return pushProc.exitCode === 0 ? 0 : 1
}

if (import.meta.main) {
  const exitCode = await publishSnapshotMain()
  process.exit(exitCode)
}
