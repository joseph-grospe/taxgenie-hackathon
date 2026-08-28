import { teamOptions, userRoles } from './user-roles'

export const userRoleSet = new Set(userRoles)
export const teamSet = new Set(teamOptions)

export const TEAM_OPTIONS = teamOptions

export type UserRole = (typeof userRoles)[number]
export type Team = (typeof teamOptions)[number]

export type AccessContext = {
  userId: string
  email: string
  role: UserRole
  team: Team
  canExportPdf: boolean
  canExportExcel: boolean
  mustChangePassword: boolean
}

export const toBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1'

export const validateUserRole = (value: string): UserRole => {
  return userRoleSet.has(value as UserRole) ? (value as UserRole) : 'viewer'
}

export const isSuperAdmin = (
  role: string,
): role is Extract<UserRole, 'super_admin'> => role === 'super_admin'

export const validateTeam = (value: string | null | undefined): Team => {
  if (value && teamSet.has(value as Team)) {
    return value as Team
  }

  return 'other'
}

export const parseAccessContext = (value: {
  id?: string | null
  email?: string | null
  role?: string | null
  team?: string | null
  canExportPdf?: boolean | null
  canExportExcel?: boolean | null
  mustChangePassword?: boolean | null
}): AccessContext => {
  return {
    userId: value.id?.trim() || '',
    email: value.email?.trim() || '',
    role: validateUserRole(value.role ?? 'viewer'),
    team: validateTeam(value.team ?? null),
    canExportPdf: toBoolean(value.canExportPdf),
    canExportExcel: toBoolean(value.canExportExcel),
    mustChangePassword: toBoolean(value.mustChangePassword),
  }
}

export const isAdmin = (
  role: string,
): role is Extract<UserRole, 'super_admin' | 'admin'> =>
  isSuperAdmin(role) || role === 'admin'

export const isEditor = (role: string): role is 'editor' => role === 'editor'

export const canRequestCertificateOverride = (role: UserRole): boolean =>
  isAdmin(role) || role === 'editor'

export const canEditValidatedCertificateFields = (
  context: Pick<AccessContext, 'role' | 'userId'>,
  ownerUserId: string | null | undefined,
): boolean =>
  context.role === 'admin' ||
  Boolean(ownerUserId && context.userId === ownerUserId)

export const SIGNING_TEAM = 'tax_manager' satisfies Team

export const SIGNING_TEAM_REQUIRED_MESSAGE =
  'Only Tax Manager Team users can sign certificates.'

export const canSignCertificates = (
  context: Pick<AccessContext, 'team'> | null | undefined,
): boolean => context?.team === SIGNING_TEAM

export const resolveAccessContext = (value: unknown): AccessContext | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const user = value as Partial<Record<keyof AccessContext | string, unknown>>
  const id = typeof user.id === 'string' ? user.id : ''

  if (!id) {
    return null
  }

  return parseAccessContext({
    id,
    email: typeof user.email === 'string' ? user.email : '',
    role: typeof user.role === 'string' ? user.role : 'viewer',
    team: typeof user.team === 'string' ? user.team : null,
    canExportPdf: toBoolean(user.canExportPdf),
    canExportExcel: toBoolean(user.canExportExcel),
    mustChangePassword: toBoolean(user.mustChangePassword),
  })
}

export const parseSessionContext = (value: unknown): AccessContext => {
  const sessionUser =
    value && typeof value === 'object'
      ? (value as Partial<{
          id?: string | null
          email?: string | null
          role?: string | null
          team?: string | null
          canExportPdf?: boolean | string | number | null
          canExportExcel?: boolean | string | number | null
          mustChangePassword?: boolean | string | number | null
        }>)
      : {}

  return parseAccessContext({
    id: sessionUser.id ?? '',
    email: sessionUser.email ?? '',
    role: sessionUser.role,
    team: sessionUser.team,
    canExportPdf: toBoolean(sessionUser.canExportPdf),
    canExportExcel: toBoolean(sessionUser.canExportExcel),
    mustChangePassword: toBoolean(sessionUser.mustChangePassword),
  })
}

export const canNavigate = {
  settings: (role: UserRole) => isAdmin(role),
  referenceData: (role: UserRole) => isSuperAdmin(role),
  upload: (role: UserRole) => isAdmin(role) || role === 'editor',
  batches: (_role: UserRole) => true,
  dashboard: (_role: UserRole) => true,
  issues: (_role: UserRole) => true,
  validated: (_role: UserRole) => true,
  reconciliation: (_role: UserRole) => true,
  reports: (_role: UserRole) => true,
  audit: (role: UserRole) => isAdmin(role),
  overrideRequests: (role: UserRole) => isAdmin(role),
  documents: (_role: UserRole) => true,
  errorDetail: (_role: UserRole) => true,
}

