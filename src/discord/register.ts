import type { Client } from "discord.js";
import * as activity_event from "./events/__activity.js";
import * as error_event from "./events/__error.js";
import * as interaction_event from "./events/__interaction_create.js";
import * as ready_event from "./events/__ready.js";

export function register(client: Client, server_location: string): void {

  // import file ini nggak pasang listener
  ready_event.register(client);
  error_event.register(client);
  activity_event.register(client);
  interaction_event.register(client, server_location);

}
