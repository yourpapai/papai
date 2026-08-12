#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { $ } from 'bun'

const ACTIONLINT_VERSION = '1.7.7'

/**
 * sha256 of the official release tarballs, copied from
 * `actionlint_1.7.7_checksums.txt` on the release. A pinned version on its own
 * still runs whatever that URL serves next year; the digest is what makes it the
 * same bytes every time, and this binary reads every workflow in the repository.
 */
const CHECKSUMS: Record<string, string> = {
  darwin_amd64: '28e5de5a05fc558474f638323d736d822fff183d2d492f0aecb2b73cc44584f5',
  darwin_arm64: '2693315b9093aeacb4ebd91a993fea54fc215057bf0da2659056b4bc033873db',
  linux_amd64: '023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757',
  linux_arm64: '401942f9c24ed71e4fe71b76c7d638f66d8633575c4016efd2977ce7c28317d0',
}

/** Gitignored; one extracted binary per pinned version, so a bump re-downloads. */
const CACHE_DIR = '.actionlint'

/** The release's platform suffix, or `null` where no build is published. */
function platformKey(): string | null {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null
  const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : null

  return os !== null && arch !== null ? `${os}_${arch}` : null
}

async function download(key: string, into: string): Promise<void> {
  const url = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${key}.tar.gz`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Downloading actionlint ${ACTIONLINT_VERSION} failed: ${response.status} ${response.statusText}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  const expected = CHECKSUMS[key]
  if (digest !== expected) {
    throw new Error(
      `Checksum mismatch for actionlint_${ACTIONLINT_VERSION}_${key}.tar.gz.\n` +
        `  expected ${expected}\n  got      ${digest}\n` +
        'Refusing to run a binary that is not the pinned release.',
    )
  }

  await mkdir(into, { recursive: true })
  const tarball = path.join(into, 'actionlint.tar.gz')
  await Bun.write(tarball, bytes)
  await $`tar -xzf ${tarball} -C ${into} actionlint`.quiet()
}

/**
 * The pinned binary, downloaded and cached on first use.
 *
 * A system `actionlint` is used only where no release matches the platform: a
 * different version reports a different set of findings, and a gate that says
 * something different on a laptop than in CI is worse than no gate.
 */
async function resolveBinary(): Promise<string> {
  const key = platformKey()
  if (key === null) {
    const system = Bun.which('actionlint')
    if (system !== null) {
      console.log(`⚠️  No pinned actionlint build for ${process.platform}/${process.arch}; using ${system}`)
      return system
    }
    throw new Error(
      `No actionlint release for ${process.platform}/${process.arch}, and none on PATH.\n` +
        'Install actionlint (brew install actionlint) to lint workflows here.',
    )
  }

  const dir = path.join(CACHE_DIR, ACTIONLINT_VERSION)
  const binary = path.join(dir, 'actionlint')
  if (!existsSync(binary)) {
    console.log(`⬇️  Fetching actionlint ${ACTIONLINT_VERSION} (${key})...`)
    await download(key, dir)
  }

  return binary
}

async function main(): Promise<void> {
  try {
    const binary = await resolveBinary()

    console.log('\n🔍 Linting workflow files...\n')
    // No file arguments: actionlint walks .github/workflows itself, which is the
    // point — a gate that took a list would not see a newly added workflow.
    // `.github/actionlint.yaml` is picked up from the repository root, and
    // carries the path-scoped suppressions with the reason for each.
    const result = await $`${binary} -color`.nothrow()

    if (result.exitCode === 0) {
      console.log('✅ Workflow lint passed')
    } else {
      console.log('\n❌ Workflow lint found problems.')
      console.log('   An invalid workflow file does not show up as a red build: GitHub rejects')
      console.log('   the file, starts no job, and the run reports `failure` a second after it')
      console.log('   began. Fix these before merging.')
      console.log('')
      console.log('   Watch for `#` inside an `if: >-` block: that is a folded scalar, so the')
      console.log('   line folds into the expression instead of being a comment. Commentary')
      console.log('   belongs above the `if:` key.')
    }

    process.exit(result.exitCode)
  } catch (error) {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}

void main()
