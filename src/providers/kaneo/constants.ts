// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskCapability, ProviderConfigRequirement } from '../types.js'

export const ALL_CAPABILITIES: ReadonlySet<TaskCapability> = new Set<TaskCapability>([
  // Tasks
  'tasks.delete',
  'tasks.relations',
  // Projects (full CRUD)
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  // Comments (full CRUD)
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  // Labels (full CRUD + assignment)
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.assign',
  // Statuses (full CRUD)
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
])

export const CONFIG_REQUIREMENTS: readonly ProviderConfigRequirement[] = [
  { key: 'kaneo_apikey', label: 'Kaneo API Key', required: true },
]
