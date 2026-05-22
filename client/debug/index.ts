// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/// <reference lib="dom" />
import { mount } from 'svelte'

import App from './App.svelte'

export function mountApp(target: Element): ReturnType<typeof mount> {
  return mount(App, { target })
}

if (typeof document !== 'undefined' && document.getElementById('app') !== null) {
  mountApp(document.getElementById('app')!)
}
