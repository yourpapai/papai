// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { DEFAULT_COMPARE_THRESHOLD, compareRenders, loadRegistry, planPayloads } from './figma-connect-lib.js'
import type { CompareOutcome } from './figma-connect-lib.js'

const FIGMA_NODE_ID = /^\d+:\d+$/u
export const VERIFY_ARTIFACT_DIR = join('reports', 'figma-verify')

export type ConnectArgs =
  | { command: 'validate' }
  | { command: 'plan' }
  | { command: 'verify'; story: string; figma: string; threshold: number }

export interface VerifyReport extends CompareOutcome {
  readonly story?: string
  readonly figma?: string
}

const fail = (message: string): never => {
  console.error(`status=error reason=${message}`)
  process.exit(1)
}

export const parseConnectArgs = (argv: readonly string[]): ConnectArgs => {
  const [command, ...flags] = argv
  if (command === undefined) throw new Error('missing_command')
  if (command === 'verify') return parseVerifyArgs(flags)
  if (command !== 'validate' && command !== 'plan') throw new Error(`unknown_command:${command}`)
  for (const flag of flags) throw new Error(`unknown_flag:${flag}`)
  return { command }
}

const parseVerifyArgs = (flags: readonly string[]): ConnectArgs => {
  let story: string | undefined
  let figma: string | undefined
  let threshold = DEFAULT_COMPARE_THRESHOLD
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--story') {
      story = flags[index + 1]
      if (story === undefined) throw new Error('missing_story_value')
      index += 1
    } else if (flag === '--figma') {
      figma = flags[index + 1]
      if (figma === undefined) throw new Error('missing_figma_value')
      index += 1
    } else if (flag === '--threshold') {
      const value = Number(flags[index + 1])
      if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error('invalid_threshold')
      threshold = value
      index += 1
    } else {
      throw new Error(`unknown_flag:${flag}`)
    }
  }
  if (story === undefined) throw new Error('missing_story')
  if (figma === undefined) throw new Error('missing_figma')
  return { command: 'verify', story, figma, threshold }
}

const readFileOrUndefined = (path: string): Uint8Array | undefined => {
  if (!existsSync(path)) return undefined
  return new Uint8Array(readFileSync(path))
}

export const runVerify = (args: {
  command: 'verify'
  story: string
  figma: string
  threshold: number
}): VerifyReport => {
  const base = { story: args.story, figma: args.figma, threshold: args.threshold }
  const storyPng = readFileOrUndefined(args.story)
  if (storyPng === undefined) {
    return { ...base, status: 'skip', missingSide: 'story', reason: `missing_story_render: ${args.story}` }
  }
  if (FIGMA_NODE_ID.test(args.figma)) {
    return {
      ...base,
      status: 'skip',
      missingSide: 'figma',
      reason: `figma_node_requires_export: ${args.figma} — export the node render (figma download_assets) and re-run with the PNG path`,
    }
  }
  const figmaPng = readFileOrUndefined(args.figma)
  if (figmaPng === undefined) {
    return { ...base, status: 'skip', missingSide: 'figma', reason: `missing_figma_render: ${args.figma}` }
  }
  const artifactPath = join(
    VERIFY_ARTIFACT_DIR,
    `${basename(args.story, '.png')}-vs-${basename(args.figma, '.png')}.png`,
  )
  mkdirSync(dirname(artifactPath), { recursive: true })
  const outcome = compareRenders({ storyPng, figmaPng, threshold: args.threshold, artifactPath })
  return { ...base, ...outcome }
}

const reportLine = (report: VerifyReport): string => {
  const fields = [
    `status=${report.status}`,
    `story=${report.story}`,
    `figma=${report.figma}`,
    `threshold=${report.threshold}`,
  ]
  if (report.diffPixels !== undefined)
    fields.push(`diff=${report.diffPixels}`, `total=${report.totalPixels}`, `ratio=${report.ratio}`)
  if (report.missingSide !== undefined) fields.push(`missing=${report.missingSide}`)
  if (report.reason !== undefined) fields.push(`reason=${report.reason}`)
  if (report.artifactPath !== undefined) fields.push(`artifact=${report.artifactPath}`)
  return fields.join(' ')
}

const runValidate = (): void => {
  const registry = loadRegistry()
  console.info(
    `status=ok components=${registry.components.length} screens=${registry.screens.length} sections=${registry.sections.length}`,
  )
}

const runPlan = (): void => {
  const payloads = planPayloads(loadRegistry())
  console.info(JSON.stringify({ descriptions: payloads }, null, 2))
}

const parseOrFail = (argv: readonly string[]): ConnectArgs => {
  try {
    return parseConnectArgs(argv)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

export const main = (): void => {
  const args = parseOrFail(process.argv.slice(2))
  if (args.command === 'validate') {
    runValidate()
    return
  }
  if (args.command === 'plan') {
    runPlan()
    return
  }
  const report = runVerify(args)
  console.info(reportLine(report))
  if (report.status === 'fail') process.exit(1)
}

if (import.meta.main) main()
