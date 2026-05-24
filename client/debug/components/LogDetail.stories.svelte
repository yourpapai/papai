<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import { makeLogEntry } from '../../stories/fixtures/debug.js'
  import LogDetail from './LogDetail.svelte'

  const { Story } = defineMeta({
    title: 'debug/components/LogDetail',
    component: LogDetail,
  })
</script>

<Story name="Info" args={{ entry: makeLogEntry() }} />

<Story
  name="Warn with metadata"
  args={{ entry: makeLogEntry({ level: 40, msg: 'slow tool call', scope: 'llm', durationMs: 4200, toolName: 'web_fetch' }) }} />
