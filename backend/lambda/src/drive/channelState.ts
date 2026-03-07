import { Pool } from "pg";

export interface DriveChannelState {
  channelId: string;
  resourceId: string;
  pageToken?: string;
}

let pool: Pool | undefined;

function shouldUseSsl(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;

  return !["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function toNodePgConnectionString(databaseUrl: string): string {
  const connectionUrl = new URL(databaseUrl);

  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslcert");
  connectionUrl.searchParams.delete("sslkey");
  connectionUrl.searchParams.delete("sslrootcert");

  return connectionUrl.toString();
}

function getPool(databaseUrl?: string): Pool | undefined {
  if (!databaseUrl) {
    return undefined;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: toNodePgConnectionString(databaseUrl),
      ssl: shouldUseSsl(databaseUrl)
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
    });
  }

  return pool;
}

export async function loadChannelState(input: {
  databaseUrl?: string;
  channelId: string;
  resourceId: string;
}): Promise<DriveChannelState> {
  const db = getPool(input.databaseUrl);

  if (!db) {
    return {
      channelId: input.channelId,
      resourceId: input.resourceId
    };
  }

  const existing = await db.query<{
    channel_id: string;
    resource_id: string;
    page_token: string | null;
  }>(
    `
      SELECT channel_id, resource_id, page_token
      FROM drive_channels
      WHERE channel_id = $1 AND resource_id = $2
      LIMIT 1
    `,
    [input.channelId, input.resourceId]
  );

  if (existing.rowCount && existing.rows[0]) {
    return {
      channelId: existing.rows[0].channel_id,
      resourceId: existing.rows[0].resource_id,
      pageToken: existing.rows[0].page_token ?? undefined
    };
  }

  await db.query(
    `
      INSERT INTO drive_channels (
        channel_id,
        resource_id,
        status,
        page_token,
        created_at,
        updated_at
      ) VALUES ($1, $2, 'active', NULL, NOW(), NOW())
      ON CONFLICT (channel_id, resource_id)
      DO NOTHING
    `,
    [input.channelId, input.resourceId]
  );

  return {
    channelId: input.channelId,
    resourceId: input.resourceId
  };
}

export async function updateChannelToken(input: {
  databaseUrl?: string;
  channelId: string;
  resourceId: string;
  pageToken: string;
}): Promise<void> {
  const db = getPool(input.databaseUrl);
  if (!db) {
    return;
  }

  await db.query(
    `
      UPDATE drive_channels
      SET page_token = $3,
          updated_at = NOW()
      WHERE channel_id = $1 AND resource_id = $2
    `,
    [input.channelId, input.resourceId, input.pageToken]
  );
}
