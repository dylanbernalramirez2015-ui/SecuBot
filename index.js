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

  const botInviteUrl = new URL("https://discord.com/api/oauth2/authorize");
  botInviteUrl.searchParams.set("client_id", oauthClientId);
  botInviteUrl.searchParams.set("permissions", "8");
  botInviteUrl.searchParams.set("scope", "bot applications.commands");

  app.get("/", (req, res) => {
    if (!req.session.user) {
      return res.send(`
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>SecuBot Dashboard</title>
            <style>
              @keyframes glow {
                0%, 100% { box-shadow: 0 0 35px rgba(44, 123, 255, 0.18); }
                50% { box-shadow: 0 0 60px rgba(44, 123, 255, 0.32); }
              }
              @keyframes pulse {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-6px); }
              }
              body {
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                background: radial-gradient(circle at top left, #1a3e8d 0%, #070a17 45%, #000000 100%);
                color: #edf2ff;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              }
              .container {
                text-align: center;
                width: min(700px, 92%);
                padding: 48px;
                border-radius: 30px;
                background: rgba(5, 13, 38, 0.88);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(94, 147, 255, 0.15);
                box-shadow: 0 28px 80px rgba(0, 0, 0, 0.35);
                position: relative;
                overflow: hidden;
              }
              .container::before {
                content: '';
                position: absolute;
                top: -20%;
                left: -10%;
                width: 220%;
                height: 220%;
                background: radial-gradient(circle, rgba(83, 192, 255, 0.18), transparent 28%);
                pointer-events: none;
              }
              h1 {
                margin: 0;
                font-size: clamp(3rem, 6vw, 5rem);
                letter-spacing: -0.06em;
                text-transform: uppercase;
                color: #fff;
                text-shadow: 0 0 18px rgba(83, 192, 255, 0.28);
              }
              h1 span { display: block; font-size: 0.55em; letter-spacing: 0.15em; color: #82a2ff; }
              p {
                margin: 18px auto 42px;
                font-size: 1.05rem;
                line-height: 1.75;
                color: #c5d4ff;
              }
              .buttons {
                display: flex;
                justify-content: center;
                gap: 18px;
                flex-wrap: wrap;
              }
              .button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 170px;
                padding: 16px 28px;
                border-radius: 999px;
                text-decoration: none;
                font-size: 1rem;
                font-weight: 800;
                transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
                cursor: pointer;
              }
              .button.primary {
                background: linear-gradient(135deg, #5db8ff, #2d70ff);
                color: #061328;
                animation: glow 3.2s ease-in-out infinite;
              }
              .button.secondary {
                background: rgba(255, 255, 255, 0.07);
                color: #f5fbff;
                border: 1px solid rgba(255, 255, 255, 0.16);
              }
              .button:hover {
                transform: translateY(-3px);
                box-shadow: 0 16px 28px rgba(44, 123, 255, 0.28);
              }
              .footer {
                margin-top: 40px;
                color: #9bb1ff;
                font-size: 0.95rem;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1><span>SecuBot</span> Panel</h1>
              <p>Agrega el bot a tu servidor y abre el dashboard para gestionar seguridad y tickets con un estilo moderno.</p>
              <div class="buttons">
                <a class="button primary" href="${botInviteUrl.toString()}">Agregar Bot</a>
                <a class="button secondary" href="/login">Abrir Dashboard</a>
              </div>
              <div class="footer">Powered by SecuBot</div>
            </div>
          </body>
        </html>
      `);
    }

    res.redirect("/dashboard");
  });

  app.get("/login", (req, res) => {
    res.redirect(oauthUrl.toString());
  });

  app.get("/dashboard", ensureLoggedIn, async (req, res) => {
    const allowedGuilds = req.session.guilds.filter((guild) => {
      const botGuild = client.guilds.cache.get(guild.id);
      return botGuild && (guild.owner || (guild.permissions & 0x20) === 0x20);
    });

    if (!allowedGuilds.length) {
      return res.send(`
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>SecuBot Dashboard</title>
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                background: radial-gradient(circle at top left, #0c1d45 0%, #050811 48%, #000000 100%);
                color: #eef3ff;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              }
              .container {
                width: min(780px, 92%);
                padding: 42px;
                border-radius: 32px;
                background: rgba(4, 12, 30, 0.94);
                border: 1px solid rgba(97, 151, 255, 0.14);
                box-shadow: 0 32px 90px rgba(0, 0, 0, 0.38);
                backdrop-filter: blur(16px);
              }
              h1 {
                margin: 0 0 14px;
                font-size: clamp(2.8rem, 5vw, 4rem);
                letter-spacing: -0.05em;
                text-transform: uppercase;
                color: #f9fbff;
                text-shadow: 0 0 20px rgba(83, 193, 255, 0.18);
              }
              p {
                margin: 0;
                color: #cdd8ff;
                font-size: 1.05rem;
                line-height: 1.8;
              }
              .link {
                display: inline-flex;
                margin-top: 30px;
                padding: 14px 26px;
                border-radius: 999px;
                background: linear-gradient(135deg, rgba(83, 192, 255, 0.14), rgba(44, 118, 255, 0.18));
                color: #eff7ff;
                text-decoration: none;
                border: 1px solid rgba(255, 255, 255, 0.12);
                transition: transform 0.24s ease, box-shadow 0.24s ease;
              }
              .link:hover {
                transform: translateY(-2px);
                box-shadow: 0 18px 36px rgba(44, 118, 255, 0.2);
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>SecuBot Dashboard</h1>
              <p>No hay servidores disponibles donde el bot esté presente y tengas permisos de gestión.</p>
              <a class="link" href="/logout">Cerrar sesión</a>
            </div>
          </body>
        </html>
      `);
    }

    const list = allowedGuilds
      .map((guild) => {
        const iconUrl = guild.icon
          ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
          : `https://via.placeholder.com/80x80.png?text=?`;
        return `
          <li class="server-card">
            <img src="${iconUrl}" alt="${guild.name} icon" />
            <div class="server-info">
              <strong>${guild.name}</strong>
              <a class="configure-btn" href="/guild/${guild.id}">Configurar</a>
            </div>
          </li>
        `;
      })
      .join("");

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>SecuBot Dashboard</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              background: radial-gradient(circle at top left, #081a44 0%, #02050d 48%, #000000 100%);
              color: #eef3ff;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            .page {
              width: min(1120px, 96%);
              margin: 0 auto;
              padding: 46px 0 62px;
            }
            .hero {
              text-align: center;
              padding: 0 20px;
              margin-bottom: 30px;
            }
            .hero h1 {
              margin: 0;
              font-size: clamp(3rem, 5vw, 5rem);
              letter-spacing: -0.06em;
              text-transform: uppercase;
              text-shadow: 0 0 24px rgba(83, 192, 255, 0.18);
            }
            .hero p {
              margin: 18px auto 0;
              font-size: 1.05rem;
              max-width: 760px;
              color: #c9d5ff;
              line-height: 1.75;
            }
            .cards {
              display: grid;
              gap: 20px;
              grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            }
            .server-card {
              display: flex;
              align-items: center;
              gap: 18px;
              padding: 24px 26px;
              border-radius: 28px;
              background: rgba(14, 24, 52, 0.92);
              border: 1px solid rgba(83, 192, 255, 0.14);
              box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2);
              transition: transform 0.2s ease, border-color 0.2s ease;
            }
            .server-card:hover {
              transform: translateY(-3px);
              border-color: rgba(83, 192, 255, 0.28);
            }
            .server-card img {
              width: 78px;
              height: 78px;
              border-radius: 24px;
              object-fit: cover;
              border: 1px solid rgba(255, 255, 255, 0.15);
              background: #07102a;
            }
            .server-info {
              flex: 1;
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .server-info strong {
              font-size: 1.2rem;
              color: #fbfdff;
            }
            .configure-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-width: 150px;
              padding: 12px 22px;
              border-radius: 999px;
              background: linear-gradient(135deg, #72d3ff, #2e7bff);
              color: #051028;
              font-weight: 700;
              text-decoration: none;
              box-shadow: 0 16px 34px rgba(44, 123, 255, 0.24);
              transition: transform 0.2s ease, box-shadow 0.2s ease;
            }
            .configure-btn:hover {
              transform: translateY(-2px);
              box-shadow: 0 18px 38px rgba(44, 123, 255, 0.3);
            }
            .logout-wrapper {
              display: flex;
              justify-content: center;
              margin-top: 44px;
            }
            .logout {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 14px 28px;
              border-radius: 999px;
              border: 1px solid rgba(255, 255, 255, 0.14);
              background: rgba(255, 255, 255, 0.05);
              color: #eef4ff;
              text-decoration: none;
              font-weight: 700;
              transition: transform 0.2s ease, background 0.2s ease;
            }
            .logout:hover {
              transform: translateY(-2px);
              background: rgba(255, 255, 255, 0.09);
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="hero">
              <h1>SecuBot Dashboard</h1>
              <p>Selecciona el servidor que quieres configurar. Haz clic en Configurar para abrir el panel del servidor.</p>
            </div>
            <div class="cards">
              ${list}
            </div>
            <div class="logout-wrapper">
              <a class="logout" href="/logout">Cerrar sesión</a>
            </div>
          </div>
        </body>
      </html>
    `);
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

    const guildIconUrl = botGuild.icon
      ? `https://cdn.discordapp.com/icons/${botGuild.id}/${botGuild.icon}.png?size=128`
      : `https://via.placeholder.com/128x128.png?text=SecuBot`;

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Configuración de ${escapeHtml(botGuild.name)}</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              background: radial-gradient(circle at top left, #09172e 0%, #020409 42%, #000000 100%);
              color: #f1f5ff;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            .page {
              width: min(1100px, 96%);
              margin: 0 auto;
              padding: 40px 0 60px;
            }
            .card {
              background: rgba(7, 16, 38, 0.94);
              border: 1px solid rgba(79, 156, 255, 0.14);
              border-radius: 30px;
              box-shadow: 0 32px 90px rgba(0, 0, 0, 0.28);
              overflow: hidden;
            }
            .card-header {
              display: flex;
              align-items: center;
              gap: 20px;
              padding: 32px 36px;
              background: linear-gradient(135deg, rgba(44, 123, 255, 0.18), rgba(6, 18, 48, 0.96));
            }
            .guild-icon {
              width: 88px;
              height: 88px;
              border-radius: 24px;
              object-fit: cover;
              border: 1px solid rgba(255, 255, 255, 0.12);
              background: #04102a;
            }
            .guild-title {
              display: grid;
              gap: 6px;
            }
            .guild-title h1 {
              margin: 0;
              font-size: clamp(2rem, 3vw, 2.8rem);
              letter-spacing: -0.04em;
            }
            .guild-title p {
              margin: 0;
              color: #adc7ff;
            }
            .card-body {
              padding: 34px 36px 42px;
              display: grid;
              gap: 24px;
            }
            .section {
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid rgba(255, 255, 255, 0.08);
              border-radius: 24px;
              padding: 24px;
            }
            .section-title {
              margin: 0 0 16px;
              font-size: 1.1rem;
              color: #e7eeff;
              font-weight: 700;
            }
            .field {
              display: grid;
              gap: 10px;
              margin-bottom: 18px;
            }
            .field label {
              display: inline-flex;
              align-items: center;
              gap: 12px;
              color: #d7e3ff;
              font-weight: 600;
            }
            input[type="checkbox"] {
              accent-color: #54c3ff;
              width: 18px;
              height: 18px;
            }
            select,
            textarea {
              width: 100%;
              min-height: 48px;
              border-radius: 18px;
              border: 1px solid rgba(255, 255, 255, 0.12);
              background: rgba(6, 14, 28, 0.96);
              color: #eef3ff;
              padding: 14px 16px;
              font-size: 1rem;
              outline: none;
            }
            select { min-height: 52px; }
            textarea { min-height: 140px; resize: vertical; }
            .field small {
              color: #a9b8ff;
              line-height: 1.6;
            }
            .row {
              display: grid;
              gap: 20px;
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .row-single { grid-template-columns: 1fr; }
            .actions {
              display: flex;
              flex-wrap: wrap;
              gap: 16px;
              justify-content: flex-end;
              margin-top: 8px;
            }
            .button-submit,
            .button-back {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 14px 26px;
              border-radius: 999px;
              border: 1px solid rgba(255, 255, 255, 0.14);
              font-weight: 700;
              text-decoration: none;
              transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
            }
            .button-submit {
              background: linear-gradient(135deg, #5db8ff, #2d70ff);
              color: #061328;
              box-shadow: 0 18px 38px rgba(44, 123, 255, 0.22);
              border-color: transparent;
            }
            .button-back {
              background: rgba(255, 255, 255, 0.06);
              color: #eef4ff;
            }
            .button-submit:hover,
            .button-back:hover {
              transform: translateY(-2px);
            }
            .note {
              margin: 0;
              color: #a9bcff;
              line-height: 1.75;
            }
            @media (max-width: 840px) {
              .row { grid-template-columns: 1fr; }
              .card-header { flex-direction: column; align-items: flex-start; }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="card">
              <div class="card-header">
                <img class="guild-icon" src="${guildIconUrl}" alt="Icono de ${escapeHtml(botGuild.name)}" />
                <div class="guild-title">
                  <h1>${escapeHtml(botGuild.name)}</h1>
                  <p>Configura seguridad, tickets y bienvenida en tu servidor.</p>
                </div>
              </div>
              <div class="card-body">
                <form action="/guild/${guildId}" method="POST">
                  <div class="section">
                    <p class="section-title">Bienvenida</p>
                    <div class="field">
                      <label><input type="checkbox" name="welcomeMessageEnabled" ${welcomeChecked} /> Activar mensaje de bienvenida</label>
                    </div>
                    <div class="field">
                      <label>Canal de bienvenida</label>
                      <select name="welcomeChannelId">
                        <option value="">(Usar canal del sistema)</option>
                        ${channelOptions}
                      </select>
                      <small>El bot enviará el mensaje al canal seleccionado.</small>
                    </div>
                    <div class="field">
                      <label>Mensaje de bienvenida</label>
                      <textarea name="welcomeMessageTemplate">${escapeHtml(settings.welcomeMessageTemplate || '')}</textarea>
                      <small>Usa etiquetas: [usermention], [usertag], [server].</small>
                    </div>
                  </div>

                  <div class="section">
                    <p class="section-title">Tickets</p>
                    <div class="field">
                      <label>Rol de soporte</label>
                      <select name="ticketRoleId">
                        <option value="">(Ninguno seleccionado)</option>
                        ${roles
                          .map(
                            (r) => `<option value="${r.id}" ${r.id === settings.ticketRoleId ? 'selected' : ''}>${escapeHtml(r.name)}</option>`
                          )
                          .join('')}
                      </select>
                    </div>
                    <div class="field">
                      <label>Categoría de tickets</label>
                      <select name="ticketCategoryId">
                        <option value="">(Ninguna seleccionada)</option>
                        ${categories
                          .map(
                            (c) => `<option value="${c.id}" ${c.id === settings.ticketCategoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                          )
                          .join('')}
                      </select>
                    </div>
                  </div>

                  <div class="section">
                    <p class="section-title">Protecciones</p>
                    <div class="row row-single">
                      <label><input type="checkbox" name="antiRaid" ${settings.antiRaid ? 'checked' : ''} /> Anti-Raid</label>
                      <label><input type="checkbox" name="antiNuke" ${settings.antiNuke ? 'checked' : ''} /> Anti-Nuke</label>
                      <label><input type="checkbox" name="antiLinks" ${settings.antiLinks ? 'checked' : ''} /> Anti-Links</label>
                      <label><input type="checkbox" name="antiBots" ${settings.antiBots ? 'checked' : ''} /> Anti-Bots</label>
                      <label><input type="checkbox" name="antiFlood" ${settings.antiFlood ? 'checked' : ''} /> Anti-Flood</label>
                    </div>
                  </div>

                  <div class="actions">
                    <button type="submit" class="button-submit">Guardar cambios</button>
                    <a class="button-back" href="/dashboard">Volver al dashboard</a>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </body>
      </html>
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
    res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Configuración guardada</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              background: radial-gradient(circle at top left, #071528 0%, #03050b 58%, #000000 100%);
              color: #eef2ff;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            .container {
              width: min(760px, 92%);
              margin: 0 auto;
              padding: 38px;
              border-radius: 32px;
              background: rgba(6, 14, 32, 0.96);
              border: 1px solid rgba(83, 191, 255, 0.16);
              box-shadow: 0 28px 84px rgba(0, 0, 0, 0.35);
              text-align: center;
            }
            h1 {
              margin: 0 0 18px;
              font-size: clamp(2.4rem, 5vw, 3.2rem);
              color: #f7fbff;
            }
            p {
              color: #c9d4ff;
              font-size: 1rem;
              line-height: 1.8;
            }
            .buttons {
              display: flex;
              justify-content: center;
              gap: 16px;
              flex-wrap: wrap;
              margin-top: 28px;
            }
            .button {
              padding: 14px 26px;
              border-radius: 999px;
              text-decoration: none;
              font-weight: 700;
              color: #eef2ff;
              background: linear-gradient(135deg, #4ca8ff, #1e57d4);
              border: 1px solid rgba(255, 255, 255, 0.12);
              transition: transform 0.2s ease, box-shadow 0.2s ease;
            }
            .button:hover {
              transform: translateY(-2px);
              box-shadow: 0 18px 36px rgba(30, 87, 212, 0.26);
            }
            .button.secondary {
              background: rgba(255, 255, 255, 0.08);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Configuración guardada</h1>
            <p>Los cambios se han aplicado correctamente en ${escapeHtml(botGuild.name)}.</p>
            <div class="buttons">
              <a class="button" href="/guild/${guildId}">Volver a la configuración</a>
              <a class="button secondary" href="/dashboard">Ir al dashboard</a>
            </div>
          </div>
        </body>
      </html>
    `);
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  const server = app.listen(dashboardPort, () => {
    console.log(`✅ Dashboard de Scaanner disponible en el puerto ${dashboardPort} (usa la URL pública de Render)`);
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
