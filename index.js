const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");
const axios = require("axios");

const envFiles = [path.join(__dirname, ".env"), path.join(__dirname, ".env.example")];
for (const envPath of envFiles) {
  dotenv.config({ path: envPath });
}

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  AuditLogEvent,
  ActivityType,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const SUPPORT_GUILD_ID = process.env.SUPPORT_GUILD_ID || "1464018120481177742";
const ROLE_IDS_SEARCH = [
  "1379972407086809190",
  "1523476151736205342",
  "1501033763826565150",
  "1523476507702464532",
  "1525314032545042644",
  "1529634944857411665",
  "1510015110796677160",
];
const ROLE_IDS_BANGLOBAL = [
  "1501033763826565150",
  "1523476507702464532",
  "1525314032545042644",
  "1529634944857411665",
  "1510015110796677160",
];
const PREFIX = ".";
const SUSPICIOUS_BOT_COMMANDS = [".sexo"];
const SUSPICIOUS_BOT_TERMS = [
  "nitro",
  "gift",
  "giveaway",
  "invite",
  "discord",
  "boost",
  "premium",
  "free",
  "owner",
  "hack",
  "raid",
  "sex",
  "xxx",
  "porn",
  "token",
  "verify",
  "claim",
  "secure",
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User],
});

const DATA_DIR = path.join(__dirname, "data");
const BANS_FILE = path.join(DATA_DIR, "bans.json");
const EVIDENCE_FILE = path.join(DATA_DIR, "evidence.json");
const WARNS_FILE = path.join(DATA_DIR, "warns.json");
const TEMPBANS_FILE = path.join(DATA_DIR, "tempbans.json");
const PROTECTION_FILE = path.join(DATA_DIR, "protection.json");

const state = {
  joinTimestamps: new Map(),
  messageTimestamps: new Map(),
  suspiciousActions: new Map(),
  raidModeGuilds: new Set(),
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(BANS_FILE)) {
    fs.writeFileSync(BANS_FILE, JSON.stringify({ bannedUsers: [] }, null, 2));
  }

  if (!fs.existsSync(EVIDENCE_FILE)) {
    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify({ evidence: [] }, null, 2));
  }

  if (!fs.existsSync(WARNS_FILE)) {
    fs.writeFileSync(WARNS_FILE, JSON.stringify({ warns: [] }, null, 2));
  }

  if (!fs.existsSync(TEMPBANS_FILE)) {
    fs.writeFileSync(TEMPBANS_FILE, JSON.stringify({ tempBans: [] }, null, 2));
  }

  if (!fs.existsSync(PROTECTION_FILE)) {
    fs.writeFileSync(PROTECTION_FILE, JSON.stringify({ protections: {} }, null, 2));
  }
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getWarnsData() {
  const data = loadJson(WARNS_FILE);
  return data.warns || [];
}

function saveWarnsData(warns) {
  saveJson(WARNS_FILE, { warns });
}

function isSuspiciousBotUser(user) {
  const username = user.username.toLowerCase();
  if (SUSPICIOUS_BOT_TERMS.some((term) => username.includes(term))) {
    return true;
  }

  const accountAgeMs = Date.now() - user.createdTimestamp;
  return accountAgeMs < 7 * 24 * 60 * 60 * 1000;
}

function getTempBansData() {
  const data = loadJson(TEMPBANS_FILE);
  return data.tempBans || [];
}

function saveTempBansData(tempBans) {
  saveJson(TEMPBANS_FILE, { tempBans });
}

function parseDuration(durationString) {
  if (!durationString) return 0;
  const match = durationString.trim().match(/^(\d+)([smhd])?$/i);
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase() || "s";

  switch (unit) {
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "m":
      return value * 60 * 1000;
    case "s":
    default:
      return value * 1000;
  }
}

function getProtectionData() {
  const data = loadJson(PROTECTION_FILE);
  return data.protections || {};
}

function saveProtectionData(protections) {
  saveJson(PROTECTION_FILE, { protections });
}

function getGuildProtectionSettings(guildId) {
  const protections = getProtectionData();
  return {
    antiRaid: true,
    antiNuke: true,
    antiLinks: true,
    antiBots: true,
    antiFlood: true,
    welcomeMessageEnabled: true,
    welcomeChannelId: "",
    welcomeMessageTemplate: "🎉 el usuario [usermention] se entro al servidor [server]",
    ticketRoleId: "",
    ticketCategoryId: "",
    ...protections[guildId],
  };
}

function setGuildProtectionSettings(guildId, settings) {
  const protections = getProtectionData();
  protections[guildId] = settings;
  saveProtectionData(protections);
}

function scheduleTempBans() {
  setInterval(async () => {
    const now = Date.now();
    const tempBans = getTempBansData();
    const expired = tempBans.filter((entry) => entry.expiresAt <= now);
    const active = tempBans.filter((entry) => entry.expiresAt > now);

    if (expired.length > 0) {
      saveTempBansData(active);
      for (const entry of expired) {
        try {
          const guild = await client.guilds.fetch(entry.guildId);
          if (!guild) continue;
          await guild.bans.remove(entry.userId, "Baneo temporal expirado").catch(() => {});
          await sendLog(guild, `♻️ Se desbanó temporalmente a <@${entry.userId}> porque expiró el bantemp.`, 0x57F287);
        } catch {}
      }
    }
  }, 60 * 1000);
}

function getGuildActionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getBansData() {
  const data = loadJson(BANS_FILE);
  return data.bannedUsers || [];
}

