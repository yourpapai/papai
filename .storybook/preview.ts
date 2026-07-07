// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Preview } from '@storybook/svelte-vite'
import { initialize } from 'msw-storybook-addon'

import { appAreaFor } from '../client/stories/app-area.js'
import { fixturesLoader } from '../client/stories/decorators/withFixtures.js'
import { assertFixturesMatchSchemas } from '../client/stories/fixtures/schemas.js'
import { installIntersectionObserverStub } from '../client/stories/stubs/intersection-observer.js'
import { installSseStub } from '../client/stories/stubs/sse.js'

import adminCss from '../client/admin/admin.css?raw'
import debugCss from '../client/debug/debug.css?raw'
import settingsCss from '../client/settings/settings.css?raw'
import baseCss from '../client/shared/base.css?raw'
import tokensCss from '../client/shared/tokens.css?raw'
import transcriptCss from '../client/transcript/transcript.css?raw'

// Fail fast at preview boot if any fixture has drifted from its live schema.
assertFixturesMatchSchemas()

initialize({ onUnhandledRequest: 'bypass' })
installSseStub()
installIntersectionObserverStub()

// Shared globals every app bundles; injected for every story.
const SHARED_CSS = `${baseCss}\n${tokensCss}`

// Per-app global CSS — a story gets exactly one, matching what the real app serves.
const APP_CSS: Record<string, string> = {
  settings: settingsCss,
  admin: adminCss,
  debug: debugCss,
  transcript: transcriptCss,
}

// Upsert a single <style> so each story renders with base+tokens + only its own app's CSS.
// Runs as a loader (before render) so screenshots capture the styled state.
function applyAppGlobals(title: string): void {
  const area = appAreaFor(title)
  const appCss = area !== null ? (APP_CSS[area] ?? '') : ''
  let styleEl = document.getElementById('sb-app-globals')
  if (styleEl === null) {
    styleEl = document.createElement('style')
    styleEl.id = 'sb-app-globals'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = `${SHARED_CSS}\n${appCss}`
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
  },
  loaders: [
    (context) => {
      applyAppGlobals(context.title)
      return {}
    },
    fixturesLoader,
  ],
}

export default preview
