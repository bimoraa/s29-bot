import {
  default_http_host,
  default_http_port,
} from "./constants.js";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface AppConfig {
  bot_token: string;
  server_location: string;
  voice_guild_id: string;
  voice_channel_id: string;
  database: DatabaseConfig;
  redis_url: string;
  http_host: string;
  http_port: number;
}

/** BEGIN konfigurasi lingkungan */

function get_required(env: NodeJS.ProcessEnv, name: string): string {

  const value = env[name]?.trim();

  if (!value) {
    throw new Error(name + " is required.");
  }

  return value;

}

function get_port(env: NodeJS.ProcessEnv, name: string, fallback: number): number {

  const raw_value = env[name]?.trim();

  if (!raw_value) {
    return fallback;
  }

  const value = Number(raw_value);

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(name + " must be a port between 1 and 65535.");
  }

  return value;

}

export function load_config(env: NodeJS.ProcessEnv = process.env): AppConfig {

  const bot_token = get_required(env, "BOT_TOKEN");
  const server_location = get_required(env, "SERVER_LOCATION");
  const voice_guild_id = get_required(env, "VOICE_GUILD_ID");
  const voice_channel_id = get_required(env, "VOICE_CHANNEL_ID");
  const database: DatabaseConfig = {
    host: get_required(env, "DATABASE_HOST"),
    port: get_port(env, "DATABASE_PORT", 5432),
    database: get_required(env, "DATABASE_NAME"),
    user: get_required(env, "DATABASE_USER"),
    password: get_required(env, "DATABASE_PASSWORD"),
  };
  const redis_url = get_required(env, "REDIS_URL");
  const http_host = env.HTTP_HOST?.trim() || default_http_host;
  const http_port = get_port(env, "HTTP_PORT", default_http_port);

  if (!/^\d{17,20}$/.test(voice_guild_id)) {
    throw new Error("VOICE_GUILD_ID must be a valid Discord server ID.");
  }

  if (!/^\d{17,20}$/.test(voice_channel_id)) {
    throw new Error("VOICE_CHANNEL_ID must be a valid Discord voice channel ID.");
  }

  if (!/^rediss?:\/\//.test(redis_url)) {
    throw new Error("REDIS_URL must use the redis:// or rediss:// protocol.");
  }

  return {
    bot_token,
    server_location,
    voice_guild_id,
    voice_channel_id,
    database,
    redis_url,
    http_host,
    http_port,
  };

}

/** END konfigurasi lingkungan */
