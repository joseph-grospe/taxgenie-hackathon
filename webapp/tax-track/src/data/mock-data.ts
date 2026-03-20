export const dashboardMetrics = [
  {
    label: 'Docs processed',
    value: '1,284',
    delta: '+12.4%',
    trend: 'up',
    footnote: 'Last 30 days',
  },
  {
    label: 'Errors flagged',
    value: '38',
    delta: '-4.1%',
    trend: 'down',
    footnote: 'Variance > PHP 100',
  },
  {
    label: 'Duplicates',
    value: '11',
    delta: '+2',
    trend: 'up',
    footnote: 'TIN + period match',
  },
  {
    label: 'Avg. cycle time',
    value: '4m 12s',
    delta: '-18s',
    trend: 'down',
    footnote: 'Queued → Done',
  },
]

export const recentBatches = [
  {
    id: 'B-2026-011',
    period: 'Q4 2025',
    files: 132,
    status: 'Processing',
    errors: 7,
    duplicates: 2,
    owner: 'Revenue Ops',
    updatedAt: 'Jan 24, 2026 16:12',
  },
  {
    id: 'B-2026-010',
    period: 'Q4 2025',
    files: 88,
    status: 'Validated',
    errors: 3,
    duplicates: 1,
    owner: 'Tax Desk',
    updatedAt: 'Jan 24, 2026 13:20',
  },
  {
    id: 'B-2026-009',
    period: 'Q3 2025',
    files: 156,
    status: 'Reconciled',
    errors: 0,
    duplicates: 0,
    owner: 'Revenue Ops',
    updatedAt: 'Jan 22, 2026 09:05',
  },
]

export const uploadFiles = [
  {
    name: 'AESI_201115150_12312025_1.pdf',
    type: 'Native PDF',
    size: '412 KB',
    status: 'Ready',
  },
  {
    name: 'AESI_201115150_12312025_2.pdf',
    type: 'Scanned PDF',
    size: '980 KB',
    status: 'OCR Required',
  },
  {
    name: 'AESI_201115150_12312025_3.pdf',
    type: 'Native PDF',
    size: '358 KB',
    status: 'Ready',
  },
  {
    name: 'AESI_201115150_12312025_4.pdf',
    type: 'Native PDF',
    size: '401 KB',
    status: 'Ready',
  },
]

export const uploadIntakeStatus = {
  source: 'Manual Upload',
  storage: {
    name: 'Source Upload Bucket',
    id: 'taxtrack-source-files',
  },
  ingestion: {
    status: 'Active',
    storageHealth: 'Healthy',
    lastUploadAt: 'Feb 14, 2026 10:22',
    presignCheckedAt: 'Feb 14, 2026 10:22',
  },
  backfill: {
    status: 'Done',
    startedAt: 'Jan 24, 2026 09:10',
    finishedAt: 'Jan 24, 2026 10:02',
    imported: 1320,
    processed: 1311,
    queued: 0,
    errors: 7,
    duplicates: 2,
  },
}

export const driveIntakeEvents = [
  {
    id: 'EVT-8821',
    at: 'Feb 14, 2026 10:22',
    type: 'Webhook',
    detail: 'Change detected: 4 PDFs updated',
    enqueued: 4,
    status: 'Active',
  },
  {
    id: 'EVT-8816',
    at: 'Feb 14, 2026 09:40',
    type: 'Catch-up',
    detail: 'changes.list replay from last page token',
    enqueued: 0,
    status: 'Done',
  },
  {
    id: 'EVT-8702',
    at: 'Jan 24, 2026 10:02',
    type: 'Backfill',
    detail: 'Folder scan complete',
    enqueued: 1320,
    status: 'Done',
  },
]

export const batchStages = [
  { label: 'Queued', value: 14, status: 'complete' },
  { label: 'OCR', value: 28, status: 'active' },
  { label: 'AI Normalize', value: 22, status: 'active' },
  { label: 'Validation', value: 12, status: 'pending' },
  { label: 'Done', value: 56, status: 'pending' },
]

type BatchDocument = {
  id: string
  fileName: string
  status: string
  stage: string
  confidence: string
  atc: string
  payee: string
  taxBase: string
  taxWithheld: string
}

