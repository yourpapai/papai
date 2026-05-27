// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Stable public surface for in-repo provider plugins. Re-exports types and
// error constructors only — no provider implementation code.

export type {
  Activity,
  Agile,
  Attachment,
  Column,
  Comment,
  CommentReaction,
  CreateWorkItemParams,
  IdentityUser,
  Label,
  ListTasksParams,
  Project,
  ProviderConfigRequirement,
  RelationType,
  SavedQuery,
  SetTaskVisibilityParams,
  Sprint,
  Task,
  TaskCommandResult,
  TaskCustomField,
  TaskLabel,
  TaskListItem,
  TaskProvider,
  TaskRelation,
  TaskSearchResult,
  TaskVisibility,
  ToolDueDateInput,
  UpdateWorkItemParams,
  UserIdentityResolver,
  UserRef,
  VisibilityGroupRef,
  WorkItem,
} from './types.js'
export type { TaskCapability } from './task-capability.js'
export type { AppError, LlmError, ProviderError, SystemError, ValidationError, WebFetchError } from '../errors.js'
export { providerError, systemError, webFetchError, isAppError, extractAppError } from '../errors.js'
