// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { bootstrapLogs } from './logs-bootstrap.js'
import { setupEventSource } from './sse.js'

async function init(): Promise<void> {
  try {
    await bootstrapLogs()
  } catch {
    // Log bootstrap failed — will populate from SSE events
  }

  setupEventSource()
}

void init()
