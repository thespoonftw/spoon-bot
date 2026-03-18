import dotenv from "dotenv";
dotenv.config();

export const config = {
  guildId: process.env.GUILD_ID!,
  eventChannelId: process.env.EVENT_CHANNEL_ID!,
  eventCategoryId: process.env.EVENT_CATEGORY_ID!,
  requiredRoleId: process.env.REQUIRED_ROLE_ID!,
  groupsChannelId: process.env.GROUPS_CHANNEL_ID,
  groupsRoleId: process.env.GROUPS_ROLE_ID,
  groupsCategoryId: process.env.GROUPS_CATEGORY_ID,
  birthdaysEnabled: process.env.BIRTHDAYS_ENABLED === "true",
  birthdaysChannelId: process.env.BIRTHDAYS_CHANNEL_ID,
  albumsEnabled: process.env.ALBUMS_ENABLED === "true",
};
