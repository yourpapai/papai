<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Process-isolated hermetic story execution

**Date:** 2026-07-13  
**Status:** Approved; supersedes the Phase 1 filesystem-enforcement portion of
[`hermetic-story-hardening-and-tiering-design.md`](./2026-07-13-hermetic-story-hardening-and-tiering-design.md).

## Decision

Tier 0 stories run inside a required operating-system sandbox. JavaScript I/O
guards remain useful scenario diagnostics, but they are not a security boundary
and must not claim to enforce hermeticity on their own.

Every run creates one runner-owned session with four declared inputs or outputs:

1. a read-only captured source and frozen-harness snapshot;
2. a read-only dependency snapshot keyed by Bun version, `package.json`, and
   `bun.lock`;
3. one writable session temporary root; and
4. pre-created, explicitly writable report files.

The child receives the snapshot as its working directory. Its module resolver
finds the dependency snapshot through the session layout rather than the live
worktree. The child may not read or write the live worktree, `HOME`, arbitrary
temporary directories, the network, or undeclared host paths.

## Session layout

The parent creates and owns a per-run session directory. It captures and seals
each input before the sandbox starts; the sandboxed child cannot mutate captured
inputs.

```text
session/
  app/                 read-only source, harness, and built-asset snapshot
  node_modules -> ...  read-only lock-keyed dependency snapshot
  tmp/                 writable only by the child
  reports/
    junit.xml           pre-created child-writable report file
```

`app/` remains the child's current directory. The dependency link is an
explicit, verified runtime input, never a link to the candidate worktree's live
`node_modules`. The manifest records the dependency key and dependency-tree
fingerprint alongside, but separately from, frozen-harness and candidate-runtime
hashes. Compatibility qualification continues to compare only the frozen
harness/scenario contract.

The parent verifies the source, harness, and dependency fingerprints before
launch and after the child exits. It removes the session only after the child
and all report handling have settled.

## Sandbox backends

The launcher selects a backend by platform; absence of a supported backend is a
hard error, never a JavaScript-guard fallback.

| Platform           | Backend                 | Boundary                                                                                                                                   |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS              | `sandbox-exec` profile  | Read source/dependencies and required system/Bun runtime paths; write only session `tmp/` and exact report files; deny network.            |
| Linux CI           | Pinned OCI runner image | Read-only source/dependency mounts, writable session temp and exact report files, no network, dropped capabilities, and no-new-privileges. |
| Any other platform | None                    | Fail with a diagnostic explaining that hermetic stories require a supported sandbox backend.                                               |

The Linux backend runs Bun inside the pinned image so the image supplies the
runtime libraries. The macOS profile permits only the OS and Bun runtime paths
required to execute Bun; these are platform-runtime allowances, not project
input allowances. Backend contract tests prove a direct `file:` import, a Bun
native file API, a glob, a symlink traversal, a network request, and a write
outside the session all fail at the operating-system boundary.

## Dependency snapshot lifecycle

A dependency snapshot cache lives under a runner-owned cache root, outside the
candidate checkout. Its key includes the locked Bun version and hashes of
`package.json` and `bun.lock`. On a cache miss, the parent creates a fresh cache
entry with `bun install --frozen-lockfile`, fingerprints the resulting dependency
tree, and seals it read-only. A failed install or an invalid fingerprint removes
the incomplete entry.

For a run, the parent verifies that cache entry before exposing it through the
session's `node_modules` link. The child gets no write permission to the cache.
This avoids copying the repository's approximately 609 MB dependency tree for
every story run while still making the dependency closure explicit, immutable to
the child, and attributable in the report manifest.

## Defense in depth

The existing JavaScript I/O guard continues to provide scenario names, phases,
and operation diagnostics, restrict scenario-owned writes, and detect resource
leaks. It is deliberately not an exhaustive native API interception layer.
Tests for its individual wrappers remain regression coverage, while hard
hermeticity acceptance tests target the process sandbox.

## Failure policy and evidence

The launcher fails before executing tests when it cannot create a verified
dependency snapshot, session layout, report file, or supported sandbox command.
It fails after the child exits when source/dependency integrity or cleanup fails.
Reports record the sandbox backend, dependency key/fingerprint, source/runtime
hashes, and frozen-harness hash. CI runs Tier 0.1 and Tier 0 only through the
Linux sandbox backend; a scheduled stress lane uses the identical backend with
no retries.

## Non-goals

- Replacing provider-real, platform-integrated, or operational tiers.
- Treating a JavaScript monkey patch as security isolation.
- Allowing an unsupported OS to silently run a weaker test mode.
- Copying the entire dependency tree for every story invocation.
