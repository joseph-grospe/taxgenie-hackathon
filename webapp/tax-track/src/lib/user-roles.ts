export const userRoles = ['admin', 'editor', 'viewer'] as const

export const teamOptions = [
  'tax_manager',
  'project_lead',
  'tax_team',
  'ar_team',
  'it',
  'bacon',
  'other',
] as const

export type UserRole = (typeof userRoles)[number]
export type Team = (typeof teamOptions)[number]

export const teamLabels: Record<Team, string> = {
  tax_manager: 'Tax Manager',
  project_lead: 'Project Lead',
  tax_team: 'Tax Team',
  ar_team: 'AR Team',
  it: 'IT',
  bacon: 'BACon',
  other: 'Other',
}
