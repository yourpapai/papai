<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ReleaseSubscriptionSection from './ReleaseSubscriptionSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/ReleaseSubscriptionSection',
    component: ReleaseSubscriptionSection,
    args: { contextId: CONTEXT_ID, scope: 'personal' },
  })
</script>

<!-- enabled = true: shows Unsubscribe button -->
<Story name="Subscribed" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-release-populated' }} />

<!-- enabled = false: shows Subscribe button -->
<Story name="Unsubscribed" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-release-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-release-error' }} />
<Story name="Loading" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-release-loading' }} />
