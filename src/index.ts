import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";
import type { Message } from "discord.js";
import dotenv from "dotenv";
import { config } from "./config";
import { eventStates, groupStates, loadState, persistState, loadGroupState, persistGroupState } from "./state";
import { updateEventMessages, updateGroupMessages } from "./messageSync";
import { handleEventInteractions } from "./interactions/eventInteractions";
import { handleDatePickerInteractions } from "./interactions/datePickerInteractions";
import { handleGroupInteractions } from "./interactions/groupInteractions";
import { loadBirthdays, handleBirthdayInteractions, scheduleBirthdayAnnouncements } from "./birthdays";
import { loadAlbums, startWebServer, setAlbumDiscordClient } from "./albums";
import { initAuth } from "./auth";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  loadState();
  loadGroupState();
  loadBirthdays();
  loadAlbums();
  scheduleBirthdayAnnouncements(readyClient);
  startWebServer();
  setAlbumDiscordClient(readyClient);
  await initAuth(readyClient);
  if (eventStates.size > 0) {
    const guild = readyClient.guilds.cache.get(config.guildId);
    if (guild) {
      for (const [channelId, state] of eventStates) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.type === ChannelType.GuildText) {
          for (const [id, overwrite] of channel.permissionOverwrites.cache) {
            if (overwrite.type !== OverwriteType.Member) continue;
            if (!overwrite.allow.has(PermissionFlagsBits.ViewChannel)) continue;
            if (state.members.has(id)) continue;
            try {
              const member = await guild.members.fetch(id);
              state.members.set(id, { userId: id, displayName: member.displayName, status: 'lurking', plusOne: 0 });
            } catch {}
          }
        }
      }
      persistState();
      for (const channelId of eventStates.keys()) {
        try { await updateEventMessages(guild, channelId); } catch (e) { console.error(`Failed to refresh ${channelId}:`, e); }
      }
      console.log(`Refreshed ${eventStates.size} event message(s).`);
    }
  }

  if (config.groupsChannelId) {
    const guild = readyClient.guilds.cache.get(config.guildId);
    if (guild) {
      const justPopulated: string[] = [];
      for (const [channelId, state] of groupStates) {
        if (state.members.size === 0) {
          const channel = guild.channels.cache.get(channelId);
          if (channel && channel.type === ChannelType.GuildText) {
            for (const [id, overwrite] of channel.permissionOverwrites.cache) {
              if (overwrite.type !== OverwriteType.Member) continue;
              if (!overwrite.allow.has(PermissionFlagsBits.ViewChannel)) continue;
              try {
                const member = await guild.members.fetch(id);
                state.members.set(id, { userId: id, displayName: member.displayName });
              } catch {}
            }
            if (state.members.size > 0) justPopulated.push(channelId);
          }
        }
      }
      persistGroupState();
      if (justPopulated.length > 0) {
        for (const channelId of justPopulated) {
          try { await updateGroupMessages(guild, channelId); } catch (e) { console.error(`Failed to refresh group ${channelId}:`, e); }
        }
        console.log(`Refreshed ${justPopulated.length} group message(s).`);
      }
    }
  }

  if (process.env.HEADER_MESSAGE_ID) {
    const headerContent = [
      "Welcome to **brunch-events**.",
      "- Click the buttons to join the events.",
      "- Use the command `/event` to create your own events.",
      "- Use the command `/addevent` in an existing channel to list it here.",
      "- Messages in this channel will be automatically deleted.",
    ].join("\n");
    try {
      const guild = readyClient.guilds.cache.get(config.guildId);
      const channel = guild?.channels.cache.get(config.eventChannelId);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(process.env.HEADER_MESSAGE_ID);
        if (msg.content !== headerContent) await msg.edit(headerContent);
      }
    } catch (e) { console.error("Failed to update header message:", e); }
  }

  if (process.env.GROUPS_HEADER_MESSAGE_ID && config.groupsChannelId) {
    const headerContent = [
      "Welcome to **snek-groups**.",
      "- Click the buttons to join the groups.",
      "- Use the command `/group` to create your own groups.",
      "- Use the command `/addgroup` in an existing channel to list it here.",
      "- Messages in this channel will be automatically deleted.",
    ].join("\n");
    try {
      const guild = readyClient.guilds.cache.get(config.guildId);
      const channel = guild?.channels.cache.get(config.groupsChannelId);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(process.env.GROUPS_HEADER_MESSAGE_ID);
        if (msg.content !== headerContent) await msg.edit(headerContent);
      }
    } catch (e) { console.error("Failed to update groups header message:", e); }
  }
});

client.on(Events.MessageCreate, (message: Message) => {
  if (message.author.bot) return;

  if (process.env.HEADER_MESSAGE_ID && message.channelId === config.eventChannelId) {
    message.delete().catch(() => {});
    return;
  }

  if (config.groupsChannelId && message.channelId === config.groupsChannelId) {
    message.delete().catch(() => {});
    return;
  }


  if (process.env.WOOF_ENABLED === "true") {
    const match = message.content.match(/himiko([!?.,]*)/i);
    if (match && message.channel.isSendable()) {
      const word = match[0].replace(/[!?.,]*$/, "");
      const punct = match[1];
      let woof: string;
      if (word === word.toUpperCase()) woof = "WOOF";
      else if (word[0] === word[0].toUpperCase()) woof = "Woof";
      else woof = "woof";
      message.channel.send(woof + punct);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) console.log(`Button interaction: ${interaction.customId}`);
    const hasRole = () => {
      const roles = interaction.member?.roles;
      if (!roles) return false;
      if (Array.isArray(roles)) return roles.includes(config.requiredRoleId);
      return roles.cache.has(config.requiredRoleId);
    };

    if (interaction.isChatInputCommand() && !hasRole()) {
      await interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
      return;
    }

    await handleEventInteractions(interaction, interaction.guild);
    await handleDatePickerInteractions(interaction);
    await handleGroupInteractions(interaction, interaction.guild);
    await handleBirthdayInteractions(interaction);
  } catch (error) {
    console.error("Unhandled interaction error:", error);
    try {
      const msg = { content: "Something went wrong. Check the debug log.", ephemeral: true };
      if (interaction.isRepliable()) {
        if ((interaction as any).deferred || (interaction as any).replied) {
          await (interaction as any).followUp(msg);
        } else {
          await (interaction as any).reply(msg);
        }
      }
    } catch {}
  }
});

process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); });
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); });
process.on('exit', (code) => { console.log(`Process exiting with code ${code}`); });
process.on('SIGTERM', () => { console.log('Received SIGTERM'); process.exit(0); });
process.on('SIGHUP', () => { console.log('Received SIGHUP - ignoring'); });

client.login(process.env.DISCORD_TOKEN);
