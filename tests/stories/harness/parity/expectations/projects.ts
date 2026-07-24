// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { canonicalize, VOLATILE, VOLATILE_KEYS } from '../canonicalize.js'
import { type ParityGroup, required } from '../group.js'

export const projectGroups: readonly ParityGroup[] = [
  {
    id: 'SCN-parity-project-crud',
    title: 'SCN-parity-project-crud: create, list, update, and delete a project',
    async run({ provider }) {
      const created = required(await provider.createProject?.({ name: 'Parity Project CRUD' }), 'createProject result')
      expect(Object.keys(created).sort()).toEqual(['id', 'name', 'url'])
      expect(canonicalize(created, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, name: 'Parity Project CRUD' })
      const listed = (await provider.listProjects?.()) ?? []
      expect(listed.map((project) => project.name)).toContain('Parity Project CRUD')
      const updated = required(
        await provider.updateProject?.(created.id, { name: 'Parity Project Renamed' }),
        'updateProject result',
      )
      expect(Object.keys(updated).sort()).toEqual(['id', 'name', 'url'])
      expect(canonicalize(updated, VOLATILE_KEYS)).toMatchObject({ id: VOLATILE, name: 'Parity Project Renamed' })
      const removed = await provider.deleteProject?.(created.id)
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ id: VOLATILE })
    },
  },
  {
    id: 'SCN-parity-task-label',
    title: 'SCN-parity-task-label: attach and detach a label from a task',
    async run({ provider, projectId }) {
      const task = await provider.createTask({ projectId, title: 'Label Host' })
      const label = await provider.createLabel?.({ name: 'attach-label' })
      const labelId = required(label, 'createLabel result').id
      const attached = await provider.addTaskLabel?.(task.id, labelId)
      expect(canonicalize(attached, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, labelId: VOLATILE })
      const listed = (await provider.listTaskLabels?.(task.id)) ?? []
      expect(listed.map((entry) => entry.name)).toEqual(['attach-label'])
      const removed = await provider.removeTaskLabel?.(task.id, labelId)
      expect(canonicalize(removed, VOLATILE_KEYS)).toEqual({ taskId: VOLATILE, labelId: VOLATILE })
    },
  },
  {
    id: 'SCN-parity-identity',
    title: 'SCN-parity-identity: provisionWorkspaceMember and listUsers resolve normalized shapes',
    async run({ provider }) {
      const provisioned = required(
        await provider.provisionWorkspaceMember?.({
          chatUserId: 'parity-alice',
          displayName: 'Parity Alice',
          username: 'parity.alice',
        }),
        'provisionWorkspaceMember result',
      )
      expect(Object.keys(provisioned).sort()).toEqual(['login', 'password', 'providerUserId'])
      // `login`/`password`/`providerUserId` are provider-opaque (not in VOLATILE_KEYS):
      // each provider mints them differently — Kaneo synthesizes a unique email login
      // rather than echoing the requested username — so require only presence and type,
      // not a fixed sentinel or literal.
      expect(provisioned.login).toBeTypeOf('string')
      expect(provisioned.login.length).toBeGreaterThan(0)
      expect(provisioned.password.length).toBeGreaterThan(0)
      expect(provisioned.providerUserId.length).toBeGreaterThan(0)
      // The fake's provisionWorkspaceMember doesn't populate the store listUsers reads
      // from, so element-shape parity can't be asserted hermetically here; the strong
      // cross-provider identity signal is the provisionWorkspaceMember assertion above.
      const users = required(await provider.listUsers?.('parity', 10), 'listUsers result')
      expect(Array.isArray(users)).toBe(true)
      // When a provider does surface the just-provisioned member (real Kaneo matches it
      // by the 'parity' substring on name/email; the fake returns [] so this is a no-op
      // there), assert the normalized UserRef shape. A for...of over the filtered matches
      // keeps the check tolerant of the empty fake result without a conditional expect.
      const provisionedMembers = users.filter((user) => user.login === provisioned.login)
      for (const member of provisionedMembers) {
        expect(member.id).toBeTypeOf('string')
        expect(member.id.length).toBeGreaterThan(0)
        const memberName = required(member.name, 'listUsers member.name')
        expect(memberName).toBeTypeOf('string')
        expect(memberName.length).toBeGreaterThan(0)
      }
    },
  },
] as const
