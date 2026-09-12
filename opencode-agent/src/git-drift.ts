// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isDeepStrictEqual } from 'node:util'

import { dependencyDriftError } from './errors.js'
import type { DriftedManifest } from './errors.js'
import type { GitFn } from './git-commit.js'
import { mapSeries } from './sequence.js'
import type { CommandResult } from './shell.js'

/**
 * The manifests whose divergence from base desyncs `node_modules`.
 *
 * `bun.lock` covers every workspace — it is one lockfile at the root — and the
 * `package.json` glob (`:(glob)` magic, see `MANIFEST_PATHS` below) reaches each
 * workspace's own manifest, which is where a dependency is declared before the
 * lockfile resolves it. The root manifest is named beside the glob so no reader
 * has to know that the glob also matches it.
 *
 * Deliberately **not** a broader "config files" list: a drifted `tsconfig.json`
 * or `bunfig.toml` changes what the checks say, not what is installed, and a
 * guard this blunt should refuse only the branches that *cannot* run. The cost
 * of a refusal is a parked issue, so a false positive here is not free.
 */
const MANIFEST_PATHS = ['bun.lock', 'package.json', ':(glob)**/package.json'] as const

/**
 * The top-level manifest fields whose divergence from base desyncs
 * `node_modules` — the fields `bun install` consumes, so the only ones whose
 * change the base-branch install cannot serve.
 *
 * Why each member refuses: the four dependency maps (`dependencies`,
 * `devDependencies`, `optionalDependencies`, `peerDependencies`) say what
 * resolves; `resolutions` and `overrides` say how it resolves; `workspaces`
 * says what exists to be installed at all; `trustedDependencies` says which
 * packages' lifecycle scripts install executes, and `patchedDependencies`
 * says whose content it patches — both kept even though this job installs
 * from base, because a branch that moved them has moved install state and
 * the security posture it encodes.
 *
 * Deliberately excluded: `packageManager` (the workflow pins the runtime
 * itself), `scripts` (inert here — this job never installs from the branch),
 * and `name` / `version` / custom metadata (nothing `bun install` reads).
 * Issue #360 is the exclusion being load-bearing: a one-line `scripts` edit
 * was the whole deliverable, and a path-based refusal parked the finished
 * branch with no command-level exit. The exclusions are named here so the
 * next bun knob has a place to be judged before it joins the list.
 */
const INSTALL_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'resolutions',
  'overrides',
  'workspaces',
  'trustedDependencies',
  'patchedDependencies',
] as const

/** The one manifest whose refusal is not field-level: any byte of the lockfile can move install state. */
const LOCKFILE = 'bun.lock'

/** One side of a manifest, parsed: its top-level fields as a record. */
type ManifestFields = Readonly<Record<string, unknown>>

/**
 * One blob as text, or `null` when that side of history does not carry the
 * path — the added or deleted workspace case, which D3 compares against `{}`.
 *
 * Both `GitFn` flavours answer here: the plain runner reports the non-zero
 * exit git gives a missing path, and `gitOrThrow` turns the same exit into a
 * thrown `GitError`. Either way the side reads as absent — never as an empty
 * string, which would parse-fail its way into naming fields it cannot see.
 */
const readBlob = (gitOrThrow: GitFn, ref: string, path: string): Promise<string | null> =>
  gitOrThrow('show', `${ref}:${path}`).then(
    (shown: CommandResult) => (shown.exitCode === 0 ? shown.stdout : null),
    () => null,
  )

/** Anything `JSON.parse` can return that has manifest fields reachable by name. */
const isManifestObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Parses one side of a manifest. `null` is the fail-closed verdict: the bytes
 * could not be read as a JSON object, so the file counts as drifted with no
 * fields to name. A side that does not carry the file at all parses as `{}`,
 * which is different on purpose — an added workspace declaring dependencies is
 * drift, an added workspace naming only `name` is not.
 */
const parseManifest = (blob: string | null): ManifestFields | null => {
  if (blob === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(blob)
  } catch {
    return null
  }
  return isManifestObject(parsed) ? parsed : null
}

/** The install-relevant fields that moved between the two sides, in `INSTALL_FIELDS` order. */
const driftedFields = (base: ManifestFields, head: ManifestFields): readonly string[] =>
  INSTALL_FIELDS.filter((field) => !isDeepStrictEqual(base[field], head[field]))

/**
 * Compares one changed manifest between `origin/<base>` and `HEAD`; `null`
 * lets it through.
 *
 * The lockfile short-circuits before any parse: it is refused on any byte
 * change because its whole content is install state — there is no field of it
 * that cannot matter.
 */
const inspectManifest = async (gitOrThrow: GitFn, baseRef: string, path: string): Promise<DriftedManifest | null> => {
  if (path === LOCKFILE) return { file: path, fields: [] }
  const base = parseManifest(await readBlob(gitOrThrow, baseRef, path))
  const head = parseManifest(await readBlob(gitOrThrow, 'HEAD', path))
  if (base === null || head === null) return { file: path, fields: [] }
  const fields = driftedFields(base, head)
  return fields.length === 0 ? null : { file: path, fields }
}

/**
 * Refuses a branch whose dependency install state differs from `origin/<base>`.
 *
 * The workflow installs dependencies from the base-branch checkout —
 * deliberately, so a branch the model writes to never decides what
 * `bun install` executes in a job holding every repository secret — and
 * `ensureBranch` switches the tree onto the agent branch *after* that, with no
 * second install. A branch whose install state has drifted from base therefore
 * runs every check against a `node_modules` that cannot serve it: run
 * 32507905723 burned a full PLANNING turn and then died in the pre-commit hook
 * on `TS2307: Cannot find module '@clack/prompts'`, an import the base lockfile
 * had stopped carrying two merges earlier.
 *
 * What counts as drift is decided by content, not by path: a changed
 * `package.json` is parsed on both sides (via `git show`, through the same
 * injected `GitFn` every other git call here uses) and refused only when an
 * install-relevant field moved (`INSTALL_FIELDS`, by deep equality — so a
 * re-serialized but identical dependencies map passes). Issue #360 is why: the
 * change's own deliverable edited one `scripts` line, and the path-based
 * refusal parked a finished branch where `/retry` reproduced the refusal,
 * `/sync` had nothing to merge, and `/review` was refused from `FAILED`. Every
 * unknown shape fails closed per design D3: a manifest that will not parse on
 * either side refuses, and a one-sided manifest is compared against `{}`, so
 * an added workspace with dependencies refuses while one naming only `name`
 * passes. `bun.lock` keeps the unconditional any-diff refusal — there is no
 * byte of it that cannot move install state.
 *
 * Refusing at the branch switch costs one `git diff --name-only` plus two
 * `git show` per changed manifest, and names the remedy instead. `/sync` lifts
 * the refusal (it *is* the remedy), and a branch that intentionally changed
 * dependencies is told the truth: the job cannot install from the agent branch
 * by design, so a maintainer reconciles by hand.
 *
 * Called after the checkout, so `HEAD` is the branch this run will stand on.
 */
export const assertManifestsInSync = async (gitOrThrow: GitFn, branch: string, base: string): Promise<void> => {
  const diff = await gitOrThrow('diff', '--name-only', `origin/${base}`, 'HEAD', '--', ...MANIFEST_PATHS)
  const changed = diff.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const drifted = await mapSeries(changed, (path) => inspectManifest(gitOrThrow, `origin/${base}`, path))
  const refused = drifted.filter((entry): entry is DriftedManifest => entry !== null)
  if (refused.length > 0) throw dependencyDriftError(branch, base, refused)
}