export const batchDocuments: Array<BatchDocument> = [
  {
    id: 'DOC-1148',
    fileName: 'AESI_201115150_12312025_001.pdf',
    status: 'OCR',
    stage: 'Page 1/2',
    confidence: '0.82',
    atc: 'WC160',
    payee: 'ABC Power Corp',
    taxBase: '39,175.50',
    taxWithheld: '783.51',
  },
  {
    id: 'DOC-1149',
    fileName: 'AESI_201115150_12312025_002.pdf',
    status: 'Validation',
    stage: 'Rules check',
    confidence: '0.76',
    atc: 'WC158',
    payee: 'MetroLine Energy',
    taxBase: '92,040.00',
    taxWithheld: '920.40',
  },
  {
    id: 'DOC-1150',
    fileName: 'AESI_201115150_12312025_003.pdf',
    status: 'Error',
    stage: 'Missing TIN',
    confidence: '0.61',
    atc: 'WC160',
    payee: 'Harbor Utilities',
    taxBase: '15,800.00',
    taxWithheld: '316.00',
  },
  {
    id: 'DOC-1151',
    fileName: 'AESI_201115150_12312025_004.pdf',
    status: 'Done',
    stage: 'Ready',
    confidence: '0.93',
    atc: 'WC051',
    payee: 'Solaris Grid',
    taxBase: '11,500.00',
    taxWithheld: '1,725.00',
  },
]

type BatchDocumentDetail = {
  startedAt: string
  updatedAt: string
  worker: string
  elapsed: string
  logs: Array<{
    timestamp: string
    level: 'info' | 'warning' | 'error'
    message: string
  }>
  errors: Array<{
    code: string
    stage: string
    message: string
  }>
}

export const batchDocumentDetails: Record<
  string,
  BatchDocumentDetail | undefined
> = {
  'DOC-1148': {
    startedAt: 'Jan 26, 2026 08:41',
    updatedAt: 'Jan 26, 2026 08:44',
    worker: 'OCR-Worker-02',
    elapsed: '2m 14s',
    logs: [
      {
        timestamp: '08:41:12',
        level: 'info',
        message: 'Document accepted into batch queue.',
      },
      {
        timestamp: '08:41:48',
        level: 'info',
        message: 'OCR page 1/2 completed.',
      },
      {
        timestamp: '08:42:19',
        level: 'info',
        message: 'OCR page 2/2 running.',
      },
      {
        timestamp: '08:43:04',
        level: 'info',
        message: 'Normalization pass started.',
      },
    ],
    errors: [],
  },
  'DOC-1149': {
    startedAt: 'Jan 26, 2026 08:33',
    updatedAt: 'Jan 26, 2026 08:36',
    worker: 'VAL-Worker-01',
    elapsed: '3m 12s',
    logs: [
      {
        timestamp: '08:33:21',
        level: 'info',
        message: 'AI extraction completed.',
      },
      {
        timestamp: '08:34:02',
        level: 'info',
        message: 'Validation rules loaded (12).',
      },
      {
        timestamp: '08:35:18',
        level: 'warning',
        message: 'Payee address missing; optional field.',
      },
      {
        timestamp: '08:35:49',
        level: 'info',
        message: 'Variance check running.',
      },
    ],
    errors: [],
  },
  'DOC-1150': {
    startedAt: 'Jan 26, 2026 08:28',
    updatedAt: 'Jan 26, 2026 08:31',
    worker: 'VAL-Worker-03',
    elapsed: '2m 46s',
    logs: [
      {
        timestamp: '08:28:07',
        level: 'info',
        message: 'Extraction results received from OCR + AI.',
      },
      {
        timestamp: '08:29:12',
        level: 'info',
        message: 'Validation rules loaded (12).',
      },
      {
        timestamp: '08:30:03',
        level: 'error',
        message: 'Missing mandatory payee TIN.',
      },
      {
        timestamp: '08:30:48',
        level: 'error',
        message: 'Signature detection failed.',
      },
    ],
    errors: [
      {
        code: 'VAL-102',
        stage: 'Validation',
        message: 'Missing payee TIN.',
      },
      {
        code: 'VAL-219',
        stage: 'Validation',
        message: 'Signature not detected on page 1.',
      },
    ],
  },
  'DOC-1151': {
    startedAt: 'Jan 26, 2026 08:19',
    updatedAt: 'Jan 26, 2026 08:22',
    worker: 'POST-Worker-01',
    elapsed: '2m 02s',
    logs: [
      {
        timestamp: '08:19:02',
        level: 'info',
        message: 'Validation passed; preparing ledger export.',
      },
      {
        timestamp: '08:19:54',
        level: 'info',
        message: 'Withholding totals reconciled.',
      },
      {
        timestamp: '08:21:33',
        level: 'info',
        message: 'Document marked ready for reconciliation.',
      },
    ],
    errors: [],
  },
}

