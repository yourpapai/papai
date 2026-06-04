// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const dependencyCruiserOptions = {
  tsConfig: { fileName: 'tsconfig.json' },
  exclude: {
    path: ['^tests/', '^review-loop/', '^docs/architecture/', '^client/stories/', '\\.stories\\.'],
  },
  doNotFollow: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'] },
  includeOnly: { path: ['^src/', '^client/'] },
}
