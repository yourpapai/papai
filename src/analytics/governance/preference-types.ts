// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Where a preference mutation came from; recorded on the row and its audit. */
export type PreferenceSource = 'settings' | 'authenticated_request' | 'operator_migration'