function saveBansData(bannedUsers) {
  saveJson(BANS_FILE, { bannedUsers });
}

function getEvidenceData() {
  const data = loadJson(EVIDENCE_FILE);
  return data.evidence || [];
}

function saveEvidenceData(evidence) {
  saveJson(EVIDENCE_FILE, { evidence });
}

function getBanStatus(userId) {
  const bannedUsers = getBansData();
  const entry = bannedUsers.find((item) => item.userId === userId);
  return {
    isBanned: Boolean(entry),
    entry,
  };
}

function addGlobalBan(userId, userTag) {
  const bannedUsers = getBansData();
  if (bannedUsers.some((item) => item.userId === userId)) {
    return false;
  }

  bannedUsers.push({
    userId,
    userTag,
    bannedAt: new Date().toISOString(),
  });
  saveBansData(bannedUsers);
  return true;
}

function addEvidence(userId, moderatorId, reason) {
  const evidence = getEvidenceData();
  evidence.push({
    userId,
    moderatorId,
    reason,
    createdAt: new Date().toISOString(),
  });
  saveEvidenceData(evidence);
}

function addWarn(userId, guildId, moderatorId, reason) {
  const warns = getWarnsData();
  warns.push({
    userId,
    guildId,
    moderatorId,
    reason,
    createdAt: new Date().toISOString(),
  });
  saveWarnsData(warns);
  return warns.filter((warn) => warn.userId === userId && warn.guildId === guildId).length;
}

function removeWarn(userId, guildId) {
  const warns = getWarnsData();
  const remaining = warns.filter((warn) => !(warn.userId === userId && warn.guildId === guildId));
  saveWarnsData(remaining);
  return remaining.filter((warn) => warn.userId === userId && warn.guildId === guildId).length;
}

function getWarnCount(userId, guildId) {
  return getWarnsData().filter((warn) => warn.userId === userId && warn.guildId === guildId).length;
}

