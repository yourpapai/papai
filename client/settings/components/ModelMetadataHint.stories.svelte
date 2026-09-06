<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ModelMetadataHint from './ModelMetadataHint.svelte'

  const { Story } = defineMeta({
    title: 'settings/components/ModelMetadataHint',
    component: ModelMetadataHint,
  })
</script>

<!--
  One story per resolved state (catalogue hit, prefix guess, no limits known,
  catalogue unavailable); the payload each state renders is served by the
  matching `settings-llm-model-metadata-*` MSW scenario.
-->
<Story
  name="Models dev hit"
  args={{ model: 'gpt-4o' }}
  parameters={{ fixtures: 'settings-llm-model-metadata-models-dev' }}
/>
<Story
  name="Prefix guess"
  args={{ model: 'gpt-4o-2024-08-06' }}
  parameters={{ fixtures: 'settings-llm-model-metadata-prefix-table' }}
/>
<Story
  name="No limits known"
  args={{ model: 'mystery-model' }}
  parameters={{ fixtures: 'settings-llm-model-metadata-no-limits' }}
/>
<Story
  name="Catalogue unavailable"
  args={{ model: 'gpt-4o' }}
  parameters={{ fixtures: 'settings-llm-model-metadata-catalogue-unavailable' }}
/>
