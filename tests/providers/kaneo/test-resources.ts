// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { providerError } from '../../../src/errors.js'
import { classifyKaneoError } from '../../../src/providers/kaneo/classify-error.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { kaneoFetch } from '../../../src/providers/kaneo/client.js'
import { ColumnResource } from '../../../src/providers/kaneo/column-resource.js'
import { CommentResource } from '../../../src/providers/kaneo/comment-resource.js'
import { LabelResource } from '../../../src/providers/kaneo/label-resource.js'
import { ProjectResource } from '../../../src/providers/kaneo/project-resource.js'
import { TaskResource } from '../../../src/providers/kaneo/task-resource.js'

export const EmptyResponseSchema = z.unknown()

export { ColumnResource, CommentResource, LabelResource, ProjectResource, TaskResource }

export { classifyKaneoError, providerError }
export { kaneoFetch }
export type { KaneoConfig }
