const path = require("path");
const dotenv = require("dotenv");
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

for (const envPath of [path.join(__dirname, ".env"), path.join(__dirname, ".env.example")]) {
  dotenv.config({ path: envPath });
}

const supportGuildId = process.env.SUPPORT_GUILD_ID?.trim() || "1464018120481177742";
const registerGlobal = process.env.REGISTER_GLOBAL === "true";

const supportCommands = [
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Busca un usuario por ID")
    .addStringOption((option) => option.setName("user_id").setDescription("ID del usuario a buscar").setRequired(true)),
  new SlashCommandBuilder()
    .setName("banglobal")
    .setDescription("Banea globalmente un usuario desde el bot")
    .addUserOption((option) => option.setName("user").setDescription("Usuario a banear").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón del baneo")),
  new SlashCommandBuilder()
    .setName("ban_global")
    .setDescription("Alias de /banglobal")
    .addUserOption((option) => option.setName("user").setDescription("Usuario a banear").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón del baneo")),
].map((command) => command.toJSON());

const globalCommands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Muestra el menú del bot /help | scaanner.gg"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Muestra el estado de la protección del bot"),
  new SlashCommandBuilder()
    .setName("tickets-setup")
    .setDescription("Configura el sistema de tickets para este servidor")
    .addRoleOption((option) => option.setName("role").setDescription("Rol que será notificado/gestor de tickets").setRequired(true))
    .addChannelOption((option) => option.setName("category").setDescription("Categoría donde se crearán los tickets").setRequired(true)),
  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Envía el panel de tickets en este canal (embed con botón)")
    .addStringOption((option) => option.setName("title").setDescription("Título del panel").setRequired(false))
    .addStringOption((option) => option.setName("description").setDescription("Descripción del panel").setRequired(false)),

  new SlashCommandBuilder()
    .setName("protect")
    .setDescription("Configura protecciones anti")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Activa o desactiva una protección")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Protección a configurar")
            .setRequired(true)
            .addChoices(
              { name: "Anti raid", value: "antiRaid" },
              { name: "Anti nuke", value: "antiNuke" },
              { name: "Anti links", value: "antiLinks" },
              { name: "Anti bots", value: "antiBots" },
              { name: "Anti flood", value: "antiFlood" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("value")
            .setDescription("Valor de la protección")
            .setRequired(true)
            .addChoices(
              { name: "On", value: "on" },
              { name: "Off", value: "off" }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Muestra el estado de las protecciones del servidor")
    ),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Advierte a un usuario")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón de la advertencia")),
  new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("Elimina todos los warns de un usuario")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true)),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa a un usuario")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón de la expulsión")),
  new SlashCommandBuilder()
    .setName("banperm")
    .setDescription("Banea permanentemente a un usuario")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón del ban permanente")),
  new SlashCommandBuilder()
    .setName("bantemp")
    .setDescription("Banea temporalmente a un usuario")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true))
    .addStringOption((option) => option.setName("duration").setDescription("Duración, p.ej. 10m, 1h, 1d").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón del ban temporal")),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Desbanea a un usuario")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón para desbanear")),
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Silencia a un usuario temporalmente")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true))
    .addStringOption((option) => option.setName("duration").setDescription("Duración, p.ej. 10m, 1h, 1d").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Razón del timeout")),
  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Quita el timeout de un usuario")
    .addUserOption((option) => option.setName("user").setDescription("Usuario").setRequired(true)),
].map((command) => command.toJSON());

const token = process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error("❌ No se encontró DISCORD_TOKEN. Crea el archivo .env con tu token real.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("Registrando comandos slash...");

    if (!registerGlobal) {
      console.log(`Registrando comandos de prueba solo en el servidor ${supportGuildId}.`);
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, supportGuildId), {
        body: [...globalCommands, ...supportCommands],
      });
    } else {
      console.log("Registrando comandos globales... esto puede tardar hasta 1 hora en aparecer.");
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: globalCommands,
      });

      if (supportGuildId) {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, supportGuildId), {
          body: supportCommands,
        });
      }
    }

    console.log("Comandos registrados correctamente.");
  } catch (error) {
    console.error(error);
  }
})();
