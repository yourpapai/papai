<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Zero-copy, platform-pure dependency exposure for story sessions

**Date:** 2026-07-17  
**Status:** Implemented; supersedes
[`2026-07-14-hermetic-story-app-local-dependencies-design.md`](./2026-07-14-hermetic-story-app-local-dependencies-design.md).

## Decision

Every story-runner session exposes the verified dependency snapshot to the
sandboxed child as a **read-only bind mount** at `/session/app/node_modules`.
The session `app/` tree keeps an empty, read-only `node_modules/` directory
that exists solely as the container mountpoint. No dependency bytes are copied
per run.

The dependency cache remains parent-owned and sealed. It is never writable in
the container: the mount is read-only, so the untrusted child cannot mutate the
cache regardless of file permissions.

Dependency installation targets the container platform. The staged
`bun install --frozen-lockfile` runs with `--os=<image os> --cpu=<image arch>`
taken from the pinned image, and the cache key includes both values. A cache
entry built on a macOS host therefore contains the Linux optional-dependency
closure the container child actually resolves.

## Motivation

The app-local materialization it replaces existed for one reason: Bun's scoped
package resolution under macOS Seatbelt enumerated temporary-directory
ancestors, so dependencies had to live below `appRoot` as a real directory.
Once `2026-07-14-hermetic-story-docker-all-hosts-design.md` retired the
Seatbelt backend, that reason disappeared, but its costs remained:

- a serial ~609 MB byte copy per run;
- six full-tree SHA-256 passes per run (cache tree and copied tree, before and
  after the child, plus acquisition and materialization fingerprints) —
  roughly 3.6 GB of hashing per invocation;
- measured ~60 s of session setup on an M-series host for a 2.5 s test run.

The repeated re-hashes defended against the trusted parent process corrupting
a user-owned, mode-`0o400`/`0o500` sealed cache between runs — a threat actor
that could equally corrupt the Bun binary or the runner itself. That is
outside the threat model: the child is the untrusted party, and the child now
gets a read-only mount.

## Verification model

| Moment                  | Check                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Cache entry creation    | Full dependency-tree fingerprint; entry manifest records key, Bun version, platform, and tree hash.              |
| Cache acquisition (hit) | Structure and seal only: entry/root are non-writable non-symlink directories; manifest matches the key.          |
| Session assembly        | `app/node_modules` is an empty, read-only directory (mountpoint); app tree is sealed and fingerprinted.          |
| Pre/post child          | App snapshot file hashes and topology; dependency root still exists, non-writable, non-symlink. No tree re-hash. |

The mountpoint must pre-exist: Docker cannot create a nested mountpoint inside
a read-only bind mount (verified against Docker 29). The runner validates this
instead of relying on daemon behavior.

## Runtime contract changes

- `StorySandboxRequest` gains `dependencyRoot`: the canonical host path of the
  cache entry's `node_modules` directory. The Docker command mounts it
  read-only at `/session/app/node_modules`. A root nested inside `appRoot` is
  rejected (it would shadow part of the app tree).
- The manifest continues to record the dependency key and tree fingerprint;
  their meaning is unchanged. The key now also covers the target platform.

## Non-goals

- Re-introducing a writable or per-run-copied dependency tree.
- Hashing the dependency tree on every run as a parent-integrity check.
- Changing the frozen-harness compatibility contract: baseline comparison
  still ignores dependency evidence.
