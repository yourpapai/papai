// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface GlobalVars {
  styles: Record<string, Record<string, unknown>>
}

export interface SimplifiedNode {
  id: string
  name: string
  type: string
  text?: string
  textStyle?: string
  layout?: string
  layoutSizingHorizontal?: string
  layoutSizingVertical?: string
  width?: number
  height?: number
  children?: SimplifiedNode[]
}

export interface SimplifiedDesign {
  name: string
  nodes: SimplifiedNode[]
  globalVars: GlobalVars
}

export interface TraversalContext {
  globalVars: GlobalVars
  styleIndex: Map<string, string>
  counter: { n: number }
  parent?: Record<string, unknown>
}

export type ExtractorFn = (node: Record<string, unknown>, result: SimplifiedNode, context: TraversalContext) => void
