// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Aggregated governance test entrypoint. Sub-suite files are imported for
// execution; this file remains the named gate target in Task 4.
import './governance/policy-store.test.js'
import './governance/preference-store.test.js'
