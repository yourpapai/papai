// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability } from '../chat/types.js'
import type { TaskCapability, TaskProviderTrait } from '../providers/types.js'

/** All valid task capability strings (used for manifest validation). */
export const TASK_CAPABILITY_VALUES = [
  'tasks.delete',
  'tasks.count',
  'tasks.relations',
  'tasks.watchers',
  'tasks.votes',
  'tasks.visibility',
  'tasks.commands',
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.team',
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'comments.reactions',
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
  'attachments.list',
  'attachments.upload',
  'attachments.delete',
  'workItems.list',
  'workItems.create',
  'workItems.update',
  'workItems.delete',
  'agiles.list',
  'sprints.list',
  'sprints.create',
  'sprints.update',
  'sprints.assign',
  'activities.read',
  'queries.saved',
] as const satisfies readonly TaskCapability[]

/** All valid chat capability strings (used for manifest validation). */
export const CHAT_CAPABILITY_VALUES = [
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.delete',
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
  'users.resolve',
] as const satisfies readonly ChatCapability[]

export const TASK_PROVIDER_TRAIT_VALUES = [
  'workspace-scoped',
  'task-label-read-requires-provider-specific-api',
  'supports-command-language',
  'command-language:youtrack',
  'custom-fields',
] as const satisfies readonly TaskProviderTrait[]