function addTempBan(userId, guildId, moderatorId, reason, durationMs) {
  const tempBans = getTempBansData();
  const expiresAt = Date.now() + durationMs;
  tempBans.push({
    userId,
    guildId,
    moderatorId,
    reason,
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  saveTempBansData(tempBans);
}

function isSupportGuild(guild) {
  return guild?.id === SUPPORT_GUILD_ID;
}

function formatSearchField(targetUser, userId, banStatus) {
  return {
    fields: [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "No encontrado"}`, inline: true },
      { name: "ID", value: userId || "Sin ID", inline: true },
      { name: "Estado", value: banStatus.isBanned ? `<a:global:1531047167777833042> Usuario baneado globalmente` : `<a:Online:1530014889501003846> Sin amenazas detectadas`, inline: true },
    ],
  };
}

async function sendLog(guild, description, color = 0xFEE75C) {
  const embed = new EmbedBuilder().setColor(color).setDescription(description);
  const channelId = process.env.LOG_CHANNEL_ID;

  if (channelId && guild.id === SUPPORT_GUILD_ID) {
    try {
      const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId));
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [embed] });
        return;
      }
    } catch (error) {
      console.error("No se pudo enviar el log al canal de soporte:", error);
    }
  }

  try {
    const fallback = guild.systemChannel?.isTextBased() ? guild.systemChannel : guild.channels.cache.find((c) => c.isTextBased() && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages));
    if (fallback?.isTextBased()) {
      await fallback.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error("No se pudo enviar el log en el servidor:", error);
  }
}

function isStaff(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.some((role) => ["staff", "mod", "moderador", "admin", "owner"].includes(role.name.toLowerCase()))
  );
}

function containsLink(text) {
  return /(https?:\/\/|discord\.gg|discord\.com\/invite|www\.)/i.test(text);
}

async function getRecentAuditExecutor(guild, event) {
  try {
    const logs = await guild.fetchAuditLogs({ type: event, limit: 1 });
    return logs.entries.first()?.executor || null;
  } catch {
    return null;
  }
}

async function trackSuspiciousAction(guild, userId, actionName) {
  if (!userId || !guild) return;

  const key = getGuildActionKey(guild.id, userId);
  const history = state.suspiciousActions.get(key) || [];
  history.push(Date.now());
  const recentHistory = history.filter((timestamp) => Date.now() - timestamp < 20000);
  state.suspiciousActions.set(key, recentHistory);

  if (recentHistory.length >= 4) {
    state.raidModeGuilds.add(guild.id);
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && !member.permissions.has(PermissionFlagsBits.Administrator)) {
        await guild.members.ban(userId, { reason: `Actividad sospechosa detectada (${actionName})` }).catch(() => {});
      }
    } catch {}

    await sendLog(guild, `🚨 Actividad sospechosa detectada en ${actionName}. Se aplicó una acción de seguridad.`, 0xED4245);
  }
}

function updatePresence() {
  const guildCount = client.guilds.cache.size;
  client.user.setPresence({
    activities: [{ name: `${guildCount} servidores`, type: ActivityType.Watching }],
    status: "online",
  });
}

client.once("ready", async () => {
  ensureDataFiles();
  scheduleTempBans();
  const supportGuild = client.guilds.cache.get(SUPPORT_GUILD_ID);
  if (!supportGuild) {
    console.log(`⚠️ El servidor de soporte ${SUPPORT_GUILD_ID} no está disponible para el bot todavía.`);
  }
  updatePresence();
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`📍 Servidores: ${client.guilds.cache.size}`);
});

client.on("guildCreate", () => {
  updatePresence();
});

client.on("guildDelete", () => {
  updatePresence();
});

client.on("guildMemberAdd", async (member) => {
  const banStatus = getBanStatus(member.id);
  if (banStatus.isBanned) {
    await member.guild.members.ban(member.id, { reason: "Usuario baneado globalmente" }).catch(() => {});
    await sendLog(member.guild, `🛑 Se expulsó a ${member.user.tag} porque estaba baneado globalmente.`, 0xED4245);
    return;
  }

  const now = Date.now();
  const guildId = member.guild.id;
  const joinHistory = state.joinTimestamps.get(guildId) || [];
  joinHistory.push(now);
  const recentJoins = joinHistory.filter((timestamp) => now - timestamp < 30000);
  state.joinTimestamps.set(guildId, recentJoins);

  const settings = getGuildProtectionSettings(guildId);

  if (recentJoins.length >= 8 && settings.antiRaid) {
    state.raidModeGuilds.add(guildId);
    await sendLog(member.guild, "🚨 Se detectó un posible raid por exceso de joins en poco tiempo.", 0xFEE75C);
  }

  if (member.user.bot && settings.antiBots) {
    const content = member.user.username.toLowerCase();
    if (
      SUSPICIOUS_BOT_COMMANDS.some((cmd) => content.includes(cmd.replace(".", "")) || content.includes(cmd)) ||
      isSuspiciousBotUser(member.user)
    ) {
      await member.guild.members.ban(member.id, { reason: "Bot malicioso detectado" }).catch(() => {});
      await sendLog(member.guild, `🤖 Se expulsó a ${member.user.tag} por ser un bot malicioso o sospechoso.`, 0xED4245);
      return;
    }
  }

  if (state.raidModeGuilds.has(guildId) && settings.antiRaid) {
    await member.timeout(10 * 60 * 1000, "Protección anti raid / anti bots").catch(() => {});
    await sendLog(member.guild, `⏱️ ${member.user.tag} fue temporalmente silenciado por protección.`, 0xFEE75C);
  }

  if (settings.welcomeMessageEnabled) {
    let welcomeChannel = null;
    if (settings.welcomeChannelId) {
      welcomeChannel = member.guild.channels.cache.get(settings.welcomeChannelId);
    }
    if (!welcomeChannel) {
      welcomeChannel = member.guild.systemChannel || member.guild.channels.cache.find((channel) => channel.isTextBased() && channel.permissionsFor(member.guild.members.me)?.has(PermissionFlagsBits.SendMessages));
    }

    if (welcomeChannel && welcomeChannel.isTextBased()) {
      const template = settings.welcomeMessageTemplate || `🎉 el usuario [usermention] se entro al servidor [server]`;
      const content = template.replace(/\[usermention\]/g, `${member.user}`).replace(/\[server\]/g, `${member.guild.name}`).replace(/\[usertag\]/g, `${member.user.tag}`);
      await welcomeChannel.send(content).catch(() => {});
    }
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const settings = getGuildProtectionSettings(message.guild.id);
  const banStatus = getBanStatus(message.author.id);
  if (banStatus.isBanned) {
    await message.delete().catch(() => {});
    await message.guild.members.ban(message.author.id, { reason: "Usuario baneado globalmente" }).catch(() => {});
    return;
  }

  const member = message.member;
  if (!member || isStaff(member)) return;

  const history = state.messageTimestamps.get(message.author.id) || [];
  const now = Date.now();
  history.push(now);
  const recentHistory = history.filter((timestamp) => now - timestamp < 8000);
  state.messageTimestamps.set(message.author.id, recentHistory);

  if (settings.antiFlood && recentHistory.length >= 8) {
    await member.timeout(5 * 60 * 1000, "Anti flood").catch(() => {});
    await message.delete().catch(() => {});
    await sendLog(message.guild, `💧 ${message.author.tag} fue silenciado por anti flood.`, 0xFEE75C);
    return;
  }

  if (settings.antiLinks && containsLink(message.content)) {
    await message.delete().catch(() => {});
    await message.channel.send(`⚠️ ${message.author}, los enlaces están prohibidos en este servidor.`).catch(() => {});
    await sendLog(message.guild, `🔗 ${message.author.tag} intentó enviar un enlace.`, 0xFEE75C);
  }
});

client.on("channelCreate", async (channel) => {
  if (!channel.guild) return;
  const settings = getGuildProtectionSettings(channel.guild.id);
  if (!settings.antiNuke && !settings.antiRaid) return;
  const executor = await getRecentAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate);
  await trackSuspiciousAction(channel.guild, executor?.id, "channelCreate");
});

client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;
  const settings = getGuildProtectionSettings(channel.guild.id);
  if (!settings.antiNuke && !settings.antiRaid) return;
  const executor = await getRecentAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete);
  await trackSuspiciousAction(channel.guild, executor?.id, "channelDelete");
});

client.on("roleCreate", async (role) => {
  if (!role.guild) return;
  const settings = getGuildProtectionSettings(role.guild.id);
  if (!settings.antiNuke && !settings.antiRaid) return;
  const executor = await getRecentAuditExecutor(role.guild, AuditLogEvent.RoleCreate);
  await trackSuspiciousAction(role.guild, executor?.id, "roleCreate");
});

client.on("roleDelete", async (role) => {
  if (!role.guild) return;
  const settings = getGuildProtectionSettings(role.guild.id);
  if (!settings.antiNuke && !settings.antiRaid) return;
  const executor = await getRecentAuditExecutor(role.guild, AuditLogEvent.RoleDelete);
  await trackSuspiciousAction(role.guild, executor?.id, "roleDelete");
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === "open_ticket") {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: "❌ Este botón solo funciona en servidores.", ephemeral: true });
        return;
      }

      const settings = getGuildProtectionSettings(guild.id);
      if (!settings.ticketRoleId || !settings.ticketCategoryId) {
        await interaction.reply({ content: "❌ El sistema de tickets no está configurado en este servidor.", ephemeral: true });
        return;
      }

      const category = guild.channels.cache.get(settings.ticketCategoryId);
      const ticketRole = guild.roles.cache.get(settings.ticketRoleId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.reply({ content: "❌ La categoría de tickets configurada ya no existe.", ephemeral: true });
        return;
      }

      const ticketName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}-${Date.now() % 10000}`;
      const permissionOverwrites = [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
      ];

      if (ticketRole) {
        permissionOverwrites.push({
          id: ticketRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }

      const ticketChannel = await guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `Ticket de ${interaction.user.tag}`,
        permissionOverwrites,
      });

      const closeButton = new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Cerrar Ticket")
        .setStyle(ButtonStyle.Danger);

      await ticketChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Ticket abierto")
            .setDescription(`Hola ${interaction.user}, un miembro del equipo de soporte te atenderá pronto.`)
            .setColor(0x5865F2)
            .addFields(
              { name: "Usuario", value: `${interaction.user}`, inline: true },
              { name: "Categoría", value: `${category.name}`, inline: true },
              { name: "Soporte", value: `${ticketRole ? `<@&${ticketRole.id}>` : "No configurado"}`, inline: false }
            ),
        ],
        components: [new ActionRowBuilder().addComponents(closeButton)],
      });

      await interaction.reply({ content: `✅ Tu ticket ha sido abierto: ${ticketChannel}`, ephemeral: true });
      return;
    }

    if (interaction.customId === "close_ticket") {
      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "❌ Este botón solo funciona dentro de un ticket.", ephemeral: true });
        return;
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: "❌ Este botón solo funciona en servidores.", ephemeral: true });
        return;
      }

      const disabledButton = new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Cerrar Ticket")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true);

      const disabledRow = new ActionRowBuilder().addComponents(disabledButton);
      let acked = false;

      try {
        if (interaction.message?.editable) {
          await interaction.deferUpdate();
          await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
          acked = true;
        } else {
          await interaction.deferReply({ ephemeral: true });
          acked = true;
        }
      } catch (error) {
        console.error("[close_ticket] interaction ack failed:", error);
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: true }).catch(() => {});
          acked = true;
        }
      }

      const user = interaction.user;

      await channel.permissionOverwrites.edit(user.id, {
        SendMessages: false,
      }).catch(() => {});

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("Ticket cerrado")
            .setDescription(`El ticket fue cerrado por ${interaction.user}. Si necesitas volver a abrirlo crea uno nuevo.`)
            .setColor(0xED4245),
        ],
      }).catch(() => {});

      if (interaction.deferred || interaction.replied || acked) {
        await interaction.followUp({ content: "✅ Ticket cerrado. Ya no podrás enviar mensajes en este canal.", ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: "✅ Ticket cerrado. Ya no podrás enviar mensajes en este canal.", ephemeral: true }).catch(() => {});
      }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const isSupport = interaction.guild?.id === SUPPORT_GUILD_ID;
  const isOwner = interaction.user.id === process.env.OWNER_ID;
  const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

  const supportOnly = ["search", "banglobal", "ban_global"];
  if (supportOnly.includes(interaction.commandName) && !isSupport) {
    await interaction.reply({ content: "⚠️ Este comando solo está disponible en el servidor de soporte.", ephemeral: true });
    return;
  }

  const publicCommands = ["help"];
  if (!isOwner && !isAdmin && !supportOnly.includes(interaction.commandName) && !publicCommands.includes(interaction.commandName)) {
    await interaction.reply({ content: "❌ No tienes permisos para usar este comando.", ephemeral: true });
    return;
  }

  const settings = interaction.guild ? getGuildProtectionSettings(interaction.guild.id) : null;
  const replyEmbed = (title, color, fields) => new EmbedBuilder().setTitle(title).setColor(color).addFields(fields);

  if (interaction.commandName === "help") {
    const botUser = client.user;
    const fields = [
      { name: "Bot", value: `${botUser.tag}`, inline: true },
      { name: "ID", value: `${botUser.id}`, inline: true },
      { name: "Servidor de ayuda", value: `securitybot.gg`, inline: true },
      { name: "Comandos principales", value: "/help, /status, /protect, /warn, /unwarn, /kick, /banperm, /bantemp, /unban, /timeout, /untimeout", inline: false },
      { name: "Comandos de soporte", value: "/search, /banglobal", inline: false },
      { name: "Protecciones", value: "antiRaid, antiNuke, antiLinks, antiBots, antiFlood", inline: false },
    ];
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("/help | scaanner.gg")
          .setDescription("Escanea bots maliciosos y expulsa a los sospechosos")
          .setColor(0x5865F2)
          .setThumbnail(botUser.displayAvatarURL({ dynamic: true }))
          .addFields(fields),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "protect") {
    if (!interaction.guild) {
      await interaction.reply({ content: "❌ Este comando solo funciona en servidores.", ephemeral: true });
      return;
    }

    let subcommand;
    try {
      subcommand = interaction.options.getSubcommand();
    } catch {
      await interaction.reply({ content: "❌ Usa /protect set o /protect status.", ephemeral: true });
      return;
    }

    if (subcommand === "status") {
      const statusFields = [
        { name: "Anti raid", value: settings.antiRaid ? "Activo" : "Desactivado", inline: true },
        { name: "Anti nuke", value: settings.antiNuke ? "Activo" : "Desactivado", inline: true },
        { name: "Anti links", value: settings.antiLinks ? "Activo" : "Desactivado", inline: true },
        { name: "Anti bots", value: settings.antiBots ? "Activo" : "Desactivado", inline: true },
        { name: "Anti flood", value: settings.antiFlood ? "Activo" : "Desactivado", inline: true },
      ];
      await interaction.reply({ embeds: [replyEmbed("🛡️ Estado de protecciones", 0x5865F2, statusFields)], ephemeral: true });
      return;
    }

    if (subcommand === "set") {
      const type = interaction.options.getString("type");
      const value = interaction.options.getString("value");
      if (!type || !value) {
        await interaction.reply({ content: "❌ Debes seleccionar el tipo de protección y el valor (on/off).", ephemeral: true });
        return;
      }
      const enabled = value === "on";
      const updatedSettings = { ...settings, [type]: enabled };
      setGuildProtectionSettings(interaction.guild.id, updatedSettings);
      await interaction.reply({ content: `✅ ${type.replace(/([A-Z])/g, " $1")} ahora está ${enabled ? "activado" : "desactivado"}.`, ephemeral: true });
      return;
    }

    await interaction.reply({ content: "❌ Comando de protección desconocido. Usa /protect set o /protect status.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "tickets-setup") {
    if (!interaction.guild) {
      await interaction.reply({ content: "❌ Este comando solo funciona en servidores.", ephemeral: true });
      return;
    }

    const role = interaction.options.getRole("role");
    const category = interaction.options.getChannel("category");

    if (!role || !category || category.type !== ChannelType.GuildCategory) {
      await interaction.reply({ content: "❌ Debes indicar un rol y una categoría válidos.", ephemeral: true });
      return;
    }

    const updatedSettings = {
      ...settings,
      ticketRoleId: role.id,
      ticketCategoryId: category.id,
    };
    setGuildProtectionSettings(interaction.guild.id, updatedSettings);

    await interaction.reply({ content: `✅ Sistema de tickets configurado.
Rol de tickets: ${role}
Categoría de tickets: ${category}` , ephemeral: true });
    return;
  }

  if (interaction.commandName === "ticket-panel") {
    if (!interaction.guild) {
      await interaction.reply({ content: "❌ Este comando solo funciona en servidores.", ephemeral: true });
      return;
    }

    const settings = getGuildProtectionSettings(interaction.guild.id);
    if (!settings.ticketRoleId || !settings.ticketCategoryId) {
      await interaction.reply({ content: "❌ Primero configura los tickets con /tickets-setup antes de enviar el panel.", ephemeral: true });
      return;
    }

    const role = interaction.guild.roles.cache.get(settings.ticketRoleId);
    const category = interaction.guild.channels.cache.get(settings.ticketCategoryId);
    const title = interaction.options.getString("title") || "🎫 Abrir ticket de soporte";
    const description = interaction.options.getString("description") || "Pulsa el botón para abrir un ticket y recibe ayuda directa de nuestro equipo de soporte.";
    const ticketButton = new ButtonBuilder()
      .setCustomId("open_ticket")
      .setLabel("Abrir Ticket")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🎟️");

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(`${description}\n\n✨ Tu ticket quedará visible solo para ti y el equipo de soporte.`)
          .setColor(0x5B84E9)
          .addFields(
            { name: "👥 Soporte asignado", value: role ? `<@&${role.id}>` : "No configurado", inline: true },
            { name: "📂 Categoría", value: category ? `${category.name}` : "No configurada", inline: true },
            { name: "📝 Qué hacer", value: "Haz clic en el botón de abajo para abrir un ticket privado.", inline: false }
          )
          .setFooter({ text: "Sistema de tickets de Scaanner", iconURL: interaction.client.user.displayAvatarURL() })
          .setTimestamp(),
      ],
      components: [new ActionRowBuilder().addComponents(ticketButton)],
      ephemeral: false,
    });
    return;
  }

  const targetUser = interaction.options.getUser("user") || null;
  const userId = targetUser?.id || interaction.options.getString("user_id");
  const needsTarget = ["search", "banglobal", "ban_global", "warn", "unwarn", "kick", "banperm", "bantemp", "unban", "timeout", "untimeout"];
  if (needsTarget.includes(interaction.commandName) && !userId) {
    await interaction.reply({ content: "❌ Debes indicar un usuario válido.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "search") {
    const memberRoles = interaction.member?.roles.cache.map((r) => r.id) || [];
    const hasRole = memberRoles.some((roleId) => ROLE_IDS_SEARCH.includes(roleId));
    if (!isOwner && !hasRole) {
      await interaction.reply({ content: "❌ No tienes permiso para usar /search.", ephemeral: true });
      return;
    }
    const banStatus = getBanStatus(userId);
    const fields = [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "No encontrado"}`, inline: true },
      { name: "ID", value: userId || "Sin ID", inline: true },
      { name: "Estado", value: banStatus.isBanned ? `<a:global:1531047167777833042> Usuario baneado globalmente` : `<a:Online:1530014889501003846> Sin amenazas detectadas`, inline: true },
    ];

    await interaction.reply({ embeds: [replyEmbed("🔎 Resultado de búsqueda", banStatus.isBanned ? 0xED4245 : 0x57F287, fields)], ephemeral: true });
    return;
  }

  if (interaction.commandName === "banglobal" || interaction.commandName === "ban_global") {
    const memberRoles = interaction.member?.roles.cache.map((r) => r.id) || [];
    const hasRole = memberRoles.some((roleId) => ROLE_IDS_BANGLOBAL.includes(roleId));
    if (!isOwner && !hasRole) {
      await interaction.reply({ content: "❌ No tienes permiso para usar /banglobal.", ephemeral: true });
      return;
    }
    const success = addGlobalBan(userId, targetUser?.tag || "Desconocido");
    addEvidence(userId, interaction.user.id, "Baneado global desde comando slash");
    if (interaction.guild) {
      await interaction.guild.bans.create(userId, { reason: "Baneo global aplicado" }).catch(() => {});
    }

    const fields = [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
      { name: "Estado", value: `<a:global:1531047167777833042> Usuario baneado globalmente`, inline: true },
      { name: "Evidencia", value: "Se registró un log de evidencia en data/evidence.json", inline: false },
    ];

    await interaction.reply({ embeds: [replyEmbed(success ? "✅ Baneo global aplicado" : "ℹ️ El usuario ya estaba baneado", success ? 0xED4245 : 0xFEE75C, fields)], ephemeral: true });
    return;
  }

  if (interaction.commandName === "status") {
    const fields = interaction.guild
      ? [
          { name: "Anti raid", value: settings.antiRaid ? "Activo" : "Desactivado", inline: true },
          { name: "Anti flood", value: settings.antiFlood ? "Activo" : "Desactivado", inline: true },
          { name: "Anti links", value: settings.antiLinks ? "Activo" : "Desactivado", inline: true },
          { name: "Anti bots", value: settings.antiBots ? "Activo" : "Desactivado", inline: true },
          { name: "Anti nuke", value: settings.antiNuke ? "Activo" : "Desactivado", inline: true },
          { name: "Servidores", value: `${client.guilds.cache.size}`, inline: true },
        ]
      : [
          { name: "Servidores", value: `${client.guilds.cache.size}`, inline: true },
          { name: "Protecciones", value: "Usa /protect status en un servidor para verlas", inline: false },
        ];

    await interaction.reply({ embeds: [replyEmbed("🛡️ Estado del bot", 0x5865F2, fields)], ephemeral: true });
    return;
  }

  const member = interaction.options.getMember("user") || (interaction.guild ? await interaction.guild.members.fetch(userId).catch(() => null) : null);
  const duration = interaction.options.getString("duration");
  const reason = interaction.options.getString("reason") || "Sin razón proporcionada";

  if (interaction.commandName === "warn") {
    const count = addWarn(userId, interaction.guild.id, interaction.user.id, reason);
    await interaction.reply({ embeds: [replyEmbed("⚠️ Usuario advertido", 0xFEE75C, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
      { name: "Warns", value: `${count}`, inline: true },
      { name: "Motivo", value: reason, inline: false },
    ])], ephemeral: true });
    return;
  }

  if (interaction.commandName === "unwarn") {
    const remaining = removeWarn(userId, interaction.guild.id);
    await interaction.reply({ embeds: [replyEmbed("✅ Warns eliminados", 0x57F287, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
      { name: "Warns restantes", value: `${remaining}`, inline: true },
    ])], ephemeral: true });
    return;
  }

  if (interaction.commandName === "kick") {
    if (!member || !member.kick) {
      await interaction.reply({ content: "❌ No se pudo encontrar al usuario para expulsar.", ephemeral: true });
      return;
    }
    await member.kick(reason).catch(() => {});
    await interaction.reply({ embeds: [replyEmbed("👢 Usuario expulsado", 0xED4245, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
      { name: "Motivo", value: reason, inline: false },
    ])], ephemeral: true });
    return;
  }

  if (interaction.commandName === "banperm") {
    if (!interaction.guild) {
      await interaction.reply({ content: "❌ Este comando solo funciona en servidores.", ephemeral: true });
      return;
    }
    await interaction.guild.bans.create(userId, { reason }).catch(() => {});
    await interaction.reply({ embeds: [replyEmbed("⛔ Usuario baneado permanentemente", 0xED4245, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
      { name: "Motivo", value: reason, inline: false },
    ])], ephemeral: true });
    return;
  }

  if (interaction.commandName === "bantemp") {
    if (!interaction.guild) {
      await interaction.reply({ content: "❌ Este comando solo funciona en servidores.", ephemeral: true });
      return;
    }
    const durationMs = parseDuration(duration);
    if (!durationMs) {
      await interaction.reply({ content: "❌ Proporciona una duración válida como 10m, 1h, 1d.", ephemeral: true });
      return;
    }
    await interaction.guild.bans.create(userId, { reason }).catch(() => {});
    addTempBan(userId, interaction.guild.id, interaction.user.id, reason, durationMs);
    await interaction.reply({ embeds: [replyEmbed("⏳ Usuario baneado temporalmente", 0xFEE75C, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
      { name: "Duración", value: duration, inline: true },
      { name: "Motivo", value: reason, inline: false },
    ])], ephemeral: true });
    return;
  }

  if (interaction.commandName === "unban") {
    if (!interaction.guild) {
      await interaction.reply({ content: "❌ Este comando solo funciona en servidores.", ephemeral: true });
      return;
    }
    await interaction.guild.bans.remove(userId, reason).catch(() => {});
    await interaction.reply({ embeds: [replyEmbed("✅ Usuario desbaneado", 0x57F287, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
    ])], ephemeral: true });
    return;
  }

  if (interaction.commandName === "timeout") {
    if (!member || !member.timeout) {
      await interaction.reply({ content: "❌ No se pudo encontrar al usuario para silenciar.", ephemeral: true });
      return;
    }
    const durationMs = parseDuration(duration);
    if (!durationMs) {
      await interaction.reply({ content: "❌ Proporciona una duración válida como 10m, 1h, 1d.", ephemeral: true });
      return;
    }
    await member.timeout(durationMs, reason).catch(() => {});
    await interaction.reply({ embeds: [replyEmbed("🔇 Usuario silenciado", 0xFEE75C, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
      { name: "Duración", value: duration, inline: true },
      { name: "Motivo", value: reason, inline: false },
    ])], ephemeral: true });
    return;
  }

  if (interaction.commandName === "untimeout") {
    if (!member || !member.timeout) {
      await interaction.reply({ content: "❌ No se pudo encontrar al usuario para quitar el timeout.", ephemeral: true });
      return;
    }
    await member.timeout(null, "Timeout removido").catch(() => {});
    await interaction.reply({ embeds: [replyEmbed("✅ Timeout removido", 0x57F287, [
      { name: "Usuario", value: `<a:user:1531047462117179552> ${targetUser ? targetUser.tag : "Desconocido"}`, inline: true },
      { name: "ID", value: userId, inline: true },
    ])], ephemeral: true });
    return;
  }

  await interaction.reply({ content: "❌ Comando no reconocido.", ephemeral: true });
});

const token = process.env.DISCORD_TOKEN?.trim();
const oauthClientId = process.env.OAUTH_CLIENT_ID || process.env.CLIENT_ID;
const oauthClientSecret = process.env.OAUTH_CLIENT_SECRET;
const callbackUrl = process.env.CALLBACK_URL || "http://localhost:3000/callback";
const dashboardPort = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET || "change-this-secret";

if (!token) {
  console.error("❌ No se encontró DISCORD_TOKEN. Crea el archivo .env con tu token real.");
  process.exit(1);
}

if (!oauthClientId || !oauthClientSecret) {
  console.error("❌ No se encontró OAUTH_CLIENT_ID o OAUTH_CLIENT_SECRET. Añade estas variables al .env.");
  process.exit(1);
}

function startDashboard() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
    })
  );

  const oauthUrl = new URL("https://discord.com/api/oauth2/authorize");
  oauthUrl.searchParams.set("client_id", oauthClientId);
  oauthUrl.searchParams.set("redirect_uri", callbackUrl);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("scope", "identify guilds");

  app.get("/", (req, res) => {
    if (!req.session.user) {
      return res.send(`
        <h1>Scaanner Dashboard</h1>
        <p>Inicia sesión con Discord para seleccionar tu servidor y configurar el bot.</p>
        <a href="${oauthUrl.toString()}">Login with Discord</a>
      `);
    }

    res.redirect("/dashboard");
  });

  app.get("/login", (req, res) => {
    res.redirect(oauthUrl.toString());
  });

  app.get("/callback", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect("/");

    try {
      const tokenResponse = await axios.post(
        "https://discord.com/api/oauth2/token",
        new URLSearchParams({
          client_id: oauthClientId,
          client_secret: oauthClientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUrl,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      const accessToken = tokenResponse.data.access_token;
      const userResponse = await axios.get("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const guildsResponse = await axios.get("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      req.session.user = userResponse.data;
      req.session.token = accessToken;
      req.session.guilds = guildsResponse.data;
      res.redirect("/dashboard");
    } catch (error) {
      console.error("OAuth callback error:", error.response?.data || error.message);
      res.send("Error en el login de Discord. Revisa la consola.");
    }
  });

  function ensureLoggedIn(req, res, next) {
    if (!req.session.user || !req.session.token) {
      return res.redirect("/");
    }
    next();
  }

  app.get("/dashboard", ensureLoggedIn, async (req, res) => {
    const allowedGuilds = req.session.guilds.filter((guild) => {
      const botGuild = client.guilds.cache.get(guild.id);
      return botGuild && (guild.owner || (guild.permissions & 0x20) === 0x20);
    });

    if (!allowedGuilds.length) {
      return res.send(`<h1>Scaanner Dashboard</h1><p>No tienes servidores disponibles donde el bot esté presente y tengas permisos.</p><a href="/logout">Cerrar sesión</a>`);
    }

    const list = allowedGuilds
      .map((guild) => `<li>${guild.name} - <a href="/guild/${guild.id}">Configurar</a></li>`)
      .join("");

    res.send(`
      <h1>Scaanner Dashboard</h1>
      <p>Selecciona el servidor que quieres configurar.</p>
      <ul>${list}</ul>
      <a href="/logout">Cerrar sesión</a>
    `);
  });

    // simple HTML escape helper for textarea values
    function escapeHtml(unsafe) {
      return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

  app.get("/guild/:guildId", ensureLoggedIn, (req, res) => {
    const guildId = req.params.guildId;
    const userGuild = req.session.guilds.find((guild) => guild.id === guildId);
    if (!userGuild || !(userGuild.owner || (userGuild.permissions & 0x20) === 0x20)) {
      return res.send("<p>No tienes permisos para configurar ese servidor.</p><a href=\"/dashboard\">Volver</a>");
    }

    const botGuild = client.guilds.cache.get(guildId);
    if (!botGuild) {
      return res.send("<p>El bot no está en ese servidor.</p><a href=\"/dashboard\">Volver</a>");
    }

    const settings = getGuildProtectionSettings(guildId);
    const welcomeChecked = settings.welcomeMessageEnabled ? "checked" : "";

    // build channel options
    const channels = botGuild.channels.cache
      .filter((ch) => ch.isTextBased() && ch.permissionsFor(botGuild.members.me)?.has(PermissionFlagsBits.SendMessages))
      .sort((a, b) => a.position - b.position)
      .map((ch) => ({ id: ch.id, name: `#${ch.name}` }));

    // build role options and category options
    const roles = botGuild.roles.cache
      .filter((r) => r.id !== botGuild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name }));

    const categories = botGuild.channels.cache
      .filter((c) => c.type === 4)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name }));

    const channelOptions = channels
      .map((ch) => {
        const sel = ch.id === settings.welcomeChannelId ? 'selected' : '';
        return `<option value="${ch.id}" ${sel}>${ch.name}</option>`;
      })
      .join("");

    res.send(`
      <h1>Configuración de ${botGuild.name}</h1>
      <form action="/guild/${guildId}" method="POST">
        <label>
          <input type="checkbox" name="welcomeMessageEnabled" ${welcomeChecked} /> Activar bienvenidas
        </label>
        <p>Canal de bienvenida:</p>
        <select name="welcomeChannelId" size="8" style="width:300px;">
          <option value="">(Usar canal del sistema)</option>
          ${channelOptions}
        </select>
        <p>Mensaje de bienvenida (usa [usermention], [usertag], [server]):</p>
        <textarea name="welcomeMessageTemplate" rows="4" cols="60">${escapeHtml(settings.welcomeMessageTemplate || '')}</textarea>
        <h3>Tickets</h3>
        <p>Rol de soporte (será notificado y verá los tickets):</p>
        <select name="ticketRoleId" style="width:300px;">
          <option value="">(Ninguno seleccionado)</option>
          ${roles.map((r) => `<option value="${r.id}" ${r.id===settings.ticketRoleId? 'selected':''}>${escapeHtml(r.name)}</option>`).join('')}
        </select>
        <p>Categoría donde se crearán los tickets:</p>
        <select name="ticketCategoryId" style="width:300px;">
          <option value="">(Ninguna seleccionada)</option>
          ${categories.map((c) => `<option value="${c.id}" ${c.id===settings.ticketCategoryId? 'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <h3>Protecciones</h3>
        <label><input type="checkbox" name="antiRaid" ${settings.antiRaid ? 'checked' : ''} /> Anti-Raid</label><br />
        <label><input type="checkbox" name="antiNuke" ${settings.antiNuke ? 'checked' : ''} /> Anti-Nuke</label><br />
        <label><input type="checkbox" name="antiLinks" ${settings.antiLinks ? 'checked' : ''} /> Anti-Links</label><br />
        <label><input type="checkbox" name="antiBots" ${settings.antiBots ? 'checked' : ''} /> Anti-Bots</label><br />
        <label><input type="checkbox" name="antiFlood" ${settings.antiFlood ? 'checked' : ''} /> Anti-Flood</label><br />
        <p><button type="submit">Guardar</button></p>
      </form>
      <a href="/dashboard">Volver</a>
    `);
  });

  app.post("/guild/:guildId", ensureLoggedIn, (req, res) => {
    const guildId = req.params.guildId;
    const userGuild = req.session.guilds.find((guild) => guild.id === guildId);
    if (!userGuild || !(userGuild.owner || (userGuild.permissions & 0x20) === 0x20)) {
      return res.send("<p>No tienes permisos para configurar ese servidor.</p><a href=\"/dashboard\">Volver</a>");
    }

    const botGuild = client.guilds.cache.get(guildId);
    if (!botGuild) {
      return res.send("<p>El bot no está en ese servidor.</p><a href=\"/dashboard\">Volver</a>");
    }

    const settings = getGuildProtectionSettings(guildId);
    const updatedSettings = {
      ...settings,
      welcomeMessageEnabled: Boolean(req.body.welcomeMessageEnabled),
      welcomeChannelId: req.body.welcomeChannelId || "",
      welcomeMessageTemplate: req.body.welcomeMessageTemplate || settings.welcomeMessageTemplate,
      antiRaid: Boolean(req.body.antiRaid),
      antiNuke: Boolean(req.body.antiNuke),
      antiLinks: Boolean(req.body.antiLinks),
      antiBots: Boolean(req.body.antiBots),
      antiFlood: Boolean(req.body.antiFlood),
      ticketRoleId: req.body.ticketRoleId || "",
      ticketCategoryId: req.body.ticketCategoryId || "",
    };
    setGuildProtectionSettings(guildId, updatedSettings);
    res.send(`<p>Configuración guardada.</p><a href="/guild/${guildId}">Volver</a>`);
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  const server = app.listen(dashboardPort, () => {
    console.log(`✅ Dashboard de Scaanner disponible en http://localhost:${dashboardPort}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`❌ No se pudo iniciar el dashboard en el puerto ${dashboardPort} porque ya está en uso.`);
      console.error("Cambia DASHBOARD_PORT en .env o cierra la otra aplicación que usa el puerto.");
      return;
    }
    console.error("Error en el dashboard:", error);
  });
}

ensureDataFiles();
startDashboard();

process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED_REJECTION]", reason, promise);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT_EXCEPTION]", error);
});

client.login(token);
