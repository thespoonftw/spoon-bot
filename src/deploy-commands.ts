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