export const documentDetailsByFileName: Record<
  string,
  BatchDocumentDetail | undefined
> = {
  'AESI_201115150_12312025_001.pdf': batchDocumentDetails['DOC-1148'],
  'AESI_201115150_12312025_002.pdf': batchDocumentDetails['DOC-1149'],
  'AESI_201115150_12312025_003.pdf': batchDocumentDetails['DOC-1150'],
  'AESI_201115150_12312025_004.pdf': batchDocumentDetails['DOC-1151'],
  'AESI_201115150_12312025_019.pdf': {
    startedAt: 'Jan 26, 2026 07:58',
    updatedAt: 'Jan 26, 2026 08:04',
    worker: 'DUP-Worker-01',
    elapsed: '6m 09s',
    logs: [
      {
        timestamp: '07:58:10',
        level: 'info',
        message: 'Document matched against batch history.',
      },
      {
        timestamp: '07:59:32',
        level: 'info',
        message: 'Potential duplicate found (TIN + period).',
      },
      {
        timestamp: '08:02:41',
        level: 'warning',
        message: 'Duplicate confidence 0.82; queued for review.',
      },
    ],
    errors: [],
  },
  'AESI_201115150_12312025_021.pdf': {
    startedAt: 'Jan 26, 2026 07:44',
    updatedAt: 'Jan 26, 2026 07:51',
    worker: 'VAL-Worker-02',
    elapsed: '7m 05s',
    logs: [
      {
        timestamp: '07:44:08',
        level: 'info',
        message: 'Validation rules loaded (12).',
      },
      {
        timestamp: '07:46:19',
        level: 'error',
        message: 'Payee TIN missing; mandatory field.',
      },
      {
        timestamp: '07:49:12',
        level: 'info',
        message: 'Validation halted; escalated to manual review.',
      },
    ],
    errors: [
      {
        code: 'VAL-102',
        stage: 'Validation',
        message: 'Missing payee TIN.',
      },
    ],
  },
  'AESI_201115150_12312025_024.pdf': {
    startedAt: 'Jan 26, 2026 07:20',
    updatedAt: 'Jan 26, 2026 07:29',
    worker: 'VAL-Worker-04',
    elapsed: '9m 22s',
    logs: [
      {
        timestamp: '07:20:43',
        level: 'info',
        message: 'Tax base variance check running.',
      },
      {
        timestamp: '07:24:18',
        level: 'error',
        message: 'Variance exceeds PHP 100 threshold.',
      },
      {
        timestamp: '07:28:56',
        level: 'info',
        message: 'Document set to validation failure queue.',
      },
    ],
    errors: [
      {
        code: 'VAL-311',
        stage: 'Validation',
        message: 'Variance above PHP 100 threshold.',
      },
    ],
  },
  'AESI_201115150_12312025_030.pdf': {
    startedAt: 'Jan 26, 2026 07:02',
    updatedAt: 'Jan 26, 2026 07:09',
    worker: 'VAL-Worker-05',
    elapsed: '6m 44s',
    logs: [
      {
        timestamp: '07:02:11',
        level: 'info',
        message: 'Signature extraction running.',
      },
      {
        timestamp: '07:05:47',
        level: 'error',
        message: 'Signature missing on page 1.',
      },
      {
        timestamp: '07:08:34',
        level: 'info',
        message: 'Manual review requested by system policy.',
      },
    ],
    errors: [
      {
        code: 'VAL-219',
        stage: 'Validation',
        message: 'Signature not detected on page 1.',
      },
    ],
  },
}

type IssueQueueRow = {
  id: string
  type: string
  fileName: string
  reason: string
  severity: string
  owner: string
  updatedAt: string
}

