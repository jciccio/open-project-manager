export interface DiscordApplicationCommandOption {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  options?: DiscordApplicationCommandOption[];
}

export interface DiscordApplicationCommandDefinition {
  name: string;
  description: string;
  type: number;
  options: DiscordApplicationCommandOption[];
}

// Discord Application Command option types: 1 = SUB_COMMAND, 3 = STRING.
// Keep option names synchronized with handleDiscordInteraction in ./discord.ts.
export const DISCORD_OPM_COMMAND: DiscordApplicationCommandDefinition = {
  name: "opm",
  description: "Interact with Open Project Manager boards and cards",
  type: 1,
  options: [
    {
      name: "help",
      description: "Show available /opm commands",
      type: 1,
    },
    {
      name: "link",
      description: "Link your Discord account to your Open Project Manager account",
      type: 1,
      options: [
        {
          name: "token",
          description: "Short-lived link code (from POST /api/v1/integrations/discord/link-code) or API token",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "whoami",
      description: "Check which OPM account is linked to your Discord user",
      type: 1,
    },
    {
      name: "unlink",
      description: "Unlink your Discord account from Open Project Manager",
      type: 1,
    },
    {
      name: "list",
      description: "List open cards in a project grouped by column",
      type: 1,
      options: [
        {
          name: "key",
          description: "Project key or owner/key (e.g. ENG or alice/ENG)",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "columns",
      description: "List columns in a project",
      type: 1,
      options: [
        {
          name: "key",
          description: "Project key or owner/key (e.g. ENG or alice/ENG)",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "get",
      description: "Inspect a card's status, priority, points, and assignees",
      type: 1,
      options: [
        {
          name: "identifier",
          description: "Card identifier or owner/identifier (e.g. ENG-12 or alice/ENG-12)",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "move",
      description: "Move a card to a different column",
      type: 1,
      options: [
        {
          name: "identifier",
          description: "Card identifier or owner/identifier (e.g. ENG-12)",
          type: 3,
          required: true,
        },
        {
          name: "column",
          description: "Destination column name or ID",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "create",
      description: "Create a card in a specific project",
      type: 1,
      options: [
        {
          name: "key",
          description: "Project key or owner/key (e.g. ENG or alice/ENG)",
          type: 3,
          required: true,
        },
        {
          name: "title",
          description: "Card title",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "new",
      description: "Quick-create a card in your default active writable project",
      type: 1,
      options: [
        {
          name: "title",
          description: "Card title",
          type: 3,
          required: true,
        },
      ],
    },
  ],
};

export interface RegisterDiscordCommandsOptions {
  applicationId: string;
  botToken: string;
  guildId?: string;
  fetchFn?: typeof fetch;
}

const SNOWFLAKE_RE = /^\d{1,30}$/;

/**
 * Registers the `/opm` Discord application command globally or for a single guild
 * via Discord's REST API using `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID`.
 */
export async function registerDiscordCommands(options: RegisterDiscordCommandsOptions) {
  const applicationId = options.applicationId.trim();
  const botToken = options.botToken.trim();
  const guildId = options.guildId?.trim() || undefined;
  const fetchImpl = options.fetchFn || fetch;

  if (!SNOWFLAKE_RE.test(applicationId)) {
    throw new Error("Invalid DISCORD_APPLICATION_ID (expected numeric Discord snowflake ID).");
  }
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN is required to register Discord slash commands.");
  }
  if (guildId && !SNOWFLAKE_RE.test(guildId)) {
    throw new Error("Invalid DISCORD_GUILD_ID (expected numeric Discord snowflake ID).");
  }

  const endpoint = guildId
    ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${applicationId}/commands`;

  const response = await fetchImpl(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([DISCORD_OPM_COMMAND]),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Discord command registration failed (${response.status}): ${errorBody}`);
  }

  return (await response.json()) as unknown;
}
