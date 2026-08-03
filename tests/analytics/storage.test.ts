// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Aggregated storage test entrypoint. Sub-suite files are imported for execution;
// this file remains the named gate target in Task 2.
import './storage/aggregate-histogram-store.test.js'
import './storage/aggregate-store-helpers.test.js'
import './storage/aggregate-store.test.js'
import './storage/backfill-provenance-store.test.js'
import './storage/epoch-store.test.js'
import './storage/event-store.test.js'
import './storage/rejection-store.test.js'
