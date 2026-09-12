// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { loadBaseline } from './baseline.js'
import { selectChangedMutationTargets } from './changed-files.js'
import { buildCoverageMap, createDefaultCoverageMapDeps } from './coverage-map.js'
import { createIncrementalDeps } from './incremental-run.js'
import { pairedRun } from './paired-run.js'
import { DEFAULT_RESULTS_DIR, parseShardCliArgs, SHARD_CLI_USAGE } from './shard-cli.js'
import type { ShardCliArgs } from './shard-cli.js'
import { readShardPlan, readShardResult, writeShardPlan } from './shard-io.js'
import { measureShard, resolveShardExitCode } from './shard-measure.js'
import type { ShardResult } from './shard-measure.js'
import { buildShardPlan } from './shard-plan.js'
import { runShardedGate } from './shard-reconcile.js'
import { createDefaultWeightDeps } from './shard-weights.js'

/**
 * Production wiring for the three-stage gate. Every decision lives in the modules this composes;
 * what is here is the filesystem and process-exit boundary.
 */

const REPORT_DIR = 'reports/paired'
const BASELINE_FILE = 'scripts/mutation/baseline.json'

type BunLike = { readonly argv: readonly string[]; readonly main: string }

const runPlan = (args: Extract<ShardCliArgs, { kind: 'plan' }>, projectRoot: string): number => {
  const reportDir = path.join(projectRoot, REPORT_DIR)
  const incremental = args.noScoreCache ? undefined : createIncrementalDeps({ projectRoot, reportDir })
  const manifest = buildShardPlan({
    projectRoot,
    baseRef: args.baseRef,
    cap: args.cap,
    singleShardThresholdSeconds: args.minWorkSeconds,
    targetWallSeconds: args.targetWallSeconds,
    deps: {
      selectTargets: (baseRef, root) => selectChangedMutationTargets({ baseRef, projectRoot: root, deps: undefined }),
      planIncremental: incremental?.plan,
      buildCoverageMap: (sourceFiles) =>
        buildCoverageMap({ sourceFiles, projectRoot, deps: createDefaultCoverageMapDeps(projectRoot) }),
      weightDeps: createDefaultWeightDeps(projectRoot),
      now: () => Date.now(),
      log: (message) => {
        console.log(message)
      },
    },
  })
  writeShardPlan(path.resolve(projectRoot, args.out), manifest)
  console.log(`Shard plan written to ${args.out} (${manifest.shards.length} shard(s))`)
  return 0
}

const runShard = async (args: Extract<ShardCliArgs, { kind: 'shard' }>, projectRoot: string): Promise<number> => {
  const manifest = readShardPlan(path.resolve(projectRoot, args.plan))
  if (manifest === null) {
    console.error(`Unreadable shard plan at ${args.plan}; refusing to guess what to measure.`)
    return 1
  }
  const result = await measureShard({
    projectRoot,
    reportDir: path.join(projectRoot, REPORT_DIR),
    shardIndex: args.shardIndex,
    plan: manifest,
    verbose: args.verbose,
    deps: {
      runPaired: pairedRun,
      now: () => Date.now(),
      log: (message) => {
        console.log(message)
      },
    },
  })
  const out = path.resolve(projectRoot, args.out)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)
  return resolveShardExitCode(result)
}

/**
 * Read every shard result the run produced. A file that is missing or unreadable contributes
 * nothing — which is precisely how a lost shard reaches the gate as missing targets rather than
 * as a narrower verdict.
 */
const readShardResults = (dir: string): ShardResult[] => {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .toSorted()
      .flatMap((name) => {
        const result = readShardResult(path.join(dir, name))
        if (result !== null) return [result]
        console.error(`Ignoring unreadable shard result ${name}; its targets will surface as missing.`)
        return []
      })
  } catch {
    return []
  }
}

const runGate = (args: Extract<ShardCliArgs, { kind: 'gate' }>, projectRoot: string): number => {
  const manifest = readShardPlan(path.resolve(projectRoot, args.plan))
  if (manifest === null) {
    console.error(`Unreadable shard plan at ${args.plan}; cannot establish what this run had to measure.`)
    return 1
  }
  const reportDir = path.join(projectRoot, REPORT_DIR)
  const incremental = createIncrementalDeps({ projectRoot, reportDir })
  const verdict = runShardedGate({
    plan: manifest,
    results: readShardResults(path.resolve(projectRoot, args.resultsDir)),
    baseline: loadBaseline(path.join(projectRoot, BASELINE_FILE)) ?? {},
    threshold: args.threshold,
    noRatchet: args.noRatchet,
    deps: {
      record: (entries) => {
        incremental.record(entries)
      },
      log: (message) => {
        console.log(message)
      },
    },
  })
  if (verdict.message !== null) console.error(verdict.message)
  return verdict.exitCode
}

const main = (bun: BunLike): Promise<number> => {
  const parsed = parseShardCliArgs(bun.argv.slice(2))
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    console.error(SHARD_CLI_USAGE)
    return Promise.resolve(2)
  }
  const projectRoot = process.cwd()
  if (parsed.kind === 'shard') return runShard(parsed, projectRoot)
  return Promise.resolve(parsed.kind === 'plan' ? runPlan(parsed, projectRoot) : runGate(parsed, projectRoot))
}

export { DEFAULT_RESULTS_DIR }

const maybeBun = (globalThis as typeof globalThis & { readonly Bun: BunLike | undefined }).Bun
if (maybeBun !== undefined && import.meta.path === maybeBun.main) {
  process.exit(await main(maybeBun))
}
