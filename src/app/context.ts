import type { Server } from "node:http";
import type { Client } from "discord.js";
import type { AppConfig } from "../config/index.js";

export interface AppContext {
  config: AppConfig;
  client: Client;
  http_server: Server;
}