export const issueQueue: Array<IssueQueueRow> = [
  {
    id: 'ISS-0912',
    type: 'Duplicate',
    fileName: 'AESI_201115150_12312025_019.pdf',
    reason: 'TIN + period match',
    severity: 'Low',
    owner: 'Revenue Ops',
    updatedAt: 'Jan 24, 2026 14:05',
  },
  {
    id: 'ISS-0913',
    type: 'Error',
    fileName: 'AESI_201115150_12312025_021.pdf',
    reason: 'Missing payee TIN',
    severity: 'High',
    owner: 'Tax Desk',
    updatedAt: 'Jan 24, 2026 14:11',
  },
  {
    id: 'ISS-0914',
    type: 'Error',
    fileName: 'AESI_201115150_12312025_024.pdf',
    reason: 'Variance > PHP 100',
    severity: 'High',
    owner: 'Tax Desk',
    updatedAt: 'Jan 24, 2026 14:22',
  },
  {
    id: 'ISS-0915',
    type: 'Error',
    fileName: 'AESI_201115150_12312025_030.pdf',
    reason: 'Missing signature',
    severity: 'Medium',
    owner: 'Revenue Ops',
    updatedAt: 'Jan 24, 2026 14:38',
  },
]

export const errorDetail = {
  documentId: 'DOC-1150',
  fileName: 'AESI_201115150_12312025_003.pdf',
  period: 'Q4 2025',
  payor: 'Aboitiz Energy Solutions, Inc.',
  payee: 'Harbor Utilities',
  atc: 'WC160',
  taxWithheld: '316.00',
  confidence: '0.61',
  issues: [
    'Missing payee TIN',
    'Printed name not detected',
    'Signature missing',
  ],
  fields: [
    { label: 'Payee Name', value: 'Harbor Utilities', confidence: '0.88' },
    { label: 'Payee TIN', value: '—', confidence: '0.12' },
    {
      label: 'Payor Name',
      value: 'Aboitiz Energy Solutions, Inc.',
      confidence: '0.91',
    },
    { label: 'Payor TIN', value: '201115150', confidence: '0.94' },
    { label: 'ATC Code', value: 'WC160', confidence: '0.78' },
    { label: 'Tax Base', value: '15,800.00', confidence: '0.62' },
    { label: 'Tax Withheld', value: '316.00', confidence: '0.74' },
  ],
}

type ValidatedDocumentRow = {
  id: string
  fileName: string
  payee: string
  period: string
  atc: string
  taxBase: string
  taxWithheld: string
  confidence: string
  status: string
}

export const validatedDocuments: Array<ValidatedDocumentRow> = [
  {
    id: 'VAL-3301',
    fileName: 'AESI_201115150_12312025_004.pdf',
    payee: 'Solaris Grid',
    period: 'Q4 2025',
    atc: 'WC051',
    taxBase: '11,500.00',
    taxWithheld: '1,725.00',
    confidence: '0.93',
    status: 'Ready',
  },
  {
    id: 'VAL-3302',
    fileName: 'AESI_201115150_12312025_006.pdf',
    payee: 'MetroLine Energy',
    period: 'Q4 2025',
    atc: 'WC160',
    taxBase: '27,340.00',
    taxWithheld: '546.80',
    confidence: '0.89',
    status: 'Ready',
  },
  {
    id: 'VAL-3303',
    fileName: 'AESI_201115150_12312025_008.pdf',
    payee: 'Northshore Power',
    period: 'Q4 2025',
    atc: 'WC158',
    taxBase: '48,200.00',
    taxWithheld: '482.00',
    confidence: '0.84',
    status: 'Ready',
  },
]

export const reconciliationSummary = {
  totalRecords: 248,
  matched: 226,
  unmatched: 22,
  varianceTotal: 'PHP 4,220.00',
}

export type ReconciliationRow = {
  id: string
  customer: string
  tin: string
  invoice: string
  billing: string
  glDate: string
  booksBase: string
  booksCwt: string
  formBase: string
  formCwt: string
  variance: string
}

