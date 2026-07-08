// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { codingModule } from '../modules/coding/module.js'
import type { TrustedModule } from '../ports/module.js'

/**
 * The static registry of in-repo trusted modules, wired once at the composition root.
 * This is the one place permitted to name modules; the kernel never imports from `src/modules/`.
 */
export const TRUSTED_MODULES: readonly TrustedModule[] = [codingModule]
