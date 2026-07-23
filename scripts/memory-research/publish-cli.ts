// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { renderDecisionAnalysisMarkdown } from './decision-analysis-render.js'
import { stableDecisionAnalysisJson } from './decision-analysis-validation.js'
import { buildDecisionAnalysis } from './decision-analysis.js'
import { validateResearchReport } from './report.js'
import { validateFrozenStorageReport } from './storage-report.js'

export type PublishOptions = Readonly<{
  primaryPath: string
  sensitivityPath: string
  storagePath: string
  analysisPath: string
  resultsPath: string
  markdownPath: string
}>

export type PublicationReservation = Readonly<{
  outputs: readonly [string, string, string]
  lockPaths: readonly string[]
}>

const flagNames = ['--primary', '--sensitivity', '--storage', '--analysis', '--results', '--markdown'] as const
type FlagName = (typeof flagNames)[number]

const isFlagName = (value: string | undefined): value is FlagName =>
  value !== undefined && flagNames.some((flag) => flag === value)

const parseValues = (args: readonly string[]): ReadonlyMap<string, string> => {
  if (args.length % 2 !== 0) throw new Error(`${String(args.at(-1))} requires a value`)
  const pairs = Array.from({ length: args.length / 2 }, (_, index) => {
    const flag = args[index * 2]
    const value = args[index * 2 + 1]
    if (!isFlagName(flag)) throw new Error(`Unknown publication argument: ${String(flag)}`)
    if (value === undefined) throw new Error(`${flag} requires a value`)
    return [flag, value] as const
  })
  const flags = pairs.map(([flag]) => flag)
  if (new Set(flags).size !== flags.length) throw new Error('Publication arguments must be unique')
  return new Map(pairs)
}

export const parsePublishArgs = (args: readonly string[]): PublishOptions => {
  const values = parseValues(args)
  const required = (flag: FlagName): string => {
    const value = values.get(flag)
    if (value === undefined || value.length === 0) throw new Error(`${flag} requires a value`)
    return value
  }
  return {
    primaryPath: required('--primary'),
    sensitivityPath: required('--sensitivity'),
    storagePath: required('--storage'),
    analysisPath: required('--analysis'),
    resultsPath: required('--results'),
    markdownPath: required('--markdown'),
  }
}

type InputArtifact<Value> = Readonly<{ path: string; bytes: Uint8Array; value: Value; sha256: string }>

const readJsonArtifact = async <Value>(
  pathValue: string,
  validate: (input: unknown) => Value,
): Promise<InputArtifact<Value>> => {
  const path = resolve(pathValue)
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  const decoded = new TextDecoder().decode(bytes)
  const value = validate(JSON.parse(decoded) as unknown)
  return { path: pathValue, bytes, value, sha256: createHash('sha256').update(bytes).digest('hex') }
}

const removePaths = async (paths: readonly string[]): Promise<void> => {
  await Promise.all(
    paths.map(async (path): Promise<void> => {
      try {
        await unlink(path)
      } catch {
        // A missing task-owned publication path needs no cleanup.
      }
    }),
  )
}

const outputPaths = (options: PublishOptions): readonly string[] =>
  [options.analysisPath, options.resultsPath, options.markdownPath].map((path) => resolve(path))

const resolvedOutputs = (options: PublishOptions): readonly [string, string, string] => {
  const outputs = outputPaths(options)
  if (new Set(outputs).size !== outputs.length) throw new Error('Publication output paths must be unique')
  const inputs = [options.primaryPath, options.sensitivityPath, options.storagePath].map((path) => resolve(path))
  if (outputs.some((path) => inputs.includes(path))) {
    throw new Error('Publication outputs cannot overwrite input artifacts')
  }
  return [outputs[0]!, outputs[1]!, outputs[2]!]
}

const releaseLocks = async (lockPaths: readonly string[]): Promise<void> => {
  await removePaths(lockPaths)
}

export const reservePublicationOutputs = async (options: PublishOptions): Promise<PublicationReservation> => {
  const outputs = resolvedOutputs(options)
  await Promise.all(outputs.map((path) => mkdir(dirname(path), { recursive: true })))
  const lockPaths = outputs.map((path) => `${path}.lock`)
  const lockResults = await Promise.allSettled(
    lockPaths.map(async (lockPath): Promise<string> => {
      const handle = await open(lockPath, 'wx')
      await handle.close()
      return lockPath
    }),
  )
  const acquired = lockResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  if (lockResults.some(({ status }) => status === 'rejected')) {
    await releaseLocks(acquired)
    throw new Error('Memory research publication output is already reserved')
  }
  if ((await Promise.all(outputs.map((path) => Bun.file(path).exists()))).some(Boolean)) {
    await releaseLocks(acquired)
    throw new Error('Refusing to overwrite an existing memory research publication output')
  }
  return { outputs, lockPaths }
}

export const releasePublicationReservation = async (reservation: PublicationReservation): Promise<void> => {
  await releaseLocks(reservation.lockPaths)
}

const publishFiles = async (
  reservation: PublicationReservation,
  contents: readonly (string | Uint8Array)[],
): Promise<void> => {
  const { outputs } = reservation
  const suffix = `${process.pid}-${randomUUID()}`
  const temporary = outputs.map((path) => `${path}.tmp-${suffix}`)
  const published: string[] = []
  try {
    await Promise.all(temporary.map((path, index) => Bun.write(path, contents[index]!)))
    const linkResults = await Promise.allSettled(
      temporary.map(async (path, index): Promise<string> => {
        const output = outputs[index]!
        await link(path, output)
        return output
      }),
    )
    published.push(...linkResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])))
    const failed = linkResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed !== undefined) {
      throw failed.reason
    }
    await removePaths(temporary)
  } catch (error) {
    await removePaths([...temporary, ...published])
    throw error
  }
}

export const publishResearchResults = async (
  options: PublishOptions,
): Promise<Readonly<{ analysisPath: string; resultsPath: string; markdownPath: string }>> => {
  const reservation = await reservePublicationOutputs(options)
  try {
    const [primary, sensitivity, storage] = await Promise.all([
      readJsonArtifact(options.primaryPath, validateResearchReport),
      readJsonArtifact(options.sensitivityPath, validateResearchReport),
      readJsonArtifact(options.storagePath, validateFrozenStorageReport),
    ])
    const analysis = buildDecisionAnalysis({
      primaryReport: primary.value,
      sensitivityReport: sensitivity.value,
      storageReport: storage.value,
      artifacts: {
        primary: { path: primary.path, sha256: primary.sha256 },
        sensitivity: { path: sensitivity.path, sha256: sensitivity.sha256 },
        storage: { path: storage.path, sha256: storage.sha256 },
      },
    })
    await publishFiles(reservation, [
      stableDecisionAnalysisJson(analysis),
      primary.bytes,
      renderDecisionAnalysisMarkdown(analysis),
    ])
    return {
      analysisPath: reservation.outputs[0],
      resultsPath: reservation.outputs[1],
      markdownPath: reservation.outputs[2],
    }
  } finally {
    await releasePublicationReservation(reservation)
  }
}
