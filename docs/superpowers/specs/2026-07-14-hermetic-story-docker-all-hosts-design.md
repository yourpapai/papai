<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Docker-only hermetic story execution

## Decision

All production story runs use the existing pinned Linux OCI sandbox backend,
regardless of the host operating system. macOS and Windows use Docker Desktop
to run the same Linux container as Linux hosts.

Native `sandbox-exec` is no longer selected for production story execution.
It may remain as test/diagnostic code until separately removed, but it cannot
be a fallback backend.

## Rationale

Bun 1.3.13 statically resolves scoped packages by enumerating temporary
directory ancestors under macOS Seatbelt, even when `app/node_modules` is a
real immutable directory. Granting those reads violates the session-only read
boundary. The existing Docker backend provides the required OS boundary and
works through Docker Desktop on non-Linux hosts.

## Backend selection and preflight

`selectStorySandboxBackend()` always returns `linux-docker` for supported
hosts. Story execution must call `assertLinuxStorySandboxBackend()` before
session creation, fixture discovery, or child spawn on every host. It verifies
Docker availability and that the exact pinned image runs Bun `1.3.13`.

If Docker is unavailable, inaccessible, or the image version differs, story
execution fails closed with exit code 2. There is no native fallback.

## Runtime contract

The image remains:

`docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e`

The existing Docker policy remains unchanged: app is mounted read-only, only
session tmp and exact report files are writable, root filesystem is read-only,
network and IPC are disabled, capabilities are dropped, no-new-privileges and
PID limits apply, and the container runs as the host UID:GID. The child sees
only the sealed app-local dependency tree in `/session/app/node_modules`.

## Evidence and testing

Candidate manifests record `linux-docker` as the selected backend on every
host. Required CI and local explicit story execution use the same Docker
preflight and command. Tests must prove macOS and Windows platform requests
select Docker, no Darwin production command is emitted, missing Docker fails
before session/spawn, and Docker process-boundary acceptance remains
non-vacuous.

## Non-goals

This decision does not add a mutable custom image, loosen any Docker policy,
allow native sandbox fallback, or make story execution available without
Docker.