export const reconciliationRows: Array<ReconciliationRow> = [
  {
    id: 'REC-0001',
    customer: 'ABC Power Corp',
    tin: '000-000-001-00000',
    invoice: 'INV-0041',
    billing: 'Dec-25',
    glDate: 'Jan-26',
    booksBase: '39,175.50',
    booksCwt: '783.51',
    formBase: '39,050.00',
    formCwt: '781.00',
    variance: '125.50',
  },
  {
    id: 'REC-0002',
    customer: 'MetroLine Energy',
    tin: '000-000-002-00000',
    invoice: 'INV-0049',
    billing: 'Dec-25',
    glDate: 'Jan-26',
    booksBase: '92,040.00',
    booksCwt: '920.40',
    formBase: '92,000.00',
    formCwt: '920.00',
    variance: '40.00',
  },
  {
    id: 'REC-0003',
    customer: 'Harbor Utilities',
    tin: '000-000-003-00000',
    invoice: 'INV-0051',
    billing: 'Dec-25',
    glDate: 'Jan-26',
    booksBase: '15,800.00',
    booksCwt: '316.00',
    formBase: '15,800.00',
    formCwt: '316.00',
    variance: '0.00',
  },
]

export const reportRuns = [
  {
    id: 'REP-2026-01',
    period: 'Q4 2025',
    kind: 'Quarterly Reconciliation',
    status: 'Ready',
    generatedAt: 'Jan 24, 2026 15:12',
    format: 'XLSX',
  },
  {
    id: 'REP-2026-02',
    period: 'Dec 2025',
    kind: 'Monthly Summary',
    status: 'Processing',
    generatedAt: 'Jan 24, 2026 15:40',
    format: 'CSV',
  },
  {
    id: 'REP-2026-03',
    period: 'Nov 2025',
    kind: 'Monthly Summary',
    status: 'Ready',
    generatedAt: 'Jan 22, 2026 10:18',
    format: 'PDF',
  },
]

export const auditLogs = [
  {
    time: 'Jan 24, 2026 16:22',
    actor: 'A. Reyes',
    action: 'Exported report',
    object: 'REP-2026-01',
    detail: 'Quarterly Reconciliation (Q4 2025)',
  },
  {
    time: 'Jan 24, 2026 15:58',
    actor: 'System',
    action: 'Batch processed',
    object: 'B-2026-011',
    detail: '132 docs, 94% success',
  },
  {
    time: 'Jan 24, 2026 14:38',
    actor: 'J. Santos',
    action: 'Reviewed error',
    object: 'ISS-0915',
    detail: 'Missing signature',
  },
  {
    time: 'Jan 24, 2026 14:05',
    actor: 'System',
    action: 'Duplicate detected',
    object: 'ISS-0912',
    detail: 'TIN + period match',
  },
]

export const processingTrend = [
  { date: '2025-10-01', processed: 32, exceptions: 3 },
  { date: '2025-10-05', processed: 54, exceptions: 4 },
  { date: '2025-10-10', processed: 41, exceptions: 2 },
  { date: '2025-10-15', processed: 76, exceptions: 5 },
  { date: '2025-10-20', processed: 63, exceptions: 6 },
  { date: '2025-10-25', processed: 58, exceptions: 4 },
  { date: '2025-11-01', processed: 72, exceptions: 5 },
  { date: '2025-11-07', processed: 69, exceptions: 3 },
  { date: '2025-11-14', processed: 80, exceptions: 6 },
  { date: '2025-11-21', processed: 75, exceptions: 4 },
  { date: '2025-11-28', processed: 88, exceptions: 7 },
  { date: '2025-12-05', processed: 92, exceptions: 6 },
  { date: '2025-12-12', processed: 95, exceptions: 8 },
  { date: '2025-12-19', processed: 84, exceptions: 5 },
  { date: '2025-12-26', processed: 90, exceptions: 6 },
  { date: '2025-12-31', processed: 96, exceptions: 4 },
]

export const adminUsers = [
  {
    name: 'J. Santos',
    email: 'jsantos@aesi.ph',
    role: 'Reviewer',
    status: 'Active',
  },
  {
    name: 'M. Cruz',
    email: 'mcruz@aesi.ph',
    role: 'Ops',
    status: 'Active',
  },
  {
    name: 'L. Navarro',
    email: 'lnavarro@aesi.ph',
    role: 'Admin',
    status: 'Active',
  },
]

export const atcRates = [
  { code: 'WC160', rate: '2%', description: 'Professional fees' },
  { code: 'WC158', rate: '1%', description: 'Rental payments' },
  { code: 'WC051', rate: '15%', description: 'Government payments' },
]
