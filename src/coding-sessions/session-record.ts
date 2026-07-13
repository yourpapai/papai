// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Current-master compatibility adapter. The core-separation implementation
// replaces this backing module while preserving this production-owned API.
export { deriveTitle, parsePrNumber, readRecord, writeRecord, type SessionRecord } from '../../plugins/acp/history.js'
