// One-off: re-renders every event's join message (in brunch-events) and pinned RSVP message with the
// current buttons. Run on the server with the bot's environment:
//   set -a; source .env.snek; set +a; npx ts-node src/refresh-event-posts.ts
import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import { initDb } from "./db";
import { config } from "./config";
import { eventStates, loadState } from "./state";
import { updateJoinMessage, updateInnerMessage } from "./messageSync";

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once("clientReady", async () => {
  initDb();
  loadState();
  const guild = await client.guilds.fetch(config.guildId);
  await guild.channels.fetch();
  for (const [channelId, state] of eventStates) {
    await updateJoinMessage(guild, channelId);
    await updateInnerMessage(guild, channelId);
    console.log(`Refreshed ${state.eventName} (${state.dateText})`);
  }
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
