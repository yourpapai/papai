// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskCapability } from 'papai/plugin-types'

import type { TaskProviderTrait } from '../../src/providers/types.js'

/** Capabilities advertised by the GitHub Issues provider. */
export const GITHUB_CAPABILITIES: ReadonlySet<TaskCapability> = new Set<TaskCapability>([
  'projects.list',
  'projects.read',
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  'activities.read',
  'tasks.count',
])

/** GitHub Issues carry no provider-specific behavioral traits in session 1. */
export const GITHUB_TRAITS: ReadonlySet<TaskProviderTrait> = new Set<TaskProviderTrait>()

/** Public GitHub REST API base; GHES instances override it via the `baseUrl` instance config. */
export const GITHUB_DEFAULT_BASE_URL = 'https://api.github.com'

/** Public GitHub GraphQL endpoint; GHES instances derive theirs from the REST `baseUrl`. */
export const GITHUB_DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql'
