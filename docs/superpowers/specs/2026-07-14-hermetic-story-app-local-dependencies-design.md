<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# App-local dependencies for hermetic story sessions

## Decision

Every story-runner session materializes the verified dependency snapshot at
`<session>/app/node_modules`. The sandboxed child treats `<session>/app` as
its only source-and-dependency read root.

The dependency cache remains a parent-owned, sealed source for this
materialization. It is never mounted, linked, or otherwise exposed directly
to the child process.

## Motivation

On Darwin, Bun resolves scoped packages by enumerating ancestor directories
above `appRoot`. A sibling dependency link (`<session>/node_modules`) and an
app-local link back to it still cause that enumeration. Allowing those system
temporary-directory ancestors would weaken the session-only filesystem read
boundary. Materializing dependencies below `appRoot` lets the normal Bun
resolver operate without any parent-directory permission.

## Session layout

```
<session>/
  app/                         read-only after assembly
    <captured source files>
    node_modules/              materialized verified dependency tree
  tmp/                         mode 0700, child-writable
  reports/<name>.xml           exact pre-created child outputs
```

`app/node_modules` is a real directory, not a symlink. Its contents are
copied or cloned only from the sealed dependency snapshot, retaining supported
internal symlinks and rejecting unsafe entries under the same tree-validation
rules used for cache acquisition. The completed `app/` tree is made immutable
and fingerprinted together with its dependencies.

## Backend changes

- **Darwin:** permit read access to `appRoot` and platform runtime paths only.
  It has no dependency-cache, temporary-parent, worktree, or home-directory
  read grant.
- **Linux:** mount `appRoot` read-only at `/session/app`; remove the separate
  dependency-cache/node_modules bind mount. The existing writable `tmp` and
  exact report-file mounts remain unchanged.
- **Runner:** use only the app-local dependency layout. Candidate manifest
  evidence still records the sealed cache dependency fingerprint and selected
  sandbox backend; session integrity verifies the materialized app tree before
  and after child execution.

## Validation

Tests must prove that:

1. a scoped package resolves in the Darwin profile without temporary-parent
   access;
2. the app-local tree matches the sealed dependency snapshot and mutation is
   detected by session integrity verification;
3. Linux has no separate dependency-cache mount;
4. a direct unsandboxed control can resolve dependencies while the sandboxed
   child cannot read outside its session app/tmp/exact-report paths.

## Non-goals

This change does not grant reads to temporary-directory ancestors, worktrees,
`HOME`, or the dependency-cache root. It does not alter cache acquisition,
candidate/baseline manifest compatibility, report transfer, or the required
CI sandbox policy.
