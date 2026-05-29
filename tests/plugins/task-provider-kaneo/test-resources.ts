// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { classifyKaneoError } from '../../../plugins/task-provider-kaneo/classify-error.js'
import type { KaneoConfig } from '../../../plugins/task-provider-kaneo/client.js'
import { kaneoFetch } from '../../../plugins/task-provider-kaneo/client.js'
import { ColumnResource } from '../../../plugins/task-provider-kaneo/column-resource.js'
import { CommentResource } from '../../../plugins/task-provider-kaneo/comment-resource.js'
import { LabelResource } from '../../../plugins/task-provider-kaneo/label-resource.js'
import { ProjectResource } from '../../../plugins/task-provider-kaneo/project-resource.js'
import { TaskResource } from '../../../plugins/task-provider-kaneo/task-resource.js'
import { providerError } from '../../../src/errors.js'

export const EmptyResponseSchema = z.unknown()

export { ColumnResource, CommentResource, LabelResource, ProjectResource, TaskResource }

export { classifyKaneoError, providerError }
export { kaneoFetch }
export type { KaneoConfig }
