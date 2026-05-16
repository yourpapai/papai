// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface PermissionOption {
  optionId: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface PermissionRequestLike {
  title: string
  kind: string
  locations: Array<{ path: string }>
  rawInput: Record<string, unknown>
  options: readonly PermissionOption[]
}

export function decidePermissionOptionId(request: PermissionRequestLike, _repoRoot: string): string {
  const allowOnce = request.options.find((option) => option.kind === 'allow_once')
  const allowAlways = request.options.find((option) => option.kind === 'allow_always')
  const allowOption = allowOnce ?? allowAlways
  if (allowOption !== undefined) {
    return allowOption.optionId
  }

  const firstOption = request.options[0]
  if (firstOption !== undefined) {
    return firstOption.optionId
  }

  throw new Error('No permission options provided by the ACP agent')
}
