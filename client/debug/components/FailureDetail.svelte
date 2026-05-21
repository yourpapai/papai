<script lang="ts">
  import TreeView from '../../shared/TreeView.svelte'
  import type { ToolFailure } from '../dashboard-types.js'

  interface Props {
    failure: ToolFailure
  }

  let { failure }: Props = $props()
</script>

<div class="tree-container">
  <TreeView value={failure} />
</div>
