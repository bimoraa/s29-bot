import type { AppContext } from "./context.js";
import { load_config } from "../config/index.js";
import { create_discord_client } from "../discord/client.js";
import * as http_server from "../infrastructure/http/server.js";

export function create_app_context(): AppContext {

  const config = load_config();
  const client = create_discord_client(config.server_location);
  const server = http_server.create(() => client.isReady());

  return {
    config,
    client,
    http_server: server,
  };

}
