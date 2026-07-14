// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

export type StorySnapshotConstructionSignals = Readonly<{
  current(): 'SIGINT' | 'SIGTERM' | undefined
  dispose(): void
}>

export function captureStorySnapshotConstructionSignals(): StorySnapshotConstructionSignals {
  let signal: 'SIGINT' | 'SIGTERM' | undefined
  const onInterrupt = (): void => {
    signal ??= 'SIGINT'
  }
  const onTerminate = (): void => {
    signal ??= 'SIGTERM'
  }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  return {
    current: () => signal,
    dispose: (): void => {
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
    },
  }
}
