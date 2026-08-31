const chunks = []

for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

const preview = chunks.join('')
if (!preview.trim()) {
  throw new Error('Pulumi preview output was empty.')
}

const forbiddenResourceTypes = [
  'gcp:sql/',
  'gcp:compute/',
  'gcp:dns/',
  'gcp:certificatemanager/',
  'gcp:monitoring/alertPolicy:',
]
const violations = forbiddenResourceTypes.filter((type) =>
  preview.includes(type),
)

if (violations.length > 0) {
  throw new Error(
    `Hackathon preview contains fixed-cost or excluded resources: ${violations.join(', ')}`,
  )
}

const requiredResourceTypes = [
  'gcp:artifactregistry/repository:Repository',
  'gcp:cloudtasks/queue:Queue',
  'gcp:cloudrunv2/service:Service',
  'gcp:cloudrunv2/job:Job',
  'gcp:storage/bucket:Bucket',
]
const missing = requiredResourceTypes.filter((type) => !preview.includes(type))
if (missing.length > 0) {
  throw new Error(
    `Hackathon preview is missing expected resources: ${missing.join(', ')}`,
  )
}

process.stdout.write(
  'Hackathon preview contains the expected serverless resources and no fixed-cost GCP resource families.\n',
)