export const canExport = {
  pdf: (role: UserRole, canExportPdf: boolean) => isAdmin(role) || canExportPdf,
  excel: (role: UserRole, canExportExcel: boolean) =>
    isAdmin(role) || canExportExcel,
}

export const routeAccessMatrix = {
  referenceData: {
    super_admin: true,
    admin: false,
    editor: false,
    viewer: false,
  },
  dashboard: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  batches: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  issues: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  validated: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  reconciliation: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  reports: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  audit: {
    super_admin: true,
    admin: true,
    editor: false,
    viewer: false,
  },
  overrideRequests: {
    super_admin: true,
    admin: true,
    editor: false,
    viewer: false,
  },
  documents: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  errorDetail: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: true,
  },
  settings: {
    super_admin: true,
    admin: true,
    editor: false,
    viewer: false,
  },
  upload: {
    super_admin: true,
    admin: true,
    editor: true,
    viewer: false,
  },
} as const satisfies Record<string, Record<UserRole, boolean>>

export type ProtectedRouteKey = keyof typeof routeAccessMatrix

const normalizePath = (path: string): string => {
  if (!path) {
    return '/'
  }

  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1)
  }

  return path
}

const routeMatchers: Array<{
  key: ProtectedRouteKey
  matches: (path: string) => boolean
}> = [
  {
    key: 'referenceData',
    matches: (path) =>
      path === '/reference-data' || path.startsWith('/reference-data/'),
  },
  {
    key: 'settings',
    matches: (path) => path === '/settings' || path.startsWith('/settings/'),
  },
  {
    key: 'upload',
    matches: (path) => path === '/upload' || path.startsWith('/upload/'),
  },
  {
    key: 'batches',
    matches: (path) => path === '/batches' || path.startsWith('/batches/'),
  },
  {
    key: 'documents',
    matches: (path) => path.startsWith('/documents/'),
  },
  {
    key: 'reconciliation',
    matches: (path) =>
      path === '/reconciliation' || path.startsWith('/reconciliation/'),
  },
  {
    key: 'dashboard',
    matches: (path) => path === '/dashboard',
  },
  {
    key: 'issues',
    matches: (path) => path === '/issues',
  },
  {
    key: 'validated',
    matches: (path) => path === '/validated',
  },
  {
    key: 'reports',
    matches: (path) => path === '/merge-pdfs',
  },
  {
    key: 'audit',
    matches: (path) => path === '/audit',
  },
  {
    key: 'overrideRequests',
    matches: (path) =>
      path === '/override-requests' || path.startsWith('/override-requests/'),
  },
  {
    key: 'errorDetail',
    matches: (path) => path === '/error-detail',
  },
]

export const resolveProtectedRoute = (
  path: string,
): ProtectedRouteKey | null => {
  const normalizedPath = normalizePath(path)

  for (const routeMatcher of routeMatchers) {
    if (routeMatcher.matches(normalizedPath)) {
      return routeMatcher.key
    }
  }

  return null
}

export const canAccessRoute = (
  route: ProtectedRouteKey,
  role: UserRole,
): boolean => {
  return routeAccessMatrix[route][role]
}

export const canAccessPath = (path: string, role: UserRole): boolean => {
  const route = resolveProtectedRoute(path)
  return route ? canAccessRoute(route, role) : true
}

export const canExport2307Workbook = (
  context: Pick<AccessContext, 'role' | 'canExportExcel'> | null | undefined,
): boolean =>
  Boolean(
    context &&
    canAccessRoute('upload', context.role) &&
    canExport.excel(context.role, context.canExportExcel),
  )

export const roleAccessMatrix: Record<
  UserRole,
  Record<'settings' | 'users' | 'upload' | 'reports' | 'audit', string>
> = {
  super_admin: {
    settings: 'Full access',
    users:
      'Create, edit, reset password, disable, reactivate, and delete users',
    upload: 'Upload and intake controls',
    reports: 'Create and export reports',
    audit: 'Full audit trail access',
  },
  admin: {
    settings: 'Full access',
    users: 'Create, edit, reset password, and delete users',
    upload: 'Upload and intake controls',
    reports: 'Create and export reports',
    audit: 'Full audit trail access',
  },
  editor: {
    settings: 'No access',
    users: 'No access',
    upload: 'Upload and intake controls',
    reports: 'Create and export reports',
    audit: 'No access',
  },
  viewer: {
    settings: 'No access',
    users: 'No access',
    upload: 'No access',
    reports: 'View reports only',
    audit: 'No access',
  },
}

export const unauthorizedMessage =
  'You do not have permission to perform this action.'
