<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { applyToolDefaultPreset, fetchToolDefaults, setToolDefault } from '../../admin-fetchers.js'
  import ToolsSection from '../ToolsSection.svelte'
</script>

<!-- contextId is unused by the admin fetchers; dummy value to satisfy ToolsSection's required prop -->
<ToolsSection
  contextId="admin-default"
  sectionId="tool-defaults"
  eyebrow="Admin · Access"
  title="Default tool permissions"
  fetchToolsFn={fetchToolDefaults}
  setToolPermissionFn={setToolDefault}
  applyToolPresetFn={applyToolDefaultPreset} />
