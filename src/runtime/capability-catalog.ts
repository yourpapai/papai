// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ToolCapabilityCatalog = {
  register(capabilityId: string, wireName: string): void
  resolve(capabilityId: string): string
  clear(): void
  entries(): ReadonlyArray<readonly [capabilityId: string, wireName: string]>
}

export function createToolCapabilityCatalog(): ToolCapabilityCatalog {
  const capabilities = new Map<string, string>()

  return {
    register(capabilityId, wireName): void {
      const existingWireName = capabilities.get(capabilityId)
      if (existingWireName !== undefined && existingWireName !== wireName) {
        throw new Error(`Duplicate tool capability id '${capabilityId}'`)
      }
      capabilities.set(capabilityId, wireName)
    },
    resolve(capabilityId): string {
      const wireName = capabilities.get(capabilityId)
      if (wireName === undefined) throw new Error(`Unknown tool capability id '${capabilityId}'`)
      return wireName
    },
    clear(): void {
      capabilities.clear()
    },
    entries(): ReadonlyArray<readonly [capabilityId: string, wireName: string]> {
      return Array.from(capabilities.entries())
    },
  }
}

export const toolCapabilityCatalog = createToolCapabilityCatalog()
