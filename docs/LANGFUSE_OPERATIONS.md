# Langfuse Operations Runbook

This runbook covers the dedicated Langfuse EC2 deployment.

## Runtime Topology

- Dedicated EC2 (`t3.xlarge`, 100GB root disk)
- Public IP with SG allowlist on port `3000`
- Docker Compose stack (web, worker, postgres, clickhouse, redis, minio)

## Access and Security

- Use AWS SSM Session Manager for host access.
- Keep SSH disabled.
- Restrict SG ingress to approved CIDR ranges.
- Store bootstrap keys/secrets in AWS Secrets Manager.

## Common Operations

### Check Container Health

```bash
docker ps
```

### Restart Langfuse

```bash
cd /opt/langfuse
docker compose up -d
```

### Pull Latest Images

```bash
cd /opt/langfuse
docker compose pull
docker compose up -d
```

### View Logs

```bash
cd /opt/langfuse
docker compose logs -f langfuse-web
```

## Incident Checklist

1. Confirm EC2 status checks are healthy.
2. Confirm disk usage has headroom.
3. Confirm containers are running.
4. Check app logs for DB/clickhouse/redis connection failures.
5. Validate worker and lambda `LANGFUSE_HOST` points to current instance.

## Backup and Recovery (v1 baseline)

- Backup strategy for this phase is volume snapshots.
- Snapshot Docker volumes for stateful services:
1. Postgres
2. ClickHouse
3. MinIO

## Upgrade Safety

1. Snapshot volumes.
2. Pull updated images.
3. Restart compose stack.
4. Run smoke test by sending one test trace.
