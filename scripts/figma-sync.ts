// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'

import {
  DEFAULT_SYNC_PORT,
  SyncReportSchema,
  buildSyncManifest,
  countEntries,
  evaluateReport,
} from './figma-sync-lib.js'
import type { AreaFiles, SyncManifest, SyncReport } from './figma-sync-lib.js'

export interface CliArgs {
  areas: string[]
  shoot: boolean
  port: number
  timeoutSec: number
}

const fail = (message: string): never => {
  console.error(`status=error reason=${message}`)
  process.exit(1)
}

export const parseArgs = (argv: readonly string[]): CliArgs => {
  const args: CliArgs = { areas: ['admin', 'settings'], shoot: true, port: DEFAULT_SYNC_PORT, timeoutSec: 900 }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--no-shoot') args.shoot = false
    else if (flag === '--areas') {
      const value = argv[index + 1] ?? fail('missing_areas_value')
      args.areas = value
        .split(',')
        .map((area) => area.trim())
        .filter((area) => area.length > 0)
      index += 1
    } else if (flag === '--port') {
      const value = Number(argv[index + 1])
      if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) fail('invalid_port')
      args.port = value
      index += 1
    } else if (flag === '--timeout-sec') {
      const value = Number(argv[index + 1])
      if (!Number.isSafeInteger(value) || value < 1) fail('invalid_timeout')
      args.timeoutSec = value
      index += 1
    } else {
      fail(`unknown_flag:${flag}`)
    }
  }
  if (args.areas.length === 0) fail('missing_areas')
  return args
}

const runShoot = async (areas: readonly string[]): Promise<void> => {
  const specDirs = areas.map((area) => `tests/visual/${area}`)
  for (const dir of specDirs) {
    if (!existsSync(dir)) fail(`invalid_area:${dir}`)
  }
  const child = Bun.spawn(['bun', 'run', 'shoot', ...specDirs], { stdout: 'inherit', stderr: 'inherit' })
  const exitCode = await child.exited
  if (exitCode !== 0) fail(`shoot_failed:${exitCode}`)
}

const collectArea = async (area: string): Promise<AreaFiles> => {
  const shotsDir = `.storybook-shots/${area}`
  const glob = new Bun.Glob('**/*-1.png')
  const paths: string[] = []
  for await (const path of glob.scan({ cwd: shotsDir })) paths.push(path)
  if (paths.length === 0) fail(`no_shots:${shotsDir}`)
  const files = await Promise.all(
    paths.map(async (path) => ({ path, bytes: new Uint8Array(await Bun.file(`${shotsDir}/${path}`).arrayBuffer()) })),
  )
  return { name: area, files }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const printStartup = (args: CliArgs, entries: number, imageCount: number): void => {
  console.info(
    `status=ready areas=${args.areas.join(',')} entries=${entries} port=${args.port} images_served=${imageCount}`,
  )
  console.info(
    'figma setup (one-time): Plugins → Development → Import plugin from manifest… → scripts/figma-sync-plugin/manifest.json',
  )
  console.info('then in the target file run: Plugins → Development → papai story sync')
}

const startServer = (options: {
  port: number
  manifest: SyncManifest
  keyToAbsPath: Map<string, string>
  onReport: (report: SyncReport) => void
}): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    port: options.port,
    fetch: async (request): Promise<Response> => {
      const url = new URL(request.url)
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
      if (url.pathname === '/manifest' && request.method === 'GET') {
        return Response.json(options.manifest, { headers: corsHeaders })
      }
      if (url.pathname === '/image' && request.method === 'GET') {
        const key = url.searchParams.get('key') ?? ''
        const absPath = options.keyToAbsPath.get(key)
        if (absPath === undefined) return new Response('unknown key', { status: 404, headers: corsHeaders })
        const bytes = new Uint8Array(await Bun.file(absPath).arrayBuffer())
        return new Response(bytes, { headers: { ...corsHeaders, 'Content-Type': 'image/png' } })
      }
      if (url.pathname === '/report' && request.method === 'POST') {
        const parsed = SyncReportSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'invalid_report' }, { status: 400, headers: corsHeaders })
        options.onReport(parsed.data)
        return Response.json({ ok: true }, { headers: corsHeaders })
      }
      return new Response('not found', { status: 404, headers: corsHeaders })
    },
  })

export const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  if (args.shoot) await runShoot(args.areas)

  const areas: AreaFiles[] = await Promise.all(args.areas.map((area) => collectArea(area)))
  const manifest = buildSyncManifest(areas)
  const expectedEntries = countEntries(manifest)

  const keyToAbsPath = new Map<string, string>()
  for (const area of areas) {
    for (const file of area.files) keyToAbsPath.set(file.path, `.storybook-shots/${area.name}/${file.path}`)
  }

  printStartup(args, expectedEntries, keyToAbsPath.size)

  let resolveReport: (report: SyncReport) => void = () => undefined
  const reportPromise = new Promise<SyncReport>((resolve) => {
    resolveReport = resolve
  })
  const server = startServer({ port: args.port, manifest, keyToAbsPath, onReport: resolveReport })

  const timeoutMs = args.timeoutSec * 1000
  const report = await Promise.race([reportPromise, Bun.sleep(timeoutMs).then((): SyncReport | null => null)])
  await server.stop(true)

  if (report === null) {
    console.error('status=error reason=timeout_waiting_for_plugin')
    console.error(
      'hint: run the "papai story sync" development plugin in the target Figma file while this command waits',
    )
    process.exit(1)
  }

  const outcome = evaluateReport(report, expectedEntries)
  const summary = `created=${report.created} updated=${report.updated} adopted=${report.adopted} stale=${report.stale} images=${report.imagesPlaced} failed=${report.failed.length} errors=${report.errors.length}`
  if (outcome.ok) {
    console.info(`status=ok ${summary}`)
    process.exit(0)
  }
  console.error(`status=error ${summary} problems=${outcome.problems.join(',')}`)
  process.exit(1)
}

if (import.meta.main) await main()
