export interface UpsertKnownGroupContextInput {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
}

export interface UpsertGroupAdminObservationInput {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly isAdmin: boolean
}

export interface UpsertGroupUserObservationInput {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}

export interface GroupUserObservation {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}
