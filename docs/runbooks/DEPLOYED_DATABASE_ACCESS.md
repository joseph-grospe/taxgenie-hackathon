# Connecting to a Deployed TaxTrack Database

Use this runbook to connect pgAdmin or another local Postgres client to a deployed TaxTrack RDS database.

TaxTrack RDS stays private. Do not make the database public and do not use an SSH key file. Local access goes through AWS Systems Manager Session Manager port forwarding via an SSM-enabled EC2 instance, normally the deployed worker EC2.

## Prerequisites

- AWS CLI v2 installed and authenticated for the target AWS account.
- AWS Session Manager plugin installed locally.
- IAM permission to start SSM sessions against the worker EC2 instance.
- A deployed stack output with:
  - `workerInstanceId`
  - `dbHost`
  - `databaseUrl`
  - `region`
- The env file for the target stage, for example `.env.dev`, `.env.uat`, or `.env.prod`.

For macOS Apple silicon, install the Session Manager plugin with the official AWS package:

```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac_arm64/session-manager-plugin.pkg" -o "session-manager-plugin.pkg"
sudo installer -pkg session-manager-plugin.pkg -target /
sudo ln -sf /usr/local/sessionmanagerplugin/bin/session-manager-plugin /usr/local/bin/session-manager-plugin
session-manager-plugin
```

Official AWS docs: https://docs.aws.amazon.com/systems-manager/latest/userguide/install-plugin-macos-overview.html

## Get Deployed Stack Values

Use the SST deploy output, or read the latest local SST outputs:

```bash
cat backend/infra/.sst/outputs.json
```

Find these values:

```txt
workerInstanceId
dbHost
databaseUrl
region
```

Example output fields:

```txt
workerInstanceId: i-xxxxxxxxxxxxxxxxx
dbHost: taxtrack-...rds.amazonaws.com
databaseUrl: postgresql://taxtrack:<password>@taxtrack-...rds.amazonaws.com:5432/taxtrack?sslmode=require
region: ap-southeast-1
```

## Configure the Stage Env File

Add or update these values in the target env file.

For dev:

```env
AWS_REGION=ap-southeast-1
AWS_PROFILE=<your-aws-profile>
TAXTRACK_DB_TUNNEL_INSTANCE_ID=<workerInstanceId>
TAXTRACK_DB_TUNNEL_HOST=<dbHost>
TAXTRACK_DB_TUNNEL_LOCAL_PORT=15432
TAXTRACK_DB_TUNNEL_REMOTE_PORT=5432
```

For UAT:

```env
AWS_REGION=ap-southeast-1
AWS_PROFILE=<your-aws-profile>
TAXTRACK_DB_TUNNEL_INSTANCE_ID=<workerInstanceId>
TAXTRACK_DB_TUNNEL_HOST=<dbHost>
TAXTRACK_DB_TUNNEL_LOCAL_PORT=15432
TAXTRACK_DB_TUNNEL_REMOTE_PORT=5432
```

If your `databaseUrl` output is available in the env file, the tunnel script can parse the database name and user from it:

```env
DATABASE_URL=postgresql://taxtrack:<password>@<dbHost>:5432/taxtrack?sslmode=require
```

Do not commit env files that contain real credentials.

## Start the Tunnel

Run the tunnel command from the repo root:

```bash
TAXTRACK_ENV_FILE=.env.dev pnpm db:tunnel
```

For UAT:

```bash
TAXTRACK_ENV_FILE=.env.uat pnpm db:tunnel
```

Leave the terminal open while pgAdmin is connected. The script should print:

```txt
Starting TaxTrack private RDS tunnel through SSM.

SSM target instance: <workerInstanceId>
Remote database:     <dbHost>:5432
Local endpoint:      localhost:15432
```

## Connect from pgAdmin

Create or register a pgAdmin server with:

```txt
Host: localhost
Port: 15432
Maintenance database: taxtrack
Username: taxtrack
Password: <password from databaseUrl or TAXTRACK_DB_PASSWORD>
SSL mode: Require
```

In pgAdmin, SSL mode is under the SSL tab.

Then test with:

```sql
select now();
```

## Connect from psql

With the tunnel running:

```bash
PGSSLMODE=require psql \
  "postgresql://taxtrack:<password>@localhost:15432/taxtrack"
```

## Stop Access

When finished:

1. Disconnect pgAdmin or close `psql`.
2. Stop the tunnel terminal with `Ctrl+C`.

## Troubleshooting

### `SessionManagerPlugin is not found`

Install the AWS Session Manager plugin locally, then retry:

```bash
session-manager-plugin
TAXTRACK_ENV_FILE=.env.dev pnpm db:tunnel
```

### `Invalid instance id: replace-me`

The script is receiving a placeholder instead of the real worker instance ID.

Check the env file:

```bash
grep -n '^TAXTRACK_DB_TUNNEL_' .env.dev
```

Make sure it contains the real `workerInstanceId` and `dbHost` from SST output.

Also check your shell environment:

```bash
env | grep '^TAXTRACK_DB_TUNNEL_'
```

If placeholders are exported in your shell, unset them:

```bash
unset TAXTRACK_DB_TUNNEL_INSTANCE_ID
unset TAXTRACK_DB_TUNNEL_HOST
```

Then retry with the env file:

```bash
TAXTRACK_ENV_FILE=.env.dev pnpm db:tunnel
```

### `TargetNotConnected`

The worker EC2 is not connected to SSM. Check:

- The instance is running.
- The instance has the `AmazonSSMManagedInstanceCore` policy through its IAM role.
- The VPC SSM endpoints exist and are healthy, or the instance has outbound internet access.
- The AWS region matches the deployed stack region.

### `AccessDeniedException`

Your AWS identity cannot start SSM sessions. Ask for permission to use Session Manager against the deployed worker EC2. At minimum, the operator needs permission for `ssm:StartSession` and related session actions on the target instance.

### pgAdmin connection times out

Confirm the tunnel terminal is still running and shows `Local endpoint: localhost:15432`.

If port `15432` is already used locally, choose another local port:

```env
TAXTRACK_DB_TUNNEL_LOCAL_PORT=15433
```

Then connect pgAdmin to port `15433`.

### Authentication fails

Use the username, password, and database name from `databaseUrl`.

For example:

```txt
postgresql://taxtrack:<password>@<dbHost>:5432/taxtrack?sslmode=require
```

means:

```txt
Username: taxtrack
Password: <password>
Database: taxtrack
```
