// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { mount } from 'svelte'

import TranscriptApp from './TranscriptApp.svelte'

export function tokenFromPath(pathname: string): string {
  const rest = pathname.replace(/^\/t\//u, '')
  const seg = rest.split('/')[0] ?? ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

if (typeof document !== 'undefined' && document.getElementById('app') !== null) {
  mount(TranscriptApp, {
    target: document.getElementById('app')!,
    props: { token: tokenFromPath(location.pathname) },
  })
}
