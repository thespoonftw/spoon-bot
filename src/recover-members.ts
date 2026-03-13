import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from "discord.js";
import fs from "fs";
import path from "path";
import { config } from "./config";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const STATE_FILE = path.join(__dirname, "..", "data", "events.json");

client.once("ready", async () => {
  console.log("Recovering members...");
  const guild = await client.guilds.fetch(config.guildId);
  await guild.members.fetch(); // load all members into cache

  const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

  for (const [channelId, state] of Object.entries(raw) as [string, any][]) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.log(`Skipping ${channelId} — channel not found`);
      continue;
    }

    const members: [string, any][] = [];
    for (const [id, overwrite] of channel.permissionOverwrites.cache) {
      if (id === guild.roles.everyone.id) continue;
      if (!overwrite.allow.has(PermissionFlagsBits.ViewChannel)) continue;

      const member = guild.members.cache.get(id);
      if (!member) continue;

      members.push([id, { userId: id, displayName: member.displayName, status: "lurking" }]);
      console.log(`  ${channel.name}: found member ${member.displayName}`);
    }

    state.members = members;
    console.log(`${channel.name}: recovered ${members.length} member(s)`);
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(raw, null, 2));
  console.log("Done. Restart Himiko to apply.");
  client.destroy();
});

client.login(process.env.DISCORD_TOKEN);
