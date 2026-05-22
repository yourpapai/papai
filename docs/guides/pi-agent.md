<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Papai Pi Guide

Pi is the target replacement for the repo's OpenCode-specific agent setup. This guide documents the shared project wiring and the daily command equivalents the team should use.

## Session Workflow

- Continue the latest session: `pi -c`
- Browse or resume older sessions: `pi -r` or `/resume`
- Navigate the session tree in place: `/tree`
- Fork the current session into a new branch of work: `/fork`
- Clone the current active branch/session: `/clone`

## Shared Project Config

- Project Pi settings live in `.pi/settings.json`
- Project MCP configuration lives in `.mcp.json`
- Local Pi override config belongs in `.pi/mcp.json` and should stay ignored

## MCP Workflow

- `pi-mcp-adapter` is the supported MCP bridge for Pi in this repo
- Project MCP server is `codeindex`
- User-level MCP servers should include `context7` and `synthetic`
- User MCP config should live in `~/.pi/agent/mcp.json`
- Use `/mcp` to inspect status and reconnect servers
- `context7`, `synthetic`, and `codeindex` should be available as direct tools when the adapter is connected

## Superpowers Workflow

- Pi should load shared `obra/superpowers` skills from `~/.agents/skills`
- `~/.pi/agent/AGENTS.md` should force `using-superpowers` at session start
- Use `/skill:name` when deterministic skill loading is needed

## User-Level Pi Setup

- Install shared Pi packages globally in `~/.pi/agent/settings.json`
- Keep provider defaults, auth, and models in user-scope Pi files
- Do not commit user API keys or personal provider choices into repo config

## Subagents

- `pi-subagents` is the supported multi-agent layer for this repo
- Prefer natural-language delegation or the provided slash commands after the package is installed
- Do not install `roach-pi` here; it conflicts with the `obra/superpowers` skill workflow

## Phase 1 Non-Goals

- Do not adopt `oh-my-pi`
- Do not depend on experimental upstream `obra/superpowers` Pi package support
- Do not commit user-scope auth secrets or API keys to repo config files
