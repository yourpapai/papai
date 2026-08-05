// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * True when the request targets `namespace`.
 *
 * `/settings/api/coding-credentials` serves three namespaces off one URL. Handlers for it
 * must return `undefined` when this is false, so MSW falls through to the next matching
 * handler instead of answering another section's request with the wrong body.
 */
export const isNamespace = (request: Request, namespace: string): boolean =>
  new URL(request.url).searchParams.get('namespace') === namespace
