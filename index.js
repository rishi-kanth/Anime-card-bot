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
  StringSelectMenuBuilder
} = require("discord.js");

const { pool, initDatabase } = require("./database");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const pendingBattles = new Map();
const pendingTrades = new Map();
const cardCollectionSessions = new Map();

const CARD_LIMIT = 10;

const categories = {
  common: 1,
  rare: 2,
  legendary: 3,
  mythic: 4,
  divine: 5
};

const commands = [
  new SlashCommandBuilder()
    .setName("addcard")
    .setDescription("Add anime cards")
    .addStringOption(option =>
      option.setName("category")
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
      option.setName("character_name")
        .setDescription("Character name")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("anime_name")
        .setDescription("Anime name")
        .setRequired(true)
    )
    .addAttachmentOption(option =>
      option.setName("image1").setDescription("Card image 1").setRequired(true)
    )
    .addAttachmentOption(option =>
      option.setName("image2").setDescription("Card image 2").setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName("image3").setDescription("Card image 3").setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName("image4").setDescription("Card image 4").setRequired(false)
    )
    .addAttachmentOption(option =>
      option.setName("image5").setDescription("Card image 5").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("removecard")
    .setDescription("Remove card by character name")
    .addStringOption(option =>
      option.setName("character_name")
        .setDescription("Character name")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("cardcollection")
    .setDescription("Show all cards stored in the bot"),

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
      option.setName("player")
        .setDescription("Player to battle")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade/give one of your cards to another user")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("User to trade with")
        .setRequired(true)
    )
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registered.");
}

async function saveCardImage(attachment) {
  if (!process.env.CARD_IMAGE_CHANNEL_ID) {
    return attachment.proxyURL || attachment.url;
  }

  const storageChannel = await client.channels.fetch(process.env.CARD_IMAGE_CHANNEL_ID);

  const sent = await storageChannel.send({
    content: `Stored card image: ${attachment.name}`,
    files: [attachment.url]
  });

  const storedAttachment = sent.attachments.first();

  return storedAttachment ? storedAttachment.url : attachment.proxyURL || attachment.url;
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

async function spawnCard(channel) {
  const card = await getRandomCard();

  if (!card) {
    return channel.send("❌ No cards are available yet.");
  }

  const embed = new EmbedBuilder()
    .setTitle("🎴 A wild anime card appeared!")
    .setDescription(
      `**Character:** ${card.character_name}\n` +
      `**Anime:** ${card.anime_name}\n` +
      `**Rank:** ${card.category.toUpperCase()}`
    )
    .setImage(card.image_url)
    .setColor("Purple");

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

async function getUserCards(userId) {
  const result = await pool.query(
    `
    SELECT user_cards.id AS user_card_id, cards.*
    FROM user_cards
    JOIN cards ON user_cards.card_id = cards.id
    WHERE user_cards.user_id = $1
    ORDER BY user_cards.obtained_at DESC
    LIMIT 25
    `,
    [userId]
  );

  return result.rows;
}

function makeCardSelect(cards, customId, placeholder) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      cards.map(card => ({
        label: card.character_name.slice(0, 100),
        description: `${card.anime_name} | ${card.category.toUpperCase()}`.slice(0, 100),
        value: String(card.user_card_id)
      }))
    );
}

async function getCardCollectionEmbed(category, page) {
  const offset = page * CARD_LIMIT;

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM cards WHERE category = $1`,
    [category]
  );

  const totalCards = Number(countResult.rows[0].count);
  const totalPages = Math.max(1, Math.ceil(totalCards / CARD_LIMIT));

  const result = await pool.query(
    `
    SELECT category, character_name, anime_name, image_url
    FROM cards
    WHERE category = $1
    ORDER BY character_name ASC
    LIMIT $2 OFFSET $3
    `,
    [category, CARD_LIMIT, offset]
  );

  let list = "No cards found.";

  if (result.rows.length > 0) {
    list = result.rows.map((card, index) => {
      const number = offset + index + 1;
      return `**${number}. ${card.character_name}** — ${card.anime_name}`;
    }).join("\n");
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎴 ${category.toUpperCase()} Cards`)
    .setDescription(list)
    .addFields(
      {
        name: "📦 Total Cards",
        value: `${totalCards}`,
        inline: true
      },
      {
        name: "📄 Page",
        value: `${page + 1}/${totalPages}`,
        inline: true
      }
    )
    .setColor("Blue")
    .setFooter({ text: "Use menu to change category • Buttons to change page" });

  if (result.rows[0]?.image_url) {
    embed.setThumbnail(result.rows[0].image_url);
  }

  return { embed, totalPages };
}

