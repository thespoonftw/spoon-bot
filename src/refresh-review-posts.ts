// One-off: re-renders every review's Discord post with the current card layout.
// Run on the server with the bot's environment:
//   set -a; source .env.snek; set +a; npx ts-node src/refresh-review-posts.ts
import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import { dbListReviews } from "./db";
import { setReviewsDiscordClient, updateReviewPost } from "./reviews";

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });

client.once("ready", async () => {
  setReviewsDiscordClient(client);
  const { reviews } = dbListReviews({ limit: -1, offset: 0 });
  let updated = 0;
  for (const r of reviews) {
    try {
      if (await updateReviewPost(r)) updated++;
      else console.log(`No post found for review ${r.id} (${r.title})`);
    } catch (e) {
      console.error(`Failed to update review ${r.id} (${r.title}):`, e);
    }
  }
  console.log(`Updated ${updated} of ${reviews.length} review posts.`);
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
