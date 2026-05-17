<script lang="ts">
  import TreeView from './TreeView.svelte'
  import type { Turn } from '../dashboard-types.js'

  interface Props {
    turn: Turn
  }

  let { turn }: Props = $props()
</script>

<div class="tree-container">
  <TreeView value={turn} />
</div>
