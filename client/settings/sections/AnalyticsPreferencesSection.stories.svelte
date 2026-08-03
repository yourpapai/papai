<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import AnalyticsPreferencesSection from './AnalyticsPreferencesSection.svelte'

  const CONTEXT_ID = 'ctx-personal-1'

  const { Story } = defineMeta({
    title: 'settings/sections/AnalyticsPreferencesSection',
    component: AnalyticsPreferencesSection,
    args: { contextId: CONTEXT_ID, scope: 'personal' },
  })
</script>

<!-- aggregate default: both preferences unknown -->
<Story name="AggregateDefault" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-analytics-populated' }} />

<!-- longitudinal allow, external deny -->
<Story name="MixedPreferences" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-analytics-empty' }} />

<Story name="Error" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-analytics-error' }} />
<Story name="Loading" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-analytics-loading' }} />

<!-- delete returns queued in_progress status -->
<Story name="WithdrawalInProgress" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-analytics-withdrawal-in-progress' }} />
