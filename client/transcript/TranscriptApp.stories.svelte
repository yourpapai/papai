<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import StatusBanner from './components/StatusBanner.svelte'

  const { Story } = defineMeta({ title: 'transcript/TranscriptApp', component: StatusBanner })
</script>

<Story name="Connecting" args={{ status: 'connecting' }} />

<Story name="Live" args={{ status: 'live' }} />

<Story name="Finished" args={{ status: 'finished' }} />

<Story name="Recording disabled" args={{ status: 'recording-disabled' }} />

<Story name="Invalid token" args={{ status: 'invalid-token' }} />
