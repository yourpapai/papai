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

// Fail fast at preview boot if any fixture has drifted from its live schema.
assertFixturesMatchSchemas()

initialize({ onUnhandledRequest: 'bypass' })
installSseStub()
installIntersectionObserverStub()

// Each story loads base+tokens + only its own app's CSS, matching what the real app
// serves. `storybook:prepare` (package.json) generates one `storybook-<area>.css` per
// app (base+tokens+app) plus `storybook-shared.css` (base+tokens); this loader points a
// single <link> at the story's own sheet, so no cross-app CSS collides.
function appGlobalsHref(title: string): string {
  const area = appAreaFor(title)
  return `/storybook-${area ?? 'shared'}.css`
}

function applyAppGlobals(title: string): void {
  const href = appGlobalsHref(title)
  const existing = document.getElementById('sb-app-globals')
  if (existing instanceof HTMLLinkElement) {
    if (existing.getAttribute('href') !== href) existing.setAttribute('href', href)
    return
  }
  const link = document.createElement('link')
  link.id = 'sb-app-globals'
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
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