function getCardCollectionComponents(sessionId, category, page, totalPages) {
  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId(`cardCategory:${sessionId}`)
    .setPlaceholder("Choose a category")
    .addOptions(
      { label: "Common", value: "common", emoji: "⚪", default: category === "common" },
      { label: "Rare", value: "rare", emoji: "🔵", default: category === "rare" },
      { label: "Legendary", value: "legendary", emoji: "🟡", default: category === "legendary" },
      { label: "Mythic", value: "mythic", emoji: "🟣", default: category === "mythic" },
      { label: "Divine", value: "divine", emoji: "🔴", default: category === "divine" }
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cardPrev:${sessionId}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId(`cardNext:${sessionId}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page + 1 >= totalPages)
  );

  return [
    new ActionRowBuilder().addComponents(categoryMenu),
    buttons
  ];
}

client.once("ready", async () => {
  console.log(`${client.user.tag} is online.`);

  await initDatabase();
  await registerCommands();

  setInterval(async () => {
    const channel = await client.channels.fetch(process.env.SPAWN_CHANNEL_ID);
    if (channel) {
      spawnCard(channel);
    }
  }, 3 * 60 * 60 * 1000);
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

      await interaction.deferReply({ ephemeral: true });

      const category = interaction.options.getString("category");
      const characterName = interaction.options.getString("character_name");
      const animeName = interaction.options.getString("anime_name");

      const images = [];

      for (let i = 1; i <= 5; i++) {
        const image = interaction.options.getAttachment(`image${i}`);
        if (image) {
          const savedUrl = await saveCardImage(image);
          images.push(savedUrl);
        }
      }

      for (const imageUrl of images) {
        await pool.query(
          `INSERT INTO cards 
          (character_name, anime_name, category, image_url)
          VALUES ($1, $2, $3, $4)`,
          [characterName, animeName, category, imageUrl]
        );
      }

      return interaction.editReply({
        content: `✅ Added **${images.length}** card(s) successfully.`
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
          content: `❌ No card found named **${characterName}**.`,
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

    if (interaction.commandName === "cardcollection") {
      const sessionId = `${interaction.user.id}-${Date.now()}`;
      const category = "divine";
      const page = 0;

      cardCollectionSessions.set(sessionId, {
        userId: interaction.user.id,
        category,
        page
      });

      const { embed, totalPages } = await getCardCollectionEmbed(category, page);
      const components = getCardCollectionComponents(sessionId, category, page, totalPages);

      return interaction.reply({
        embeds: [embed],
        components
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
        SELECT cards.character_name, cards.anime_name, cards.category, cards.image_url
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

      const embed = new EmbedBuilder()
        .setTitle(`${interaction.user.username}'s Collection`)
        .setDescription(list)
        .setColor("Blue");

      if (result.rows[0]?.image_url) {
        embed.setThumbnail(result.rows[0].image_url);
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "battle") {
      const opponent = interaction.options.getUser("player");

      if (opponent.bot || opponent.id === interaction.user.id) {
        return interaction.reply("❌ Invalid opponent.");
      }

      const challengerCards = await getUserCards(interaction.user.id);
      const opponentCards = await getUserCards(opponent.id);

      if (challengerCards.length === 0 || opponentCards.length === 0) {
        return interaction.reply("❌ Both players need at least one card to battle.");
      }

      const battleId = `${interaction.user.id}-${opponent.id}-${Date.now()}`;

      pendingBattles.set(battleId, {
        challengerId: interaction.user.id,
        opponentId: opponent.id,
        challengerCard: null,
        opponentCard: null
      });

      const embed = new EmbedBuilder()
        .setTitle("⚔️ Battle Request")
        .setDescription(`${interaction.user} challenged ${opponent} to a battle!`)
        .setColor("Red");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`battleAccept:${battleId}`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`battleReject:${battleId}`)
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row]
      });
    }

    if (interaction.commandName === "trade") {
      const receiver = interaction.options.getUser("user");

      if (receiver.bot || receiver.id === interaction.user.id) {
        return interaction.reply({
          content: "❌ Invalid trade user.",
          ephemeral: true
        });
      }

      const senderCards = await getUserCards(interaction.user.id);

      if (senderCards.length === 0) {
        return interaction.reply({
          content: "❌ You have no cards to trade.",
          ephemeral: true
        });
      }

      const tradeId = `${interaction.user.id}-${receiver.id}-${Date.now()}`;

      pendingTrades.set(tradeId, {
        senderId: interaction.user.id,
        receiverId: receiver.id,
        selectedCard: null
      });

      const embed = new EmbedBuilder()
        .setTitle("🤝 Trade Started")
        .setDescription(
          `${interaction.user}, select the card you want to offer.\n\n` +
          `${receiver} can accept or reject after you select.`
        )
        .setColor("Green");

      const menu = makeCardSelect(
        senderCards,
        `tradeSelect:${tradeId}:${interaction.user.id}`,
        "Select a card to trade"
      );

      return interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)]
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

      return interaction.update({
        content: `✅ ${interaction.user} claimed the card!`,
        components: [disabledRow]
      });
    }

    if (interaction.customId.startsWith("tradeReject:")) {
      const tradeId = interaction.customId.split(":")[1];
      const trade = pendingTrades.get(tradeId);

      if (!trade) {
        return interaction.reply({
          content: "❌ This trade expired.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== trade.receiverId) {
        return interaction.reply({
          content: "❌ Only the receiver can reject this trade.",
          ephemeral: true
        });
      }

      pendingTrades.delete(tradeId);

      return interaction.update({
        content: "❌ Trade rejected.",
        embeds: [],
        components: []
      });
    }

    if (interaction.customId.startsWith("tradeAccept:")) {
      const tradeId = interaction.customId.split(":")[1];
      const trade = pendingTrades.get(tradeId);

      if (!trade) {
        return interaction.reply({
          content: "❌ This trade expired.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== trade.receiverId) {
        return interaction.reply({
          content: "❌ Only the receiver can accept this trade.",
          ephemeral: true
        });
      }

      if (!trade.selectedCard) {
        return interaction.reply({
          content: "❌ Sender has not selected a card yet.",
          ephemeral: true
        });
      }

      const check = await pool.query(
        `
        SELECT user_cards.id, cards.character_name, cards.anime_name, cards.category
        FROM user_cards
        JOIN cards ON user_cards.card_id = cards.id
        WHERE user_cards.id = $1 AND user_cards.user_id = $2
        `,
        [trade.selectedCard.user_card_id, trade.senderId]
      );

      if (check.rows.length === 0) {
        pendingTrades.delete(tradeId);

        return interaction.update({
          content: "❌ Trade failed. The sender no longer owns this card.",
          embeds: [],
          components: []
        });
      }

      const card = check.rows[0];

      await pool.query(
        `UPDATE user_cards SET user_id = $1 WHERE id = $2`,
        [trade.receiverId, trade.selectedCard.user_card_id]
      );

      pendingTrades.delete(tradeId);

      const embed = new EmbedBuilder()
        .setTitle("✅ Trade Complete")
        .setDescription(
          `<@${trade.senderId}> traded **${card.character_name}** from **${card.anime_name}** to <@${trade.receiverId}>.\n` +
          `Rank: **${card.category.toUpperCase()}**`
        )
        .setColor("Green");

      return interaction.update({
        embeds: [embed],
        components: []
      });
    }

    if (interaction.customId.startsWith("cardPrev:") || interaction.customId.startsWith("cardNext:")) {
      const sessionId = interaction.customId.split(":")[1];
      const session = cardCollectionSessions.get(sessionId);

      if (!session) {
        return interaction.reply({
          content: "❌ This card collection menu expired.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== session.userId) {
        return interaction.reply({
          content: "❌ This menu is not for you.",
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith("cardPrev:")) {
        session.page = Math.max(0, session.page - 1);
      }

      if (interaction.customId.startsWith("cardNext:")) {
        session.page += 1;
      }

      const fixed = await getCardCollectionEmbed(session.category, session.page);

      if (session.page >= fixed.totalPages) {
        session.page = fixed.totalPages - 1;
      }

      cardCollectionSessions.set(sessionId, session);

      const finalData = await getCardCollectionEmbed(session.category, session.page);
      const components = getCardCollectionComponents(
        sessionId,
        session.category,
        session.page,
        finalData.totalPages
      );

      return interaction.update({
        embeds: [finalData.embed],
        components
      });
    }

    if (interaction.customId.startsWith("battleReject:")) {
      const battleId = interaction.customId.split(":")[1];
      const battle = pendingBattles.get(battleId);

      if (!battle) {
        return interaction.reply({
          content: "❌ This battle expired.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== battle.opponentId) {
        return interaction.reply({
          content: "❌ Only the challenged player can reject.",
          ephemeral: true
        });
      }

      pendingBattles.delete(battleId);

      return interaction.update({
        content: "❌ Battle rejected.",
        embeds: [],
        components: []
      });
    }

    if (interaction.customId.startsWith("battleAccept:")) {
      const battleId = interaction.customId.split(":")[1];
      const battle = pendingBattles.get(battleId);

      if (!battle) {
        return interaction.reply({
          content: "❌ This battle expired.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== battle.opponentId) {
        return interaction.reply({
          content: "❌ Only the challenged player can accept.",
          ephemeral: true
        });
      }

      const challengerCards = await getUserCards(battle.challengerId);
      const opponentCards = await getUserCards(battle.opponentId);

      const challengerMenu = makeCardSelect(
        challengerCards,
        `selectcard:${battleId}:${battle.challengerId}`,
        "Challenger: choose your card"
      );

      const opponentMenu = makeCardSelect(
        opponentCards,
        `selectcard:${battleId}:${battle.opponentId}`,
        "Opponent: choose your card"
      );

      return interaction.update({
        content: `⚔️ Battle accepted!\n<@${battle.challengerId}> and <@${battle.opponentId}>, choose your cards.`,
        embeds: [],
        components: [
          new ActionRowBuilder().addComponents(challengerMenu),
          new ActionRowBuilder().addComponents(opponentMenu)
        ]
      });
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith("tradeSelect:")) {
      const parts = interaction.customId.split(":");
      const tradeId = parts[1];
      const allowedUserId = parts[2];

      if (interaction.user.id !== allowedUserId) {
        return interaction.reply({
          content: "❌ This trade menu is not for you.",
          ephemeral: true
        });
      }

      const trade = pendingTrades.get(tradeId);

      if (!trade) {
        return interaction.reply({
          content: "❌ This trade expired.",
          ephemeral: true
        });
      }

      const userCardId = interaction.values[0];

      const cardResult = await pool.query(
        `
        SELECT user_cards.id AS user_card_id, cards.*
        FROM user_cards
        JOIN cards ON user_cards.card_id = cards.id
        WHERE user_cards.id = $1 AND user_cards.user_id = $2
        `,
        [userCardId, interaction.user.id]
      );

      if (cardResult.rows.length === 0) {
        return interaction.reply({
          content: "❌ Card not found.",
          ephemeral: true
        });
      }

      const card = cardResult.rows[0];

      trade.selectedCard = card;
      pendingTrades.set(tradeId, trade);

      const embed = new EmbedBuilder()
        .setTitle("🤝 Trade Offer")
        .setDescription(
          `<@${trade.senderId}> is offering:\n\n` +
          `**${card.character_name}**\n` +
          `Anime: **${card.anime_name}**\n` +
          `Rank: **${card.category.toUpperCase()}**\n\n` +
          `<@${trade.receiverId}>, accept or reject this trade.`
        )
        .setImage(card.image_url)
        .setColor("Green");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`tradeAccept:${tradeId}`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`tradeReject:${tradeId}`)
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.update({
        embeds: [embed],
        components: [row]
      });
    }

    if (interaction.customId.startsWith("cardCategory:")) {
      const sessionId = interaction.customId.split(":")[1];
      const session = cardCollectionSessions.get(sessionId);

      if (!session) {
        return interaction.reply({
          content: "❌ This card collection menu expired.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== session.userId) {
        return interaction.reply({
          content: "❌ This menu is not for you.",
          ephemeral: true
        });
      }

      session.category = interaction.values[0];
      session.page = 0;

      cardCollectionSessions.set(sessionId, session);

      const { embed, totalPages } = await getCardCollectionEmbed(session.category, session.page);
      const components = getCardCollectionComponents(
        sessionId,
        session.category,
        session.page,
        totalPages
      );

      return interaction.update({
        embeds: [embed],
        components
      });
    }

    if (interaction.customId.startsWith("selectcard:")) {
      const parts = interaction.customId.split(":");
      const battleId = parts[1];
      const allowedUserId = parts[2];

      if (interaction.user.id !== allowedUserId) {
        return interaction.reply({
          content: "❌ This card menu is not for you.",
          ephemeral: true
        });
      }

      const battle = pendingBattles.get(battleId);

      if (!battle) {
        return interaction.reply({
          content: "❌ This battle expired.",
          ephemeral: true
        });
      }

      const userCardId = interaction.values[0];

      const cardResult = await pool.query(
        `
        SELECT user_cards.id AS user_card_id, cards.*
        FROM user_cards
        JOIN cards ON user_cards.card_id = cards.id
        WHERE user_cards.id = $1 AND user_cards.user_id = $2
        `,
        [userCardId, interaction.user.id]
      );

      if (cardResult.rows.length === 0) {
        return interaction.reply({
          content: "❌ Card not found.",
          ephemeral: true
        });
      }

      const selectedCard = cardResult.rows[0];

      if (interaction.user.id === battle.challengerId) {
        battle.challengerCard = selectedCard;
      }

      if (interaction.user.id === battle.opponentId) {
        battle.opponentCard = selectedCard;
      }

      pendingBattles.set(battleId, battle);

      await interaction.reply({
        content: `✅ You selected **${selectedCard.character_name}**.`,
        ephemeral: true
      });

      if (battle.challengerCard && battle.opponentCard) {
        const challengerPower = categories[battle.challengerCard.category];
        const opponentPower = categories[battle.opponentCard.category];

        let winner;

        if (challengerPower > opponentPower) {
          winner = `<@${battle.challengerId}>`;
        } else if (opponentPower > challengerPower) {
          winner = `<@${battle.opponentId}>`;
        } else {
          winner = Math.random() < 0.5
            ? `<@${battle.challengerId}>`
            : `<@${battle.opponentId}>`;
        }

        const resultEmbed = new EmbedBuilder()
          .setTitle("⚔️ Battle Result")
          .setDescription(
            `<@${battle.challengerId}> used **${battle.challengerCard.character_name}** | **${battle.challengerCard.category.toUpperCase()}**\n\n` +
            `<@${battle.opponentId}> used **${battle.opponentCard.character_name}** | **${battle.opponentCard.category.toUpperCase()}**\n\n` +
            `🏆 Winner: ${winner}`
          )
          .setColor("Purple");

        if (battle.challengerCard.image_url) {
          resultEmbed.setThumbnail(battle.challengerCard.image_url);
        }

        pendingBattles.delete(battleId);

        await interaction.channel.send({
          embeds: [resultEmbed]
        });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);