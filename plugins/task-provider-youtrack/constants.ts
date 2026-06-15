// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskCapability } from 'papai/plugin-types'

import type { TaskProviderTrait } from '../../src/providers/types.js'

/** Fields parameter for issue requests returning full detail. */
export const REACTION_FIELDS = 'id,reaction,author(id,login,fullName,email)'
export const VISIBILITY_FIELDS = '$type,permittedGroups(id,name),permittedUsers(id,login,fullName)'
export const ISSUE_WATCHER_FIELDS = 'watchers(issueWatchers(user(id,login,fullName,email),isStarred),hasStar)'
export const YOUTRACK_DUE_DATE_FIELD_NAME = 'Due Date'

/** Fields parameter for issue requests returning full detail. */
export const ISSUE_FIELDS = [
  'id',
  'idReadable',
  'numberInProject',
  'summary',
  'description',
  'created',
  'updated',
  'resolved',
  'project(id,shortName,name)',
  'reporter(id,login,fullName)',
  'updater(id,login,fullName)',
  'votes',
  'commentsCount',
  'customFields($type,name,value($type,id,name,login,fullName,localizedName,minutes,presentation,text))',
  'tags(id,name,color(id,background,foreground),owner(login))',
  'links(id,direction,linkType(id,name,sourceToTarget,targetToSource,directed,aggregation),issues(id,idReadable,summary,resolved))',
  'attachments(id,name,mimeType,size,url,thumbnailURL,author(login),created)',
  ISSUE_WATCHER_FIELDS,
  `visibility(${VISIBILITY_FIELDS})`,
  'parent(issues(id,idReadable,summary))',
  'subtasks(issues(id,idReadable,summary,resolved))',
].join(',')

/** Lighter fields for list/search results. */
export const ISSUE_LIST_FIELDS = [
  'id',
  'idReadable',
  'numberInProject',
  'summary',
  'resolved',
  'created',
  'project(id,shortName)',
  'customFields($type,name,value($type,name,login))',
].join(',')
export const YOUTRACK_INLINE_LIST_CUSTOM_FIELDS = ['State', 'Priority', YOUTRACK_DUE_DATE_FIELD_NAME] as const

export const COMMENT_FIELDS = `id,text,author(id,$type,login,name),created,updated,reactions(${REACTION_FIELDS})`
export const PROJECT_FIELDS = 'id,name,shortName,description,archived'
export const PROJECT_CUSTOM_FIELD_FIELDS =
  'id,$type,canBeEmpty,isPublic,field(id,name,localizedName,$type,fieldType(id,presentation)),bundle(id,$type),defaultValues(name,localizedName)'
export const TAG_FIELDS = 'id,name,color(id,background)'
export const ATTACHMENT_FIELDS = 'id,name,mimeType,size,url,thumbnailURL,author(login),created'
export const WORK_ITEM_FIELDS = 'id,date,duration(minutes,presentation),text,author(id,login,name),type(id,name)'
export const AGILE_FIELDS = 'id,name'
export const SPRINT_FIELDS = 'id,name,archived,goal,isDefault,start,finish,unresolvedIssuesCount'
export const ACTIVITY_FIELDS =
  'id,timestamp,author(id,login,name,fullName),category(id),field(name),targetMember,added,removed'
export const SAVED_QUERY_FIELDS = 'id,name,query'
export const DEFAULT_ACTIVITY_CATEGORIES = [
  'CommentsCategory',
  'CommentTextCategory',
  'CustomFieldCategory',
  'LinksCategory',
  'AttachmentsCategory',
  'WorkItemCategory',
  'IssueCreatedCategory',
  'IssueResolvedCategory',
  'SummaryCategory',
  'DescriptionCategory',
  'IssueVisibilityCategory',
  'CommentVisibilityCategory',
  'AttachmentVisibilityCategory',
  'ProjectCategory',
  'SprintCategory',
  'TagsCategory',
  'VotersCategory',
  'TotalVotesCategory',
].join(',')

export const YOUTRACK_CAPABILITIES: ReadonlySet<TaskCapability> = new Set<TaskCapability>([
  // Tasks
  'tasks.delete',
  'tasks.count',
  'tasks.relations',
  'tasks.watchers',
  'tasks.votes',
  'tasks.visibility',
  'tasks.commands',
  // Projects (full CRUD)
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.team',
  // Comments (full CRUD)
  'comments.read',
  'comments.create',
  'comments.update',
  'comments.delete',
  'comments.reactions',
  // Labels (full CRUD + assignment)
  'labels.list',
  'labels.create',
  'labels.update',
  'labels.delete',
  'labels.assign',
  // Statuses (state bundles)
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
  // Attachments
  'attachments.list',
  'attachments.upload',
  'attachments.delete',
  // Work items (time tracking)
  'workItems.list',
  'workItems.create',
  'workItems.update',
  'workItems.delete',
  // Sprints, activities, saved queries
  'agiles.list',
  'sprints.list',
  'sprints.create',
  'sprints.update',
  'sprints.assign',
  'activities.read',
  'queries.saved',
])

export const YOUTRACK_TRAITS: ReadonlySet<TaskProviderTrait> = new Set<TaskProviderTrait>([
  'supports-command-language',
  'command-language:youtrack',
  'custom-fields',
])
