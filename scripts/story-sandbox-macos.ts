// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'

import type { StorySandboxRequest } from './story-sandbox.js'

function profileLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('Story sandbox paths cannot contain null bytes')
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function canonicalDirectory(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`Story sandbox ${label} must be absolute`)
  const resolved = realpathSync(value)
  if (resolved !== value) throw new Error(`Story sandbox ${label} must be canonical`)
  if (!lstatSync(resolved).isDirectory()) throw new Error(`Story sandbox ${label} must be a directory`)
  return resolved
}

function canonicalFile(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`Story sandbox ${label} must be absolute`)
  const resolved = realpathSync(value)
  if (resolved !== value) throw new Error(`Story sandbox ${label} must be canonical`)
  const stat = lstatSync(resolved)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Story sandbox ${label} must be a regular file`)
  return resolved
}

function subpaths(paths: readonly string[]): string {
  return paths.map((value) => `(subpath "${profileLiteral(value)}")`).join(' ')
}

function literals(paths: readonly string[]): string {
  return paths.map((value) => `(literal "${profileLiteral(value)}")`).join(' ')
}

function ancestors(paths: readonly string[]): string {
  return paths.map((value) => `(path-ancestors "${profileLiteral(value)}")`).join(' ')
}

function sessionOutputs(appRoot: string, tempRoot: string, reportPaths: readonly string[]): readonly string[] {
  if (path.basename(appRoot) !== 'app') throw new Error('Story sandbox app root must be the session app directory')
  const sessionRoot = path.dirname(appRoot)
  if (tempRoot !== path.join(sessionRoot, 'tmp')) throw new Error('Story sandbox temporary root must be session tmp')
  const reportsRoot = path.join(sessionRoot, 'reports')
  const reports = reportPaths.map((report) => canonicalFile(report, 'report path'))
  if (reports.length === 0) throw new Error('Story sandbox requires at least one report path')
  if (new Set(reports).size !== reports.length) throw new Error('Story sandbox report paths must be unique')
  if (reports.some((report) => path.dirname(report) !== reportsRoot || path.extname(report) !== '.xml')) {
    throw new Error('Story sandbox report paths must be direct files in session reports')
  }
  return reports
}

function sessionDependencyRoot(appRoot: string, dependencyRoot: string): string {
  const link = path.join(path.dirname(appRoot), 'node_modules')
  const entry = lstatSync(link)
  if (!entry.isSymbolicLink() || readlinkSync(link) !== dependencyRoot || realpathSync(link) !== dependencyRoot) {
    throw new Error('Story sandbox dependency root must be the session node_modules target')
  }
  return link
}

export function buildDarwinStorySandboxCommand(request: StorySandboxRequest): readonly string[] {
  const appRoot = canonicalDirectory(request.appRoot, 'app root')
  const dependencyRoot = canonicalDirectory(request.dependencyRoot, 'dependency root')
  const tempRoot = canonicalDirectory(request.tempRoot, 'temporary root')
  const reports = sessionOutputs(appRoot, tempRoot, request.reportPaths)
  const dependencyLink = sessionDependencyRoot(appRoot, dependencyRoot)
  const bunExecutable = canonicalFile(request.bunExecutable, 'bun executable')
  if (request.command[0] !== request.bunExecutable && request.command[0] !== bunExecutable) {
    throw new Error('Story sandbox command must begin with the declared bun executable')
  }
  const readRoots = [
    appRoot,
    dependencyRoot,
    dependencyLink,
    '/System',
    '/usr/lib',
    '/private/var/db/timezone',
    path.dirname(bunExecutable),
  ]
  const profile = [
    '(version 1)',
    '(deny default)',
    '(deny network*)',
    '(allow process-exec*)',
    '(allow ipc-posix-shm)',
    '(allow sysctl-read)',
    `(allow file-read* ${subpaths(readRoots)} ${literals(['/', '/dev/null', '/dev/urandom'])})`,
    `(allow file-read-metadata file-test-existence ${ancestors([...readRoots, tempRoot, ...reports])})`,
    `(allow file-write* ${subpaths([tempRoot])} ${literals(reports)})`,
  ].join('\n')
  return ['sandbox-exec', '-p', profile, ...request.command]
}
