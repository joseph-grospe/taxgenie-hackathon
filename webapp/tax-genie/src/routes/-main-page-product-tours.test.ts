import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('main page product tour wiring', () => {
  it('wires Help restart and title targets into every main page route', () => {
    const routeContracts = [
      ['src/routes/batches.tsx', 'BatchesTour', 'BATCHES_TOUR_TARGETS'],
      ['src/routes/issues.tsx', 'IssuesTour', 'ISSUES_TOUR_TARGETS'],
      ['src/routes/validated.tsx', 'ValidatedTour', 'VALIDATED_TOUR_TARGETS'],
      [
        'src/routes/reconciliation.tsx',
        'ReconciliationTour',
        'RECONCILIATION_TOUR_TARGETS',
      ],
      ['src/routes/merge-pdfs.tsx', 'MergePdfsTour', 'MERGE_PDFS_TOUR_TARGETS'],
      [
        'src/routes/override-requests.tsx',
        'OverridesTour',
        'OVERRIDES_TOUR_TARGETS',
      ],
      ['src/routes/audit.tsx', 'AuditTour', 'AUDIT_TOUR_TARGETS'],
      ['src/routes/settings.tsx', 'SettingsTour', 'SETTINGS_TOUR_TARGETS'],
    ] as const

    for (const [path, tourComponent, targetMap] of routeContracts) {
      const source = readSource(path)

      expect(source).toContain('tourStartSignal')
      expect(source).toContain('Guide me through this page')
      expect(source).toContain('onStartTour')
      expect(source).toContain('tourTargets=')
      expect(source).toContain(`title: ${targetMap}.title`)
      expect(source).toContain(tourComponent)
      expect(source).toContain('startSignal={tourStartSignal}')
    }
  })

  it('keeps route-specific product tour targets visible and stable', () => {
    expect(readSource('src/routes/batches.tsx')).toContain(
      'BATCHES_TOUR_TARGETS.repositoryTabs',
    )
    expect(readSource('src/routes/issues.tsx')).toContain(
      'ISSUES_TOUR_TARGETS.statusTabs',
    )
    expect(readSource('src/routes/validated.tsx')).toContain(
      'VALIDATED_TOUR_TARGETS.table',
    )
    expect(readSource('src/routes/reconciliation.tsx')).toContain(
      'RECONCILIATION_TOUR_TARGETS.resultsTable',
    )
    expect(readSource('src/routes/override-requests.tsx')).toContain(
      'OVERRIDES_TOUR_TARGETS.table',
    )
    expect(readSource('src/routes/audit.tsx')).toContain(
      'AUDIT_TOUR_TARGETS.filters',
    )
    expect(readSource('src/routes/settings.tsx')).toContain(
      'SETTINGS_TOUR_TARGETS.roleMatrix',
    )
  })

  it('keeps permission-sensitive tours conditional', () => {
    const mergeSource = readSource('src/routes/merge-pdfs.tsx')
    const settingsSource = readSource('src/routes/settings.tsx')

    expect(mergeSource).toContain('canExportPdf')
    expect(mergeSource).toContain('canExportPdf ? <MergePdfsTour')
    expect(settingsSource).toContain('if (!canManageUsers)')
    expect(settingsSource).toContain('DevDataResetPanel')
    expect(settingsSource).not.toContain('SETTINGS_TOUR_TARGETS.devReset')
  })

  it('exposes reusable panel tour target props without changing callers that omit them', () => {
    const appShellSource = readSource('src/components/app-shell.tsx')
    const validatedPanelSource = readSource(
      'src/components/validated-documents-panel.tsx',
    )
    const mergePanelSource = readSource(
      'src/components/signed-pdf-merge-panel.tsx',
    )

    expect(appShellSource).toContain('tourTargets?: SiteHeaderTourTargets')
    expect(appShellSource).toContain('tourTargets={tourTargets}')
    expect(validatedPanelSource).toContain('tourTargets?: {')
    expect(validatedPanelSource).toContain('tourTargets?.filters')
    expect(validatedPanelSource).toContain('tourTargets?.table')
    expect(mergePanelSource).toContain('tourTargets?: {')
    expect(mergePanelSource).toContain('tourTargets?.workflow')
    expect(mergePanelSource).toContain('tourTargets?.recentJobs')
  })
})
