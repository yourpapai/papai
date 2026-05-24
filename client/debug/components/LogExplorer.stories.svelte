<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeDashboardState, makeLogEntry } from '../../stories/fixtures/debug.js'
  import LogExplorer from './LogExplorer.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/LogExplorer',
    component: LogExplorer,
  })

  const noop = () => undefined

  const manyLogs = Array.from({ length: 20 }, (_, i) =>
    makeLogEntry({ level: i % 4 === 0 ? 40 : 30, msg: `log line ${i}` }),
  )
</script>

<Story name="Populated" args={{ dashboard: makeDashboardState({ logs: manyLogs }), onSelectLog: noop }} />

<Story name="Empty" args={{ dashboard: makeDashboardState({ logs: [], logScopes: new Set() }), onSelectLog: noop }} />
