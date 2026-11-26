/**
 * Registers `/opm` Discord application slash commands via Discord's REST API.
 *
 * Requires:
 *   DISCORD_APPLICATION_ID  - Discord Application ID (from Developer Portal -> General Information)
 *   DISCORD_BOT_TOKEN       - Discord Bot Token (from Developer Portal -> Bot)
 *
 * Optional:
 *   DISCORD_GUILD_ID        - Register instantly to a single test guild instead of globally
 *
 *   npm run discord:register
 */
import "dotenv/config";
import { registerDiscordCommands } from "../src/lib/integrations/discordCommands";

async function main() {
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!applicationId || !botToken) {
    console.error(
      "Missing required environment variables: DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set."
    );
    process.exit(2);
  }

  const registered = await registerDiscordCommands({
    applicationId,
    botToken,
    guildId,
  });

  const scope = guildId ? `guild ${guildId}` : "global application scope";
  const count = Array.isArray(registered) ? registered.length : 1;
  console.log(`Registered ${count} Discord command(s) for ${scope}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
