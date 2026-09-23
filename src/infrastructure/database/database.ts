import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import type { DatabaseConfig } from "../../config/index.js";
import { error_message } from "../../shared/helpers/error_message.js";
import * as logger from "../../shared/logger/logger.js";

let pool: Pool | undefined;

/** BEGIN basis data */

function get_database_pool(): Pool {

  if (!pool) {
    throw new Error("Database is not connected.");
  }

  return pool;

}

export async function connect(config: DatabaseConfig): Promise<void> {

  if (pool) {
    return;
  }

  const next_pool = new Pool({
    ...config,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  next_pool.on("error", (error) => {
    logger.log("error", "database_pool_error", {
      message: error.message,
    });
  });

  pool = next_pool;

  try {
    await check();
  } catch (error) {
    // kalau check awal gagal, jangan tinggalin pool baru ini
    pool = undefined;
    await next_pool.end();
    throw error;
  }

  logger.log("info", "database_connected", {
    host: config.host,
    database: config.database,
  });

}

export async function check(): Promise<void> {

  await get_database_pool().query("SELECT 1");

}

export function query<TRow extends QueryResultRow = QueryResultRow>(
  statement: string,
  values?: unknown[],
): Promise<QueryResult<TRow>> {

  if (values) {
    return get_database_pool().query<TRow, unknown[]>(statement, values);
  }

  return get_database_pool().query<TRow>(statement);

}

// eslint-disable-next-line @typescript-eslint/naming-convention -- nama type parameter ikut aturan snake_case repo
export async function with_transaction<t_result>(
  action: (client: PoolClient) => Promise<t_result>,
): Promise<t_result> {

  const client = await get_database_pool().connect();
  let transaction_started = false;
  let release_error: Error | undefined;

  try {
    await client.query("BEGIN");
    transaction_started = true;

    const result = await action(client);
    await client.query("COMMIT");
    transaction_started = false;
    return result;
  } catch (error) {
    if (transaction_started) {
      try {
        await client.query("ROLLBACK");
      } catch (rollback_error) {
        release_error = rollback_error instanceof Error
          ? rollback_error
          : new Error("Database rollback failed.");
        logger.log("error", "database_transaction_rollback_failed", {
          message: error_message(rollback_error),
        });
      }
    }

    throw error;
  } finally {
    client.release(release_error);
  }

}

export async function close(): Promise<void> {

  const current_pool = pool;
  pool = undefined;

  if (current_pool) {
    await current_pool.end();
  }

  logger.log("info", "database_closed");

}

/** END basis data */
