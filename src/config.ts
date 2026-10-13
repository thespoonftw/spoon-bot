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
  reviewsChannelId: process.env.REVIEWS_CHANNEL_ID,
  // Channels that particular review types post to instead of the reviews channel. Food and wargames
  // have their own channels; REVIEW_TYPE_CHANNELS adds or overrides these, as "Board Game=123,Film=456"
  // (type names, any case).
  reviewTypeChannels: {
    food: "1282659935779295252",
    wargame: "1064555869884387453",
    ...Object.fromEntries((process.env.REVIEW_TYPE_CHANNELS ?? "").split(",")
      .map(pair => pair.split("=").map(s => s.trim()))
      .filter(([type, id]) => type && id)
      .map(([type, id]) => [type.toLowerCase(), id])),
  } as Record<string, string>,
};
