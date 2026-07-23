// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { link, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

import { renderReportMarkdown, stableReportJson, validateResearchReport } from './report.js'
import type { ResearchReport } from './report.js'
import type { MemoryScenario } from './types.js'

export type ResearchOutputReservation = Readonly<{
  jsonPath: string
  markdownPath: string
  lockPaths: readonly string[]
  split: MemoryScenario['split']
  overwrite: boolean
}>

const markdownPath = (jsonPath: string): string =>
  extname(jsonPath) === '.json' ? jsonPath.slice(0, -5) + '.md' : `${jsonPath}.md`

const removeTaskPaths = async (paths: readonly string[]): Promise<void> => {
  await Promise.all(
    paths.map(async (path): Promise<void> => {
      try {
        await unlink(path)
      } catch {
        // A missing task-owned temporary or reservation file needs no cleanup.
      }
    }),
  )
}

const releaseReservation = async (reservation: ResearchOutputReservation): Promise<void> => {
  await removeTaskPaths(reservation.lockPaths)
}

const reserveOutputLocks = async (paths: readonly string[]): Promise<readonly string[]> => {
  const lockPaths = paths.map((path) => `${path}.lock`)
  const results = await Promise.allSettled(
    lockPaths.map(async (path): Promise<string> => {
      const handle = await open(path, 'wx')
      await handle.close()
      return path
    }),
  )
  const acquired = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  if (results.some(({ status }) => status === 'rejected')) {
    await removeTaskPaths(acquired)
    throw new Error(`Research output is already reserved: ${paths[0]}`)
  }
  return lockPaths
}

export const reserveResearchOutputs = async (
  outputValue: string,
  split: MemoryScenario['split'],
  overwrite: boolean,
): Promise<ResearchOutputReservation> => {
  const jsonPath = resolve(outputValue)
  const renderedMarkdownPath = markdownPath(jsonPath)
  await Promise.all([jsonPath, renderedMarkdownPath].map((path) => mkdir(dirname(path), { recursive: true })))
  const reservation = {
    jsonPath,
    markdownPath: renderedMarkdownPath,
    lockPaths: await reserveOutputLocks([jsonPath, renderedMarkdownPath]),
    split,
    overwrite,
  }
  const exists = (await Bun.file(jsonPath).exists()) || (await Bun.file(renderedMarkdownPath).exists())
  if (exists && split === 'sealed-test') {
    await releaseReservation(reservation)
    throw new Error(`Refusing to overwrite sealed research output: ${jsonPath}`)
  }
  if (exists && !overwrite) {
    await releaseReservation(reservation)
    throw new Error(`Development output exists; pass --overwrite to replace it: ${jsonPath}`)
  }
  return reservation
}

const publishNoClobberOutputs = async (
  temporary: readonly [string, string],
  reservation: ResearchOutputReservation,
): Promise<void> => {
  const outputs = [reservation.jsonPath, reservation.markdownPath] as const
  try {
    const results = await Promise.allSettled(
      temporary.map(async (path, index): Promise<string> => {
        const output = outputs[index]!
        await link(path, output)
        return output
      }),
    )
    const published = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed !== undefined) {
      await removeTaskPaths(published)
      throw failed.reason
    }
    await removeTaskPaths(temporary)
  } catch (error) {
    await removeTaskPaths(temporary)
    throw error
  }
}

export const publishResearchOutputs = async (
  input: ResearchReport,
  reservation: ResearchOutputReservation,
): Promise<Readonly<{ jsonPath: string; markdownPath: string }>> => {
  const report = validateResearchReport(input)
  if (report.selection.split !== reservation.split) {
    throw new Error('Research output reservation split does not match the report')
  }
  const suffix = `${process.pid}-${randomUUID()}`
  const jsonTemporary = `${reservation.jsonPath}.tmp-${suffix}`
  const markdownTemporary = `${reservation.markdownPath}.tmp-${suffix}`
  try {
    await Promise.all([
      Bun.write(jsonTemporary, stableReportJson(report)),
      Bun.write(markdownTemporary, renderReportMarkdown(report)),
    ])
    if (reservation.split === 'sealed-test' || !reservation.overwrite) {
      await publishNoClobberOutputs([jsonTemporary, markdownTemporary], reservation)
    } else {
      await rename(jsonTemporary, reservation.jsonPath)
      await rename(markdownTemporary, reservation.markdownPath)
    }
  } catch (error) {
    await removeTaskPaths([jsonTemporary, markdownTemporary])
    throw error
  }
  return { jsonPath: reservation.jsonPath, markdownPath: reservation.markdownPath }
}

export const writeResearchOutputs = async (
  input: ResearchReport,
  outputValue: string,
  overwrite: boolean,
): Promise<Readonly<{ jsonPath: string; markdownPath: string }>> => {
  const report = validateResearchReport(input)
  const reservation = await reserveResearchOutputs(outputValue, report.selection.split, overwrite)
  try {
    return await publishResearchOutputs(report, reservation)
  } finally {
    await releaseReservation(reservation)
  }
}

export { releaseReservation as releaseResearchOutputReservation }
