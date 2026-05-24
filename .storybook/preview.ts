// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Preview } from '@storybook/svelte-vite'
import { initialize } from 'msw-storybook-addon'

import { fixturesLoader } from '../client/stories/decorators/withFixtures.js'
import { assertFixturesMatchSchemas } from '../client/stories/fixtures/schemas.js'
import { installIntersectionObserverStub } from '../client/stories/stubs/intersection-observer.js'
import { installSseStub } from '../client/stories/stubs/sse.js'

// Fail fast at preview boot if any fixture has drifted from its live schema.
assertFixturesMatchSchemas()

initialize({ onUnhandledRequest: 'bypass' })
installSseStub()
installIntersectionObserverStub()

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
  },
  loaders: [fixturesLoader],
}

export default preview
