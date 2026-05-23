// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Preview } from '@storybook/svelte-vite'

// Stub preview. The mock layer (MSW, SSE stub, fixture decorator, theme
// decorator) is wired in during Phase B (Task B9).
const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
  },
}

export default preview
