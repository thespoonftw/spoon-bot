import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
import { config } from "./config";

dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName("event")
    .setDescription("Create a new event with a private channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("addevent")
    .setDescription("Set up join/pin messages for this existing channel as an event")
    .toJSON(),
  ...(config.groupsChannelId ? [
    new SlashCommandBuilder()
      .setName("group")
      .setDescription("Create a new group")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("addgroup")
      .setDescription("Set up a join message for this existing channel as a group")
      .toJSON(),
  ] : []),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave this event or group channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Edit this event's details, date, or settings")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("birthdays")
    .setDescription("View and manage birthday entries")
    .toJSON(),
  ...(config.albumsEnabled ? [
    new SlashCommandBuilder()
      .setName("album")
      .setDescription("Start a photo album for this event channel")
      .toJSON(),
  ] : []),
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

(async () => {
  console.log("Registering slash commands...");
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID!, config.guildId),
    { body: commands }
  );
  console.log("Slash commands registered!");
})();
