// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type TaskProviderLike = {
  readonly name: string
}
type GitHubProviderModule = typeof import('./provider.js')

const requireModule = import.meta.require

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isGitHubProviderModule(value: unknown): value is GitHubProviderModule {
  return isRecord(value) && typeof value['GitHubProvider'] === 'function'
}

function getGitHubProviderModule(): GitHubProviderModule {
  const moduleValue: unknown = requireModule('./provider.js')
  if (!isGitHubProviderModule(moduleValue)) {
    throw new Error('Invalid GitHub provider module contract')
  }
  return moduleValue
}

export function createGitHubProvider(config: Record<string, string>): TaskProviderLike {
  const { GitHubProvider } = getGitHubProviderModule()
  return new GitHubProvider({
    baseUrl: config['baseUrl'] ?? '',
    repo: config['repo'] ?? '',
    token: config['token'] ?? '',
  })
}
