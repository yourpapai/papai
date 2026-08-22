// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { dependencyDriftError } from './errors.js'
import type { GitFn } from './git-commit.js'

/**
 * The manifests whose divergence from base desyncs `node_modules`.
 *
 * `bun.lock` covers every workspace — it is one lockfile at the root — and the
 * `package.json` glob (`:(glob)` magic, see `MANIFEST_PATHS` below) reaches each
 * workspace's own manifest, which is where a dependency is declared before the
 * lockfile resolves it. The root manifest is named beside the glob so no reader
 * has to know that the glob also matches it.
 *
 * Deliberately **not** a broader "config files" list: a drifted `tsconfig.json`
 * or `bunfig.toml` changes what the checks say, not what is installed, and a
 * guard this blunt should refuse only the branches that *cannot* run. The cost
 * of a refusal is a parked issue, so a false positive here is not free.
 */
const MANIFEST_PATHS = ['bun.lock', 'package.json', ':(glob)**/package.json'] as const

/**
 * Refuses a branch whose dependency manifests differ from `origin/<base>`.
 *
 * The workflow installs dependencies from the base-branch checkout —
 * deliberately, so a branch the model writes to never decides what
 * `bun install` executes in a job holding every repository secret — and
 * `ensureBranch` switches the tree onto the agent branch *after* that, with no
 * second install. A branch whose manifests have drifted from base therefore
 * runs every check against a `node_modules` that cannot serve it: run
 * 32507905723 burned a full PLANNING turn and then died in the pre-commit hook
 * on `TS2307: Cannot find module '@clack/prompts'`, an import the base lockfile
 * had stopped carrying two merges earlier.
 *
 * Refusing at the branch switch costs one `git diff --name-only` and names the
 * remedy instead. `/sync` lifts the refusal (it *is* the remedy), and a branch
 * that intentionally changed dependencies is told the truth: the job cannot
 * install from the agent branch by design, so a maintainer reconciles by hand.
 *
 * Called after the checkout, so `HEAD` is the branch this run will stand on.
 */
export const assertManifestsInSync = async (gitOrThrow: GitFn, branch: string, base: string): Promise<void> => {
  const diff = await gitOrThrow('diff', '--name-only', `origin/${base}`, 'HEAD', '--', ...MANIFEST_PATHS)
  const drifted = diff.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (drifted.length > 0) throw dependencyDriftError(branch, base, drifted)
}
