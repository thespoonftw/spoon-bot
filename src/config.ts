import dotenv from "dotenv";
dotenv.config();

export const config = {
  guildId: process.env.GUILD_ID!,
  eventChannelId: process.env.EVENT_CHANNEL_ID!,
  eventCategoryId: process.env.EVENT_CATEGORY_ID!,
  requiredRoleId: process.env.REQUIRED_ROLE_ID!,
  groupsChannelId: process.env.GROUPS_CHANNEL_ID,
  groupsRoleId: process.env.GROUPS_ROLE_ID,
};
