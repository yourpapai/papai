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

function ensureLink(): HTMLLinkElement {
  const existing = document.getElementById('sb-app-globals')
  if (existing instanceof HTMLLinkElement) return existing
  if (existing !== null) existing.remove()
  const link = document.createElement('link')
  link.id = 'sb-app-globals'
  link.rel = 'stylesheet'
  document.head.appendChild(link)
  return link
}

// Point a single <link> at the story's own app sheet and RESOLVE ONLY once the sheet has
// loaded. Storybook awaits loaders before render, so gating here guarantees the CSS is
// applied before `bun shoot` captures (the shoot driver waits on storyRendered + fonts,
// not on stylesheet load, so an un-gated <link> swap could screenshot unstyled).
function applyAppGlobals(title: string): Promise<void> {
  const href = appGlobalsHref(title)
  const link = ensureLink()
  if (link.getAttribute('href') === href) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const settle = (): void => {
      resolve()
    }
    // Resolve on error too (e.g. a missing sheet) so a story never hangs the preview.
    link.addEventListener('load', settle, { once: true })
    link.addEventListener('error', settle, { once: true })
    link.href = href
  })
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
  },
  loaders: [
    async (context) => {
      await applyAppGlobals(context.title)
      return {}
    },
    fixturesLoader,
  ],
}

export default preview
