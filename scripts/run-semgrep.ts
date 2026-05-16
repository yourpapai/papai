#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { $ } from 'bun'

const SEMGREP_IMAGE = 'semgrep/semgrep:1.156.0'

interface RunOptions {
  ci: boolean
  fix: boolean
}

type Runner = { type: 'native'; path: string } | { type: 'docker' }

function parseArgs(): RunOptions {
  const args = process.argv.slice(2)
  return {
    ci: args.includes('--ci'),
    fix: args.includes('--fix'),
  }
}

async function findRunner(): Promise<Runner> {
  // Prefer native semgrep if available (e.g. already installed in CI)
  const whichResult = await $`which semgrep`.nothrow().quiet()
  if (whichResult.exitCode === 0) {
    const versionResult = await $`semgrep --version`.nothrow().quiet()
    if (versionResult.exitCode === 0) {
      console.log(`✅ Using system Semgrep: ${versionResult.stdout.toString().trim()}`)
      return { type: 'native', path: 'semgrep' }
    }
  }

  // Fall back to Docker
  const dockerCheck = await $`docker info`.nothrow().quiet()
  if (dockerCheck.exitCode === 0) {
    console.log(`✅ Using Semgrep via Docker (${SEMGREP_IMAGE})`)
    return { type: 'docker' }
  }

  throw new Error(
    'Semgrep not found and Docker is unavailable.\n' +
      'Install semgrep (brew install semgrep) or start Docker Desktop to run security scans.',
  )
}

function buildScanArgs(options: RunOptions): string[] {
  const args: string[] = [
    'scan',
    '--config',
    'p/owasp-top-ten',
    '--config',
    'p/typescript',
    '--config',
    'p/javascript',
    '--config',
    'p/nodejs',
    '--config',
    'p/cwe-top-25',
    '--config',
    'p/ai-best-practices',
    '--strict',
    '--error',
  ]

  if (options.ci) {
    args.push('--sarif-output', 'semgrep-results.sarif')
  }

  if (options.fix) {
    args.push('--autofix')
  }

  for (const exclude of ['tests', 'node_modules', '.git', 'dist', '*.test.ts', '*.spec.ts', '.semgrep/bin']) {
    args.push('--exclude', exclude)
  }

  args.push('.')
  return args
}

async function execSemgrep(runner: Runner, scanArgs: string[]): Promise<number> {
  const cwd = process.cwd()
  if (runner.type === 'native') {
    const result = await $`${runner.path} ${scanArgs}`.nothrow()
    return result.exitCode
  }
  // Remap local paths to container paths (/src = cwd)
  const containerArgs = scanArgs.map((arg) => (arg.startsWith(cwd) ? arg.replace(cwd, '/src') : arg))
  // semgrep/semgrep has no ENTRYPOINT — must pass 'semgrep' explicitly
  const result = await $`docker run --rm -v ${cwd}:/src -w /src ${SEMGREP_IMAGE} semgrep ${containerArgs}`.nothrow()
  return result.exitCode
}

async function runSemgrep(runner: Runner, options: RunOptions): Promise<number> {
  const scanArgs = buildScanArgs(options)

  console.log('\n🔍 Running security scan...\n')
  console.log(`   Rules: OWASP Top 10, TypeScript, JavaScript, Node.js, CWE Top 25, AI best practices`)
  console.log(`   Mode: ${options.ci ? 'CI' : 'local'}${options.fix ? ' (autofix enabled)' : ''}\n`)

  try {
    return await execSemgrep(runner, scanArgs)
  } catch (error) {
    console.error('❌ Semgrep execution failed:', error)
    return 2
  }
}

async function main(): Promise<void> {
  const options = parseArgs()

  try {
    const runner = await findRunner()
    const exitCode = await runSemgrep(runner, options)

    if (exitCode === 0) {
      console.log('\n✅ Security scan passed - no issues found')
    } else if (exitCode === 1) {
      console.log('\n⚠️  Security scan found issues')
      if (options.ci) {
        console.log('📄 Results saved to semgrep-results.sarif')
      }
    } else {
      console.log('\n❌ Security scan failed to run')
    }

    process.exit(exitCode)
  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(2)
  }
}

void main()
