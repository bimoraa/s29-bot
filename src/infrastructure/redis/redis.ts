import { Redis as RedisClient } from "ioredis";
import type { RedisOptions as BullMQRedisOptions } from "bullmq";
import * as logger from "../../shared/logger/logger.js";

let client: RedisClient | undefined;

/** BEGIN redis */

export function connection_options(redis_url: string): BullMQRedisOptions {

  const url = new URL(redis_url);

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use the redis:// or rediss:// protocol.");
  }

  const options: BullMQRedisOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6_379,
    maxRetriesPerRequest: null,
  };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }

  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }

  if (url.pathname.length > 1) {
    const database = Number(url.pathname.slice(1));

    if (!Number.isInteger(database) || database < 0) {
      throw new Error("REDIS_URL database path must be a non-negative integer.");
    }

    options.db = database;
  }

  if (url.protocol === "rediss:") {
    options.tls = {};
  }

  return options;

}

export async function connect(redis_url: string): Promise<void> {

  if (client?.status === "ready") {
    return;
  }

  if (!client) {
    client = new RedisClient(redis_url, {
      lazyConnect: true,
      connectTimeout: 5_000,
      maxRetriesPerRequest: 1,
    });

    client.on("error", (error) => {
      logger.log("error", "redis_connection_error", {
        message: error.message,
      });
    });
  }

  if (client.status === "wait") {
    await client.connect();
  }

  await check();
  logger.log("info", "redis_connected");

}

export async function check(): Promise<void> {

  if (!client) {
    throw new Error("Redis is not connected.");
  }

  // Redis bisa ready tapi ping tetap gagal
  const response = await client.ping();

  if (response !== "PONG") {
    throw new Error("Redis returned an unexpected health check response.");
  }

}

export async function close(): Promise<void> {

  const current_client = client;
  client = undefined;

  if (current_client?.status === "ready") {
    await current_client.quit();
  } else {
    current_client?.disconnect();
  }

  logger.log("info", "redis_closed");

}

/** END redis */
