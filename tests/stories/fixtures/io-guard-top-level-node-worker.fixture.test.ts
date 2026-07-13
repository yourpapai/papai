// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'
import { Worker } from 'node:worker_threads'

const marker = path.join(process.env['TMPDIR'] ?? '/tmp', 'worker-started')
const worker = new Worker(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`, { eval: true })
void worker
