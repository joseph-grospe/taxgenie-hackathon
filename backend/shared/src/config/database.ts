export interface DatabaseConnectionConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: { rejectUnauthorized: boolean };
  enableChannelBinding?: boolean;
}

function required(input: NodeJS.ProcessEnv, name: string): string {
  const value = input[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when INSTANCE_UNIX_SOCKET is set`);
  }
  return value;
}

export function resolveDatabaseConnectionConfig(
  input: NodeJS.ProcessEnv = process.env,
): DatabaseConnectionConfig {
  const socket = input.INSTANCE_UNIX_SOCKET?.trim();
  if (socket) {
    return {
      host: socket,
      port: 5432,
      database: required(input, "DB_NAME"),
      user: required(input, "DB_USER"),
      password: required(input, "DB_PASSWORD"),
    };
  }

  const databaseUrl = input.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL or INSTANCE_UNIX_SOCKET is required for database access",
    );
  }

  const connectionUrl = new URL(databaseUrl);
  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslcert");
  connectionUrl.searchParams.delete("sslkey");
  connectionUrl.searchParams.delete("sslrootcert");
  connectionUrl.searchParams.delete("channel_binding");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(
    connectionUrl.hostname,
  );

  if (isLocal) {
    return {
      connectionString: connectionUrl.toString(),
      ssl: undefined,
    };
  }

  return {
    connectionString: connectionUrl.toString(),
    ssl: { rejectUnauthorized: true },
    enableChannelBinding: true,
  };
}
