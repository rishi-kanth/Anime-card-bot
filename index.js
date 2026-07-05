require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const { pool, initDatabase } = require("./database");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const categories = {
  common: 1,
  rare: 2,
  legendary: 3,
  mythic: 4,
  divine: 5
};

const commands = [
  new SlashCommandBuilder()
  .setName("removecard")
  .setDescription("Remove an anime card by character name")
  .addStringOption(option =>
    option
      .setName("character_name")
      .setDescription("Character name to remove")
      .setRequired(true)
  ),
  new SlashCommandBuilder()
    .setName("addcard")
    .setDescription("Add anime cards")
    .addStringOption(option =>
      option
        .setName("category")
        .setDescription("Card category")
        .setRequired(true)
        .addChoices(
          { name: "Common", value: "common" },
          { name: "Rare", value: "rare" },
          { name: "Legendary", value: "legendary" },
          { name: "Mythic", value: "mythic" },
          { name: "Divine", value: "divine" }
        )
    )
    .addStringOption(option =>
      option
        .setName("character_name")
        .setDescription("Character name")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("anime_name")
        .setDescription("Anime name")
        .setRequired(true)
    )
    .addAttachmentOption(option =>
      option
        .setName("image1")
        .setDescription("Card image 1")
        .setRequired(true)
    )
    .addAttachmentOption(option =>
      option
        .setName("image2")
        .setDescription("Card image 2")
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName("image3")
        .setDescription("Card image 3")
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName("image4")
        .setDescription("Card image 4")
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName("image5")
        .setDescription("Card image 5")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("crate")
    .setDescription("Open your daily crate"),

  new SlashCommandBuilder()
    .setName("collection")
    .setDescription("View your anime card collection"),

  new SlashCommandBuilder()
    .setName("battle")
    .setDescription("Battle another player")
    .addUserOption(option =>
      option
        .setName("player")
        .setDescription("Player to battle")
        .setRequired(true)
    )
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("Slash commands registered.");
}

async function getRandomCard() {
  const result = await pool.query(`
    SELECT * FROM cards
    ORDER BY RANDOM()
    LIMIT 1
  `);

  return result.rows[0];
}

async function giveCard(userId, cardId) {
  await pool.query(
    `INSERT INTO user_cards (user_id, card_id, obtained_at)
     VALUES ($1, $2, $3)`,
    [userId, cardId, Date.now()]
  );
}

async function spawnCard() {
  const channel = await client.channels.fetch(process.env.SPAWN_CHANNEL_ID);
  if (!channel) return;

  const card = await getRandomCard();

  if (!card) {
    console.log("No cards found.");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🎴 A wild anime card appeared!")
    .setDescription(
      `**Character:** ${card.character_name}\n` +
      `**Anime:** ${card.anime_name}\n` +
      `**Rank:** ${card.category.toUpperCase()}`
    )
    .setImage(card.image_url)
    .setColor("Random");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_${card.id}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({
    embeds: [embed],
    components: [row]
  });
}

client.once("ready", async () => {
  console.log(`${client.user.tag} is online.`);

  await initDatabase();
  await registerCommands();

  setInterval(spawnCard, 3 * 60 * 60 * 1000);
});

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "addcard") {
      const member = interaction.member;

      if (!member.roles.cache.has(process.env.UPLOAD_ROLE_ID)) {
        return interaction.reply({
          content: "❌ You do not have permission to add cards.",
          ephemeral: true
        });
      }

      const category = interaction.options.getString("category");
      const characterName = interaction.options.getString("character_name");
      const animeName = interaction.options.getString("anime_name");

      const images = [];

      for (let i = 1; i <= 5; i++) {
        const image = interaction.options.getAttachment(`image${i}`);
        if (image) images.push(image.url);
      }

      for (const imageUrl of images) {
        await pool.query(
          `INSERT INTO cards 
          (character_name, anime_name, category, image_url)
          VALUES ($1, $2, $3, $4)`,
          [characterName, animeName, category, imageUrl]
        );
      }

      return interaction.reply({
        content: `✅ Added **${images.length}** card(s) successfully.`,
        ephemeral: true
      });
    }

    if (interaction.commandName === "removecard") {
      const member = interaction.member;

      if (!member.roles.cache.has(process.env.UPLOAD_ROLE_ID)) {
        return interaction.reply({
          content: "❌ You do not have permission to remove cards.",
          ephemeral: true
        });
      }

      const characterName = interaction.options.getString("character_name");

      const result = await pool.query(
        `SELECT * FROM cards WHERE LOWER(character_name) = LOWER($1)`,
        [characterName]
      );

      if (result.rows.length === 0) {
        return interaction.reply({
          content: `❌ No card found with name **${characterName}**.`,
          ephemeral: true
        });
      }

      await pool.query(
        `DELETE FROM user_cards 
         WHERE card_id IN (
           SELECT id FROM cards WHERE LOWER(character_name) = LOWER($1)
         )`,
        [characterName]
      );

      await pool.query(
        `DELETE FROM cards WHERE LOWER(character_name) = LOWER($1)`,
        [characterName]
      );

      return interaction.reply({
        content: `✅ Removed **${result.rows.length}** card(s) named **${characterName}**.`,
        ephemeral: true
      });
    }

    if (interaction.commandName === "crate") {
      const userId = interaction.user.id;
      const now = Date.now();
      const cooldown = 24 * 60 * 60 * 1000;

      const cooldownResult = await pool.query(
        `SELECT last_crate FROM cooldowns WHERE user_id = $1`,
        [userId]
      );

      if (cooldownResult.rows.length > 0) {
        const lastCrate = Number(cooldownResult.rows[0].last_crate);

        if (now - lastCrate < cooldown) {
          const remaining = cooldown - (now - lastCrate);
          const hours = Math.ceil(remaining / 1000 / 60 / 60);

          return interaction.reply({
            content: `⏳ You can open your next crate in **${hours} hour(s)**.`,
            ephemeral: true
          });
        }
      }

      const card = await getRandomCard();

      if (!card) {
        return interaction.reply("❌ No cards are available yet.");
      }

      await giveCard(userId, card.id);

      await pool.query(
        `INSERT INTO cooldowns (user_id, last_crate)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET last_crate = $2`,
        [userId, now]
      );

      const embed = new EmbedBuilder()
        .setTitle("🎁 Daily Crate Opened!")
        .setDescription(
          `You got **${card.character_name}** from **${card.anime_name}**!\n` +
          `Rank: **${card.category.toUpperCase()}**`
        )
        .setImage(card.image_url)
        .setColor("Gold");

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "collection") {
      const result = await pool.query(
        `
        SELECT cards.character_name, cards.anime_name, cards.category
        FROM user_cards
        JOIN cards ON user_cards.card_id = cards.id
        WHERE user_cards.user_id = $1
        ORDER BY user_cards.obtained_at DESC
        LIMIT 20
        `,
        [interaction.user.id]
      );

      if (result.rows.length === 0) {
        return interaction.reply("You have no cards yet.");
      }

      const list = result.rows
        .map(
          (card, index) =>
            `**${index + 1}.** ${card.character_name} — ${card.anime_name} | **${card.category.toUpperCase()}**`
        )
        .join("\n");

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Collection`)
            .setDescription(list)
            .setColor("Blue")
        ]
      });
    }

    if (interaction.commandName === "battle") {
      const opponent = interaction.options.getUser("player");

      if (opponent.bot) {
        return interaction.reply("❌ You cannot battle bots.");
      }

      if (opponent.id === interaction.user.id) {
        return interaction.reply("❌ You cannot battle yourself.");
      }

      const embed = new EmbedBuilder()
        .setTitle("⚔️ Battle Request")
        .setDescription(
          `${interaction.user} challenged ${opponent} to a card battle!`
        )
        .setColor("Red");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`battle_accept_${interaction.user.id}_${opponent.id}`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`battle_reject_${interaction.user.id}_${opponent.id}`)
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row]
      });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("claim_")) {
      const cardId = interaction.customId.split("_")[1];

      await giveCard(interaction.user.id, cardId);

      const disabledRow = new ActionRowBuilder().addComponents(
        ButtonBuilder.from(interaction.component).setDisabled(true)
      );

      await interaction.update({
        content: `✅ ${interaction.user} claimed the card!`,
        components: [disabledRow]
      });
    }

    if (interaction.customId.startsWith("battle_accept_")) {
      const [, , challengerId, opponentId] = interaction.customId.split("_");

      if (interaction.user.id !== opponentId) {
        return interaction.reply({
          content: "❌ Only the challenged player can accept this battle.",
          ephemeral: true
        });
      }

      const challengerCardResult = await pool.query(
        `
        SELECT cards.*
        FROM user_cards
        JOIN cards ON user_cards.card_id = cards.id
        WHERE user_cards.user_id = $1
        ORDER BY RANDOM()
        LIMIT 1
        `,
        [challengerId]
      );

      const opponentCardResult = await pool.query(
        `
        SELECT cards.*
        FROM user_cards
        JOIN cards ON user_cards.card_id = cards.id
        WHERE user_cards.user_id = $1
        ORDER BY RANDOM()
        LIMIT 1
        `,
        [opponentId]
      );

      if (
        challengerCardResult.rows.length === 0 ||
        opponentCardResult.rows.length === 0
      ) {
        return interaction.update({
          content: "❌ Both players need at least one card to battle.",
          embeds: [],
          components: []
        });
      }

      const challengerCard = challengerCardResult.rows[0];
      const opponentCard = opponentCardResult.rows[0];

      const challengerPower = categories[challengerCard.category];
      const opponentPower = categories[opponentCard.category];

      let winner;

      if (challengerPower > opponentPower) {
        winner = `<@${challengerId}>`;
      } else if (opponentPower > challengerPower) {
        winner = `<@${opponentId}>`;
      } else {
        winner = Math.random() < 0.5 ? `<@${challengerId}>` : `<@${opponentId}>`;
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle("⚔️ Battle Result")
        .setDescription(
          `<@${challengerId}> used **${challengerCard.character_name}** | **${challengerCard.category.toUpperCase()}**\n\n` +
          `<@${opponentId}> used **${opponentCard.character_name}** | **${opponentCard.category.toUpperCase()}**\n\n` +
          `🏆 Winner: ${winner}`
        )
        .setColor("Purple");

      return interaction.update({
        embeds: [resultEmbed],
        components: []
      });
    }

    if (interaction.customId.startsWith("battle_reject_")) {
      const [, , challengerId, opponentId] = interaction.customId.split("_");

      if (interaction.user.id !== opponentId) {
        return interaction.reply({
          content: "❌ Only the challenged player can reject this battle.",
          ephemeral: true
        });
      }

      return interaction.update({
        content: `❌ <@${opponentId}> rejected the battle.`,
        embeds: [],
        components: []
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);