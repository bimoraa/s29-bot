import {
  Client,
  GatewayIntentBits,
} from "discord.js";
import * as discord_events from "./register.js";

export function create_discord_client(server_location: string): Client {

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  discord_events.register(client, server_location);

  return client;

}
