const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const os = require('os');
const axios = require("axios");
const chalk = require("chalk");
const fetch = require("node-fetch");
const FormData = require("form-data"); // Pindahkan inisialisasi FormData ke sini
const https = require("https"); // Pindahkan inisialisasi https ke sini

// ==================== [ PERBAIKAN: ERROR HANDLER ] ====================
// Ganti handler kosong dengan logging untuk stabilitas
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red.bold('❌ Unhandled Rejection at:'), promise, 'reason:', reason);
});
process.on('uncaughtException', (err, origin) => {
  console.error(chalk.red.bold('💥 Uncaught Exception!'), err, 'Origin:', origin);
  // Di lingkungan produksi, disarankan process.exit(1) setelah logging,
  // tetapi dibiarkan agar bot tidak langsung mati jika error tidak kritis.
});
process.on('warning', (warning) => {
  console.warn(chalk.yellow.bold('⚠️ Node Warning:'), warning.stack);
});
// Hapus atau beri komentar pada baris ini agar error bot tetap terlihat di konsol
// console.error = () => {};
// console.warn = () => {};

const DATA_FILE = 'data.json';
const chatSessions = {}; 
const lastMenuMessage = {};
const autoShares = {}; 
const activeMenus = {};

const {
  BOT_TOKEN,
  OWNER_IDS,
  CHANNEL_USERNAME,
  DEVELOPER,
  MENU_IMAGES
} = require('./config.js');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const BOT_START_TIME = Date.now();

// ==================== [ PERBAIKAN: DEFAULT DATA ] ====================
// Menambahkan properti 'ceo', 'settings', dan 'user_group_count' ke defaultData 
// untuk menghindari error jika data.json belum ada atau kosong.
const defaultData = {
  premium: {},
  owner: OWNER_IDS,
  groups: [],
  users: [],
  blacklist: [],
  ceo: [],
  settings: {
    cooldown: { default: 15 },
    maintenance: false
  },
  user_group_count: {}
};

const getUptime = () => {
  const uptimeSeconds = process.uptime();
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = Math.floor(uptimeSeconds % 60);

  return `${hours}h ${minutes}m ${seconds}s`;
};

function getRandomImage() {
  return MENU_IMAGES[Math.floor(Math.random() * MENU_IMAGES.length)];
}

// Menggunakan merge dengan defaultData untuk memastikan semua kunci ada
function loadData() {
  try {
    const file = fs.readFileSync(DATA_FILE, 'utf8');
    const loadedData = JSON.parse(file);
    // Merge loaded data with defaultData to prevent missing keys
    return { 
      ...defaultData, 
      ...loadedData,
      // Pastikan properti yang harus Array tetap Array,
      owner: Array.isArray(loadedData.owner) ? loadedData.owner : defaultData.owner,
      groups: Array.isArray(loadedData.groups) ? loadedData.groups : defaultData.groups,
      users: Array.isArray(loadedData.users) ? loadedData.users : defaultData.users,
      blacklist: Array.isArray(loadedData.blacklist) ? loadedData.blacklist : defaultData.blacklist,
      ceo: Array.isArray(loadedData.ceo) ? loadedData.ceo : defaultData.ceo,
      settings: loadedData.settings || defaultData.settings,
    };
  } catch {
    return defaultData;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function isMainOwner(id) {
  return Array.isArray(OWNER_IDS) && OWNER_IDS.map(String).includes(String(id));
}

function isAdditionalOwner(id) {
  const data = loadData();
  const idStr = String(id);
  // Tambahkan OWNER_IDS ke data.owner agar ID utama juga terhitung jika dipanggil
  const allOwners = [...new Set([...(data.owner || []), ...OWNER_IDS.map(String)])];
  return allOwners.map(String).includes(idStr);
}

function isCEO(id) {
  const data = loadData();
  return Array.isArray(data.ceo) && data.ceo.map(String).includes(String(id));
}

function isAnyOwner(id) {
  return isMainOwner(id) || isAdditionalOwner(id) || isCEO(id);
}


function isOwner(id) {
  return isAnyOwner(id);
}

function isPremium(id) {
  const data = loadData();
  const exp = data.premium[id];
  if (!exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec < exp;
}

function isMaintenance() {
  const data = loadData();
  return data.settings?.maintenance === true;
}

function setMaintenance(state) {
  const data = loadData();
  if (!data.settings) data.settings = {};
  data.settings.maintenance = state;
  saveData(data);
}

async function requireNotMaintenance(msg) {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (isMaintenance() && !isMainOwner(userId)) {
    await bot.sendMessage(chatId, `
<blockquote>⚙️ 𝗠𝗮𝗶𝗻𝘁𝗲𝗻𝗮𝗻𝗰𝗲 𝗠𝗼𝗱𝗲</blockquote>
Hai <b>${msg.from.first_name}</b>  
Saat ini bot sedang dalam proses <b>perawatan sistem</b> untuk peningkatan performa dan stabilitas 💫  

🔒 <b>Status:</b> Hanya <i>Owner Utama</i> yang dapat menggunakan bot sementara waktu.  
Mohon bersabar, ya — bot akan segera kembali aktif seperti semula ⚡  

<blockquote>✨ HanzPiwTechnical ☇ Jasher Bot°</blockquote>
`, { parse_mode: "HTML" });
    return false;
  }

  return true;
}

function getGlobalCooldownMinutes() {
  const data = loadData();
  if (data.settings && data.settings.cooldown && typeof data.settings.cooldown.default === 'number') {
    return data.settings.cooldown.default;
  }
  return 15;
}

function getGlobalCooldownMs() {
  return getGlobalCooldownMinutes() * 60 * 1000;
}

async function requireNotBlacklisted(msg) {
  const userId = msg.from.id;

  if (isBlacklisted(userId)) {
    await bot.sendMessage(userId, `
<blockquote>⛔ 𝗔𝗸𝘀𝗲𝘀 𝗗𝗶𝘁𝗼𝗹𝗮𝗸</blockquote>
Hai <b>${msg.from.first_name}</b> 👋  
Maaf ya, kamu tidak bisa menggunakan bot ini karena <b>terdaftar dalam daftar blacklist</b> 🔒  

Jika kamu merasa ini adalah kesalahan atau ingin mengajukan banding,  
silakan hubungi developer melalui menu <b>⁉️ Hubungi Developer</b> untuk peninjauan ulang.

<blockquote>✨ HanzPiwTechnical ☇ Jasher Bot°</blockquote>
`, { parse_mode: "HTML" });
    return false;
  }

  return true;
}

function isBlacklisted(userId) {
  const data = loadData();
  return Array.isArray(data.blacklist) && data.blacklist.map(String).includes(String(userId));
}

const { writeFileSync, existsSync, mkdirSync } = require('fs');

function backupData() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = './backup';
  const backupPath = `${backupDir}/data-${timestamp}.json`;

  if (!existsSync(backupDir)) mkdirSync(backupDir);
  if (!existsSync(DATA_FILE)) return null;
  const content = fs.readFileSync(DATA_FILE);
  writeFileSync(backupPath, content);

  return backupPath;
}

// === HANDLE BOT DITAMBAHKAN / DIKELUARKAN ===
bot.on("my_chat_member", async (msg) => {
  try {
    const data = loadData();
    const chat = msg.chat || msg.chat_member?.chat;
    const user = msg.from;
    const status = msg.new_chat_member?.status;
    const chatId = chat?.id;
    const userId = user?.id.toString(); // Gunakan toString()

    if (!chat || !user || !status || !chatId || !userId) return;

    const isGroup = ["group", "supergroup"].includes(chat.type);
    const mainOwner = OWNER_IDS[0];

    const now = Math.floor(Date.now() / 1000);

    // === BOT DITAMBAHKAN ===
    if (["member", "administrator"].includes(status)) {
      if (isGroup && !data.groups.includes(chatId)) {
        data.groups.push(chatId);
        
        // Memastikan user_group_count ada
        if (!data.user_group_count) data.user_group_count = {};
        
        data.user_group_count[userId] = (data.user_group_count[userId] || 0) + 1;
        const total = data.user_group_count[userId];

        let memberCount = 0;
        try {
          memberCount = await bot.getChatMemberCount(chatId).catch(() => 0);
        } catch {
          memberCount = 0;
        }

        if (memberCount >= 10) {

          let durasiHari = 0;
          if (total >= 10) durasiHari = 3650;
          
          else if (total >= 8) durasiHari = 7;
          else if (total >= 6) durasiHari = 5;
          else if (total >= 4) durasiHari = 3;
          else if (total >= 2) durasiHari = 1;

          let durasiDetik = durasiHari * 86400;
          
          // Memastikan premium ada
          if (!data.premium) data.premium = {};
          
          const current = data.premium[userId] || now;
          data.premium[userId] =
            durasiHari >= 3650
              ? now + durasiDetik
              : current > now
              ? current + durasiDetik
              : now + durasiDetik;

          bot.sendMessage(
            userId,
            durasiHari >= 3650
              ? `🎉 Kamu berhasil menambahkan bot ke *${total} grup (≥20 member)*!\n✅ Premium aktif *PERMANEN*!`
              : `🎉 Kamu berhasil menambahkan bot ke *${total} grup (≥20 member)*!\n✅ Premium aktif *${durasiHari} hari*!`,
            { parse_mode: "Markdown" }
          ).catch(() => {});

          const info = `
<b>➕ Bot Ditambahkan Ke Grup Baru!</b>

▢ <b>Pengguna:</b> <a href="tg://user?id=${userId}">${user.first_name}</a>
▢ <b>ID User:</b> <code>${userId}</code>
▢ <b>Username:</b> @${user.username || "-"}
▢ <b>Grup:</b> ${chat.title}
▢ <b>ID Grup:</b> <code>${chatId}</code>
▢ <b>Member Grup:</b> ${memberCount}
▢ <b>Reward:</b> ${durasiHari >= 3650 ? "PERMANEN" : `${durasiHari} Hari`}
          `.trim();

          await bot.sendMessage(mainOwner, info, { parse_mode: "HTML" }).catch(() => {});

          const backupPath = backupData();
          if (backupPath) {
            await bot.sendDocument(mainOwner, backupPath, {
              caption: "Data backup otomatis"
            }).catch(() => {});
          }
        } else {
          bot.sendMessage(
            userId,
            `⚠️ Grup *${chat.title}* hanya punya ${memberCount} member.\n❌ Minimal 20 member.`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }

        await saveData(data);
      }
    }

    // === BOT DIKELUARKAN ===
    if (["left", "kicked", "banned", "restricted"].includes(status)) {
      if (isGroup && data.groups.includes(chatId)) {
        data.groups = data.groups.filter((id) => id !== chatId);

        if (data.user_group_count && data.user_group_count[userId]) {
          data.user_group_count[userId] = Math.max(0, data.user_group_count[userId] - 1);

          if (data.user_group_count[userId] < 2) {
            // Memastikan premium ada
            if (data.premium) delete data.premium[userId];
            
            bot.sendMessage(
              userId,
              `❌ Kamu menghapus bot dari grup.\n🔒 Premium otomatis dicabut.`,
              { parse_mode: "Markdown" }
            ).catch(() => {});
          }

          let memberCount = 0;
          try {
            memberCount = await bot.getChatMemberCount(chatId).catch(() => 0);
          } catch {
            memberCount = 0;
          }

          const info = `
<b>⚠️ Bot Dikeluarkan Dari Grup!</b>

▢ <b>Pengguna:</b> <a href="tg://user?id=${userId}">${user.first_name}</a>
▢ <b>ID User:</b> <code>${userId}</code>
▢ <b>Username:</b> @${user.username || "-"}
▢ <b>Grup:</b> ${chat.title}
▢ <b>ID Grup:</b> <code>${chatId}</code>
▢ <b>Member Grup:</b> ${memberCount}
          `.trim();

          await bot.sendMessage(mainOwner, info, { parse_mode: "HTML" }).catch(() => {});

          const backupPath = backupData();
          if (backupPath) {
            await bot.sendDocument(mainOwner, backupPath, {
              caption: "Data backup otomatis"
            }).catch(() => {});
          }
        }

        await saveData(data);
      }
    }
  } catch (err) {
    console.error("❌ Error my_chat_member:", err);
  }
});

setInterval(() => {
  const data = loadData();
  const now = Math.floor(Date.now() / 1000);

  // Memastikan premium ada
  if (!data.premium) data.premium = {};
  
  for (const uid in data.premium) {
    if (data.premium[uid] <= now) {
      delete data.premium[uid];
      console.log(`🔒 Premium expired & dicabut untuk ${uid}`);

      bot.sendMessage(uid, `
<blockquote>💎 𝗣𝗿𝗲𝗺𝗶𝘂𝗺 𝗘𝘅𝗽𝗶𝗿𝗲𝗱</blockquote>
Halo <b>Pengguna Bot jasher HanzPiwTechnical ☇</b>
Masa aktif <b>Premium</b> kamu telah <b>berakhir</b> dan otomatis dicabut ⏳  

Jangan khawatir!  
Kamu masih bisa memperpanjang akses premium dan menikmati fitur spesial seperti:
• 🚀 Share & Broadcast ke grup  
• 💬 Hubungi developer langsung  
• 🧩 Tools eksklusif hanya untuk pengguna premium  

Tekan tombol di bawah ini untuk memperbarui aksesmu 💎👇
`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💎 Perpanjang Premium", url: `https://t.me/hanzpiwofc${DEVELOPER.replace('@hanzpiwofc', '')}` }],
            [{ text: "📢 Channel Info", url: `https://t.me/abouthanzxxhanzpiw${CHANNEL_USERNAME.replace('@abouthanzxxhanzpiw', '')}` }]
          ]
        }
      }).catch(() => {});
    }
  }

  saveData(data);
}, 60 * 1000);

async function checkChannelMembership(userId) {
  try {
    const chatMember = await bot.getChatMember(CHANNEL_USERNAME, userId);
    return ["member", "administrator", "creator"].includes(chatMember.status);
  } catch (err) {
    return false;
  }
}

async function requireJoin(msg) {
  const userId = msg.from.id;
  const isMember = await checkChannelMembership(userId);

  if (!isMember) {
    await bot.sendMessage(userId, `
<blockquote>🚫 𝗔𝗸𝘀𝗲𝘀 𝗗𝗶𝘁𝗼𝗹𝗮𝗸</blockquote>
Hai <b>${msg.from.first_name}</b> 
Kamu belum bergabung ke channel resmi kami!

Silakan join terlebih dahulu melalui tombol di bawah ini  
untuk bisa menggunakan semua fitur bot Jasher HanzPiwTechnical ☇ secara penuh ✨
`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Gabung Channel Resmi", url: `https://t.me/abouthanzxxhanzpiw${CHANNEL_USERNAME.replace('@abouthanzxxhanzpiw','')}` }],
          [{ text: "🔁 Sudah Gabung, Cek Lagi", callback_data: "check_join_again" }]
        ]
      }
    });
    return false;
  }

  return true;
}

function withRequireJoin(handler) {
  return async (msg, match) => {
    const ok = await requireJoin(msg);
    if (!ok) return;
    return handler(msg, match);
  };
}

bot.on("callback_query", async (query) => {
  const userId = query.from.id;

  if (query.data === "check_join_again") {
    const isMember = await checkChannelMembership(userId);

    if (isMember) {
      await bot.sendMessage(userId, `
✅ <b>Terima kasih!</b>  
Kamu sudah bergabung di channel kami 💫  
Sekarang kamu bisa menikmati semua fitur bot Jasher HanzPiwTechnical ☇ Jaseb Bot°.
`, { parse_mode: "HTML" });
    } else {
      await bot.sendMessage(userId, `
⚠️ <b>Kamu belum bergabung di channel.</b>  
Silakan tekan tombol <b>📢 Gabung Channel Resmi</b> dan coba lagi setelah join 🌙
`, { parse_mode: "HTML" });
    }

    await bot.answerCallbackQuery(query.id);
  }
});

async function replaceMenu(chatId, caption, buttons) {
  try {
  
    if (activeMenus[chatId]) {
      try {
        await bot.deleteMessage(chatId, activeMenus[chatId]);
      } catch (e) {
      
      }
      delete activeMenus[chatId];
    }

    const sent = await bot.sendPhoto(chatId, getRandomImage(), {
      caption,
      parse_mode: "HTML",
      reply_markup: buttons
    });

    activeMenus[chatId] = sent.message_id;
  } catch (err) {
    console.error("replaceMenu error:", err);
  }
}

// ==================== START ====================
bot.onText(/\/start/, withRequireJoin(async (msg) => {
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;
  const data = loadData();
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const waktuRunPanel = getUptime();
  const username = msg.from.username ? `@${msg.from.username}` : "Tidak ada username";
  if ((msg.date * 1000) < BOT_START_TIME) return;

  if (!data.users.includes(userId)) {
    data.users.push(userId);
    saveData(data);
  }

  const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
<b>⌜ D A T A ☇ B O T ⌟</b>
<b>▢ Developer :</b> ${DEVELOPER}
<b>▢ Name bot :</b> HanzPiwTechnical ☇ Jasher Bot°
<b>▢ Version :</b> 1.7
<b>▢ Prefixes :</b> /
<b>▢ Statistic Bot :</b> <code>${data.groups.length}</code> Group / <code>${data.users.length}</code> Users
<b>▢ Uptime :</b> <code>${waktuRunPanel}</code>
<blockquote>✨ BotCreated By @hanzpiwofc</blockquote>
`;

  await replaceMenu(chatId, caption, {
    keyboard: [
      [{ text: "✨ Jasher Menu" }, { text: "📊 Status Akun" }, { text: "💎 Owner Menu" }],
      [{ text: "🧩 Tools Menu" }, { text: "🎉 Thanks To" }],
      [{ text: "⁉️ Hubungi Developer" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  });
}));
// ==================== MAIN MENU ====================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text = msg.text;
  const data = loadData();
  const waktuRunPanel = getUptime();
  const username = msg.from.username ? `@${msg.from.username}` : "Tidak ada username";
  const ownerIdUtama = OWNER_IDS[0];

  if (["🔙 Kembali", "✨ Jasher Menu", "💎 Owner Menu", "🧩 Tools Menu", "🎉 Thanks To", "📊 Status Akun", "⁉️ Hubungi Developer"].includes(text)) {
    // Coba hapus pesan menu yang lama
    if (activeMenus[chatId]) {
      bot.deleteMessage(chatId, activeMenus[chatId]).catch(() => {});
      delete activeMenus[chatId];
    }
    // Hapus pesan perintah
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
  }

  // ==================== MAIN MENU (KEMBALI) ====================
  if (text === "🔙 Kembali") {
    const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
<b>⌜ D A T A ☇ B O T ⌟</b>
<b>▢ Developer :</b> ${DEVELOPER}
<b>▢ Name bot :</b> HanzPiwTechnical ☇ Jasher Bot°
<b>▢ Version :</b> 1.7
<b>▢ Prefixes :</b> /
<b>▢ Statistic Bot :</b> <code>${data.groups.length}</code> Group / <code>${data.users.length}</code> Users
<b>▢ Uptime :</b> <code>${waktuRunPanel}</code>
<blockquote>✨ BotCreated By @hanzpiwofc</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [
        [{ text: "✨ Jasher Menu" }, { text: "📊 Status Akun" }, { text: "💎 Owner Menu" }],
        [{ text: "🧩 Tools Menu" }, { text: "🎉 Thanks To" }],
        [{ text: "⁉️ Hubungi Developer" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // ==================== THANKS TO ====================
  if (text === "🎉 Thanks To") {
    const caption = `
<blockquote>𝐃 𝐄 𝐕 𝐄 𝐋 𝐎 𝐏 𝐄 𝐑</blockquote>
• @hanzpiwofc / Developer
<blockquote>✨ Created By @hanzpiwofc</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [[{ text: "🔙 Kembali" }]],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // ==================== 💎 Plans Owner ====================
  if (text === "💎 Owner Menu") {
    if (!isAnyOwner(userId)) {
      return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!");
    }
    const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
<b>⌜ D A T A ☇ B O T ⌟</b>
<b>▢ Developer :</b> ${DEVELOPER}
<b>▢ Name bot :</b> HanzPiwTechnical ☇ Jasher Bot°
<b>▢ Version :</b> 1.7
<b>▢ Prefixes :</b> /
<b>▢ Statistic Bot :</b> <code>${data.groups.length}</code> Group / <code>${data.users.length}</code> Users
<b>▢ Uptime :</b> <code>${waktuRunPanel}</code>
<blockquote>💎 𝐂 𝐎 𝐌 𝐌 𝐄 𝐍 𝐃 ☇ 𝐎 𝐖 𝐍 𝐄 𝐑</blockquote>
• /addbl
• /delbl
• /listbl
• /addceo
• /delceo
• /listceo
• /addownjs
• /delownjs
• /listownjs
• /addakses
• /delakses
• /listakses
<blockquote>✨ Created By @hanzpiwofc</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [[{ text: "🔙 Kembali" }]],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // ==================== 🧩 Tools Menu ====================
  if (text === "🧩 Tools Menu") {
    const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
<b>⌜ D A T A ☇ B O T ⌟</b>
<b>▢ Developer :</b> ${DEVELOPER}
<b>▢ Name bot :</b> HanzPiwTechnical ☇ Jasher Bot°
<b>▢ Version :</b> 1.7
<b>▢ Prefixes :</b> /
<b>▢ Statistic Bot :</b> <code>${data.groups.length}</code> Group / <code>${data.users.length}</code> Users
<b>▢ Uptime :</b> <code>${waktuRunPanel}</code>
<blockquote>🧩 𝐂 𝐎 𝐌 𝐌 𝐄 𝐍 𝐃 ☇ 𝐓 𝐎 𝐎 𝐋 S</blockquote>
• /setmaintenance 
• /updatefile
• /ping
• /tourl
• /done
• /cekid
• /backup
<blockquote>✨ Created By @hanzpiwofc</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [[{ text: "🔙 Kembali" }]],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // ==================== ✨ Jasher Menu ====================
  if (text === "✨ Jasher Menu") {
    const caption = `
<blockquote>( 🍁 ) - 情報 𝗢𝗹𝗮𝗮 ${username}</blockquote>
<b>⌜ D A T A ☇ B O T ⌟</b>
<b>▢ Developer :</b> ${DEVELOPER}
<b>▢ Name bot :</b> HanzPiwTechnical ☇ Jasher Bot°
<b>▢ Version :</b> 1.7
<b>▢ Prefixes :</b> /
<b>▢ Statistic Bot :</b> <code>${data.groups.length}</code> Group / <code>${data.users.length}</code> Users
<b>▢ Uptime :</b> <code>${waktuRunPanel}</code>
<blockquote>✨ 𝐂 𝐎 𝐌 𝐌 𝐄 𝐍 𝐃 ☇ 𝐉 𝐀 𝐒 𝐇 𝐄 𝐑</blockquote>
• /auto on / off
• /auto status 
• /setpesan
• /sharemsg
• /broadcast
• /setjeda
<blockquote>✨ Created By @hanzpiwofc</blockquote>
`;
    return replaceMenu(chatId, caption, {
      keyboard: [[{ text: "🔙 Kembali" }]],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // ==================== 📊 Status Akun ====================
  if (text === "📊 Status Akun") {
    const isMain = isMainOwner(userId);
    const isOwnerNow = isAnyOwner(userId);
    const isPremiumUser =
      data.premium?.[userId] && Math.floor(Date.now() / 1000) < data.premium[userId];
    const exp =
      data.premium?.[userId] && Math.floor(Date.now() / 1000) < data.premium[userId]
        ? new Date(data.premium[userId] * 1000)
        : null;

    let status = "Tidak Premium";
    if (isMain) status = "Pemilik";
    else if (isOwnerNow) status = "Owner";
    else if (isPremiumUser) status = "Premium";

    const expDate = exp ? exp.toLocaleString("id-ID") : "None";

    const caption = `
<blockquote>HanzPiwTechnical ☇ Jasher Bot°</blockquote>
<b>Name :</b> ${msg.from.first_name || "User"}
<b>Status :</b> ${status}
<b>Prefixes :</b> /
<b>Tanggal Kedaluwarsa :</b> ${expDate}
<b>Uptime :</b> ${waktuRunPanel}
<blockquote>✨ Created By @hanzpiwofc</blockquote>
`;

    return replaceMenu(chatId, caption, {
      keyboard: [[{ text: "🔙 Kembali" }]],
      resize_keyboard: true,
      one_time_keyboard: false
    });
  }

  // ==================== 💬 HUBUNGI DEVELOPER ====================
  if (text === "⁉️ Hubungi Developer") {
    chatSessions[userId] = { active: true, ownerId: ownerIdUtama };

    await bot.sendMessage(chatId, `
<blockquote>🌙 Sesi Obrolan HanzPiwTechnical ☇</blockquote>
Hai <b>${username}</b> 🍂  
Silakan tulis pesanmu untuk developer di sini —  
pesanmu akan dikirim langsung secara pribadi ke pusat Developer.  

Jika kamu ingin menutup sesi ini, cukup tekan tombol di bawah 👇
`, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [[{ text: "❌ Batalkan Sesi" }]],
        resize_keyboard: true
      }
    });

    return;
  }

  // === BATALKAN ===
  if (text === "❌ Batalkan Sesi" && chatSessions[userId]?.active) {
    delete chatSessions[userId];
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    await bot.sendMessage(chatId, `
<blockquote>❌ 𝗦𝗲𝘀𝗶 𝗢𝗯𝗿𝗼𝗹𝗮𝗻 𝗗𝗶𝘁𝘂𝘁𝘂𝗽</blockquote>
Terima kasih sudah menghubungi developer  
Semoga pesanmu sudah tersampaikan dengan baik.

🔙 Tekan tombol di bawah untuk kembali ke menu utama.
`, {
      parse_mode: "HTML",
      reply_markup: {
        keyboard: [[{ text: "🔙 Kembali" }]],
        resize_keyboard: true
      }
    });
    return;
  }

  // === KIRIM PESAN KE ADMIN ===
  if (chatSessions[userId]?.active) {
    const ownerId = chatSessions[userId].ownerId;
    try {
      await bot.forwardMessage(ownerId, chatId, msg.message_id);
      await bot.sendMessage(chatId, `
💌 Pesanmu sudah terkirim ke developer.
Mohon bersabar yaa 🍂  
developer akan segera membalas pesanmu ✨
`, { parse_mode: "HTML" });
    } catch (err) {
      delete chatSessions[userId];
      return bot.sendMessage(chatId, `
⚠️ Terjadi kesalahan saat mengirim pesan ke Developer.  
Sesi chat otomatis ditutup.`, { parse_mode: "HTML" });
    }
    return;
  }

  // === OWNER BALAS USER (OWNER ➜ USER) ===
  if (isAnyOwner(userId) && msg.reply_to_message) {
    const replied = msg.reply_to_message;
    const fwdFrom = replied.forward_from;
    let targetUserId;

    if (fwdFrom) {
      targetUserId = fwdFrom.id.toString();
    } else if (replied.text?.includes("tg://user?id=")) {
      const match = replied.text.match(/tg:\/\/user\?id=(\d+)/);
      if (match) targetUserId = match[1];
    }

    if (targetUserId && chatSessions[targetUserId]?.active) {
      try {

        if (msg.text) await bot.sendMessage(targetUserId, msg.text);
        else if (msg.photo) await bot.sendPhoto(targetUserId, msg.photo[msg.photo.length - 1].file_id, { caption: msg.caption || "" });
        else if (msg.document) await bot.sendDocument(targetUserId, msg.document.file_id, { caption: msg.caption || "" });
        else if (msg.video) await bot.sendVideo(targetUserId, msg.video.file_id, { caption: msg.caption || "" });
        else if (msg.sticker) await bot.sendSticker(targetUserId, msg.sticker.file_id);

        await bot.sendMessage(userId, `
✅ Pesanmu berhasil dikirim ke pengguna   
Kamu bisa lanjut ngobrol dengan pengguna ini.`,
        { parse_mode: "HTML", reply_to_message_id: msg.message_id });
      } catch (e) {
        await bot.sendMessage(userId, `
⚠️ Gagal mengirim pesan ke pengguna.  
Kemungkinan pengguna sudah menutup sesi.`,
        { parse_mode: "HTML" });
      }
    }
  }
});

// === /sharemsg ===
bot.onText(/^\/sharemsg$/, async (msg) => {
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;
  const senderId = msg.from.id.toString();
  const data = loadData();
  const chatId = msg.chat.id;

  try {
    const isMain = isMainOwner(senderId);
    const isOwnerNow = isAnyOwner(senderId);
    const isPremiumUser = data.premium?.[senderId] && Math.floor(Date.now() / 1000) < data.premium[senderId];
    const groupCount = data.user_group_count?.[senderId] || 0;

    if (!isOwnerNow && !isPremiumUser && groupCount < 2) {
      return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya User Premium Yang Bisa Menggunakan Perintah Ini!").catch(() => {});
    }

    if (!data.cooldowns) data.cooldowns = {};
    if (!data.cooldowns.share) data.cooldowns.share = {};
    const now = Math.floor(Date.now() / 1000);
    const lastUse = data.cooldowns.share[senderId] || 0;
    const cooldown = getGlobalCooldownMinutes() * 30;

    if (!isMain && (now - lastUse) < cooldown) {
      const sisa = cooldown - (now - lastUse);
      const menit = Math.floor(sisa / 30);
      const detik = sisa % 30;
      return bot.sendMessage(chatId, `🕒 Tunggu ${menit} menit ${detik} detik sebelum menggunakan /sharemsg lagi.`).catch(() => {});
    }

    if (!msg.reply_to_message) {
      return bot.sendMessage(chatId, "⚠️ Harap *reply* ke pesan yang ingin kamu bagikan.", { parse_mode: "Markdown" }).catch(() => {});
    }

    if (!isMain) {
      data.cooldowns.share[senderId] = now;
      saveData(data);
    }

    const groups = data.groups || [];
    if (groups.length === 0) {
      return bot.sendMessage(chatId, "⚠️ Tidak ada grup terdaftar untuk share.").catch(() => {});
    }

    const total = groups.length;
    let sukses = 0, gagal = 0;
    await bot.sendMessage(chatId, `📡 Memproses sharemsg ke *${total}* grup/channel...`, { parse_mode: "Markdown" }).catch(() => {});
    const reply = msg.reply_to_message;

    // 🏷️ Tambahkan identitas pengirim
    const username = msg.from.username
      ? `@${msg.from.username}`
      : `${msg.from.first_name || "User"} (ID: ${senderId})`;
    const tagHeader = `👤 SHARE BY: ${username}\n\n`;

    for (const groupId of groups) {
      try {
        if (reply.text) {
          const teks = tagHeader + reply.text;
          await bot.sendMessage(groupId, teks, { parse_mode: "Markdown" }).catch(() =>
            bot.sendMessage(groupId, teks).catch(() => {})
          );
        } else if (reply.photo) {
          const fileId = reply.photo[reply.photo.length - 1].file_id;
          const caption = tagHeader + (reply.caption || "");
          await bot.sendPhoto(groupId, fileId, { caption, parse_mode: "Markdown" }).catch(() => {});
        } else if (reply.video) {
          const caption = tagHeader + (reply.caption || "");
          await bot.sendVideo(groupId, reply.video.file_id, { caption, parse_mode: "Markdown" }).catch(() => {});
        } else if (reply.document) {
          const caption = tagHeader + (reply.caption || "");
          await bot.sendDocument(groupId, reply.document.file_id, { caption }).catch(() => {});
        } else if (reply.sticker) {
          await bot.sendMessage(groupId, tagHeader).catch(() => {});
          await bot.sendSticker(groupId, reply.sticker.file_id).catch(() => {});
        } else {
          await bot.sendMessage(groupId, tagHeader + "⚠️ Jenis pesan ini belum didukung untuk sharemsg otomatis.").catch(() => {});
        }
        sukses++;
      } catch {
        gagal++;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    await bot.sendMessage(chatId, `
✅ Share Selesai!
📊 Hasil:
• Total Grup: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()).catch(() => {});
  } catch (err) {
    console.error("❌ Error fatal di /sharemsg:", err);
    bot.sendMessage(chatId, "⚠️ Terjadi error saat memproses /sharemsg.").catch(() => {});
  }
});

// === /broadcast ===
bot.onText(/^\/broadcast$/, async (msg) => {
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;
  const senderId = msg.from.id.toString();
  const data = loadData();
  const chatId = msg.chat.id;

  try {
    const isMain = isMainOwner(senderId);
    const isOwnerNow = isAnyOwner(senderId);

    if (!isOwnerNow) {
      return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!").catch(() => {});
    }

    if (!data.cooldowns) data.cooldowns = {};
    if (!data.cooldowns.broadcast) data.cooldowns.broadcast = {};
    const now = Math.floor(Date.now() / 1000);
    const lastUse = data.cooldowns.broadcast[senderId] || 0;
    const cooldown = getGlobalCooldownMinutes() * 30;

    if (!isMain && (now - lastUse) < cooldown) {
      const sisa = cooldown - (now - lastUse);
      const menit = Math.floor(sisa / 30);
      const detik = sisa % 30;
      return bot.sendMessage(chatId, `🕒 Tunggu ${menit} menit ${detik} detik sebelum menggunakan /broadcast lagi.`).catch(() => {});
    }

    if (!msg.reply_to_message) {
      return bot.sendMessage(chatId, "⚠️ Harap *reply* ke pesan yang ingin dibroadcast.", { parse_mode: "Markdown" }).catch(() => {});
    }

    if (!isMain) {
      data.cooldowns.broadcast[senderId] = now;
      saveData(data);
    }

    const uniqueUsers = [...new Set(data.users || [])];
    const total = uniqueUsers.length;
    let sukses = 0, gagal = 0;
    await bot.sendMessage(chatId, `📡 Sedang memulai broadcast ke *${total}* user...`, { parse_mode: "Markdown" }).catch(() => {});
    const reply = msg.reply_to_message;

    // 🏷️ Tambahkan identitas pengirim
    const username = msg.from.username
      ? `@${msg.from.username}`
      : `${msg.from.first_name || "User"} (ID: ${senderId})`;
    const tagHeader = `👤 SHARE BY: ${username}\n\n`;

    for (const userId of uniqueUsers) {
      try {
        if (reply.text) {
          const teks = tagHeader + reply.text;
          await bot.sendMessage(userId, teks, { parse_mode: "Markdown" }).catch(() =>
            bot.sendMessage(userId, teks).catch(() => {})
          );
        } else if (reply.photo) {
          const fileId = reply.photo[reply.photo.length - 1].file_id;
          const caption = tagHeader + (reply.caption || "");
          await bot.sendPhoto(userId, fileId, { caption, parse_mode: "Markdown" }).catch(() => {});
        } else if (reply.document) {
          const caption = tagHeader + (reply.caption || "");
          await bot.sendDocument(userId, reply.document.file_id, { caption }).catch(() => {});
        } else if (reply.video) {
          const caption = tagHeader + (reply.caption || "");
          await bot.sendVideo(userId, reply.video.file_id, { caption, parse_mode: "Markdown" }).catch(() => {});
        } else {
          await bot.sendMessage(userId, tagHeader + "⚠️ Jenis pesan ini belum bisa dibroadcast.").catch(() => {});
        }
        sukses++;
      } catch {
        gagal++;
      }
      await new Promise(r => setTimeout(r, 300));
    }

    await bot.sendMessage(chatId, `
✅ Broadcast Selesai!
📊 Hasil:
• Total User: ${total}
• ✅ Sukses: ${sukses}
• ❌ Gagal: ${gagal}
    `.trim()).catch(() => {});
  } catch (err) {
    console.error("❌ Error fatal di /broadcast:", err);
    bot.sendMessage(chatId, "⚠️ Terjadi error saat memproses /broadcast.").catch(() => {});
  }
})

// === /setpesan ===
bot.onText(/^\/setpesan$/, async (msg) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isAnyOwner(senderId)) {
    return bot.sendMessage(chatId, "⛔ Hanya Owner yang bisa set pesan.");
  }
  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, "⚠️ Harap *reply* ke pesan yang ingin dijadikan auto-share.", { parse_mode: "Markdown" });
  }

  const reply = msg.reply_to_message;
  let content = null;

  if (reply.text) {
    content = { type: "text", text: reply.text };
  } else if (reply.photo) {
    content = { type: "photo", file_id: reply.photo[reply.photo.length - 1].file_id, caption: reply.caption || "" };
  } else if (reply.video) {
    content = { type: "video", file_id: reply.video.file_id, caption: reply.caption || "" };
  } else if (reply.document) {
    content = { type: "document", file_id: reply.document.file_id, caption: reply.caption || "" };
  } else if (reply.sticker) {
    content = { type: "sticker", file_id: reply.sticker.file_id };
  }

  if (!content) {
    return bot.sendMessage(chatId, "⚠️ Jenis pesan ini belum didukung autoshare.");
  }

  autoShares[senderId] = { active: false, content, lastSent: 0 };
  return bot.sendMessage(chatId, "✅ Pesan berhasil disimpan untuk auto-share (akan dikirim ulang oleh bot).");
});

// === /auto on/off/status ===
bot.onText(/^\/auto\s*(on|off|status)?$/, async (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isAnyOwner(senderId)) {
    return bot.sendMessage(chatId, "⛔ Hanya Owner yang bisa kontrol auto-share.");
  }
  if (!autoShares[senderId]) {
    autoShares[senderId] = { active: false, content: null, lastSent: 0 };
  }

  const arg = match[1];
  if (!arg || arg === "status") {
    const status = autoShares[senderId].active ? "ON ✅" : "OFF ❌";
    const pesanExist = autoShares[senderId].content ? "Ada" : "Belum di-set";
    const cooldownMenit = getGlobalCooldownMinutes();
    
    return bot.sendMessage(chatId, 
      `📊 Status auto-share: *${status}*\n` + 
      `📝 Pesan: *${pesanExist}*\n` +
      `⏱️ Jeda: *${cooldownMenit} menit*`, 
      { parse_mode: "Markdown" }
    );
  }

  if (arg === "on") {
    if (!autoShares[senderId].content) {
      return bot.sendMessage(chatId, "⚠️ Belum ada pesan di-set. Gunakan /setpesan dengan reply pesan dulu.");
    }
    autoShares[senderId].active = true;
    autoShares[senderId].lastSent = Date.now();
    return bot.sendMessage(chatId, "🔄 Auto-share dimulai.\nMenunggu jeda pertama sebelum pesan dikirim...");
  }

  if (arg === "off") {
    autoShares[senderId].active = false;
    return bot.sendMessage(chatId, "❌ Auto-share dimatikan.");
  }
});

// === Loop pengiriman otomatis ===
setInterval(async () => {
  try {
    const data = loadData();
    const groups = data.groups || [];
    if (groups.length === 0) return;

    const now = Date.now();
    const cooldownMs = getGlobalCooldownMs();

    for (const ownerId of Object.keys(autoShares)) {
      const conf = autoShares[ownerId];
      if (!conf.active || !conf.content) continue;
      if (now - conf.lastSent < cooldownMs) continue;

      conf.lastSent = now;
      const content = conf.content;
      let sukses = 0, gagal = 0;

      for (const groupId of groups) {
        try {
          // Hanya tambahkan footer jika pesan berisi teks/caption
          let footer = `\n\n~~ Autoshare By ${DEVELOPER} ~~`;
          
          if (content.type === "text") {
            const textSend = content.text + footer;
            await bot.sendMessage(groupId, textSend, { parse_mode: "Markdown" }).catch(() =>
              bot.sendMessage(groupId, textSend)
            );
          } else if (content.type === "photo") {
            const caption = (content.caption || "") + footer;
            await bot.sendPhoto(groupId, content.file_id, { caption, parse_mode: "Markdown" }).catch(() => {});
          } else if (content.type === "video") {
            const caption = (content.caption || "") + footer;
            await bot.sendVideo(groupId, content.file_id, { caption, parse_mode: "Markdown" }).catch(() => {});
          } else if (content.type === "document") {
            const caption = (content.caption || "") + footer;
            await bot.sendDocument(groupId, content.file_id, { caption }).catch(() => {});
          } else if (content.type === "sticker") {
            // Untuk stiker, kirim footer di pesan terpisah atau abaikan footer
            await bot.sendSticker(groupId, content.file_id).catch(() => {});
          }
          sukses++;
        } catch {
          gagal++;
        }
        await new Promise((r) => setTimeout(r, 300)); 
      }

      console.log(`Auto-share owner ${ownerId}: sukses ${sukses}, gagal ${gagal}`);
    }
  } catch (e) {
    console.error("❌ Error di auto-share loop:", e);
  }
}, 10 * 1000); 


// === /setjeda ===
bot.onText(/^\/setjeda(?:\s+(\d+))?$/, async (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;
  
  if (!isAnyOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!").catch(() => {});
  }

  const data = loadData();
  if (!data.settings) data.settings = {};
  if (!data.settings.cooldown) data.settings.cooldown = {};

  const menit = parseInt(match[1]);
  
  if (!match[1]) {
    const current = getGlobalCooldownMinutes();
    return bot.sendMessage(chatId, `⚙️ Cooldown saat ini: *${current} menit*. Contoh: \`/setjeda 15\``, { parse_mode: "Markdown" });
  }

  if (isNaN(menit) || menit <= 0) {
    return bot.sendMessage(chatId, `⚠️ Nilai harus angka positif (menit). Contoh: \`/setjeda 15\``, { parse_mode: "Markdown" });
  }

  data.settings.cooldown.default = menit;
  saveData(data);

  return bot.sendMessage(chatId, `✅ Jeda berhasil diatur ke *${menit} menit*.`, { parse_mode: "Markdown" });
});

// === /addceo ===
bot.onText(/^\/addceo(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isMainOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Developer Yang Bisa Menggunakan Perintah Ini!");
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/addceo 123`", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();

  if (!Array.isArray(data.ceo)) data.ceo = [];

  if (!data.ceo.includes(targetId)) {
    data.ceo.push(targetId);
    saveData(data);
    bot.sendMessage(chatId, `✅ User ${targetId} berhasil ditambahkan sebagai CEO.`);
  } else {
    bot.sendMessage(chatId, `⚠️ User ${targetId} sudah jadi CEO.`);
  }
});

// === /delceo ===
bot.onText(/^\/delceo(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isMainOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Developer Yang Bisa Menggunakan Perintah Ini!");
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/delceo 123`", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();

  if (Array.isArray(data.ceo) && data.ceo.includes(targetId)) {
    data.ceo = data.ceo.filter(id => id !== targetId);
    saveData(data);
    bot.sendMessage(chatId, `✅ CEO ${targetId} berhasil dihapus.`);
  } else {
    bot.sendMessage(chatId, `⚠️ User ${targetId} tidak terdaftar sebagai CEO.`);
  }
});

// === /listceo ===
bot.onText(/^\/listceo$/, (msg) => {
  const senderId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isMainOwner(senderId)) { // Hanya Developer yang bisa melihat daftar CEO
    return bot.sendMessage(
      chatId,
      "❌ Akses Ditolak:\nHanya Developer yang bisa menggunakan perintah ini!",
      { parse_mode: "Markdown" }
    );
  }

  const data = loadData();
  const ceoList = Array.isArray(data.ceo) ? data.ceo : [];

  if (ceoList.length === 0) {
    return bot.sendMessage(chatId, "📋 Tidak ada CEO yang terdaftar.");
  }

  const teks = `📋 *Daftar CEO:*\n\n${ceoList.map((id, i) => `${i + 1}. \`${id}\``).join("\n")}`;
  bot.sendMessage(chatId, teks, { parse_mode: "Markdown" });
});

// === /addownjs ===
bot.onText(/^\/addownjs(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id;
  const chatId = msg.chat.id;
  
  if (!(isMainOwner(senderId) || isCEO(senderId))) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Ceo / Developer Yang Bisa Menggunakan Perintah Ini!");
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/addownjs 123`", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();

  if (!Array.isArray(data.owner)) data.owner = [];

  if (!data.owner.includes(targetId)) {
    data.owner.push(targetId);
    saveData(data);
    bot.sendMessage(chatId, `✅ User ${targetId} berhasil ditambahkan sebagai owner tambahan.`);
  } else {
    bot.sendMessage(chatId, `⚠️ User ${targetId} sudah menjadi owner tambahan.`);
  }
});

// === /delownjs ===
bot.onText(/^\/delownjs(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id;
  const chatId = msg.chat.id;
  
  if (!(isMainOwner(senderId) || isCEO(senderId))) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Ceo / Developer Yang Bisa Menggunakan Perintah Ini!");
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/delownjs 123``", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();

  if (OWNER_IDS.map(String).includes(String(targetId))) {
    return bot.sendMessage(chatId, `❌ Tidak bisa menghapus Owner Utama (${targetId}).`);
  }

  if (Array.isArray(data.owner) && data.owner.includes(targetId)) {
    data.owner = data.owner.filter(id => id !== targetId);
    saveData(data);
    bot.sendMessage(chatId, `✅ User ${targetId} berhasil dihapus dari owner tambahan.`);
  } else {
    bot.sendMessage(chatId, `⚠️ User ${targetId} bukan owner tambahan.`);
  }
});

// === /listownjs ===
bot.onText(/^\/listownjs$/, (msg) => {
  const senderId = msg.from.id;
  const chatId = msg.chat.id;

  // PERBAIKAN: Akses konsisten dengan add/del (Main Owner / CEO)
  if (!(isMainOwner(senderId) || isCEO(senderId))) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya CEO / Developer Yang Bisa Menggunakan Perintah Ini!");
  }

  const data = loadData();
  // Filter Owner Utama dari daftar owner tambahan agar tidak duplikat
  const ownersTambahan = (Array.isArray(data.owner) ? data.owner : [])
    .filter(id => !OWNER_IDS.map(String).includes(String(id)));

  if (ownersTambahan.length === 0) {
    return bot.sendMessage(chatId, "📋 Tidak ada owner tambahan yang terdaftar.");
  }

  const teks = `📋 Daftar Owner Tambahan:\n\n${ownersTambahan.map((id,i)=>`${i+1}. ${id}`).join("\n")}`;
  bot.sendMessage(chatId, teks);
});

// === /addakses ===
bot.onText(/^\/addakses(?:\s+(\d+)\s+(\d+)([dh]))?$/, (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;
  
  if (!isOwner(senderId)) {
    return bot.sendMessage(chatId, '❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!');
  }

  const userId = match[1];
  const jumlah = match[2];
  const satuan = match[3];

  if (!userId || !jumlah || !satuan) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/addakses 123 1d`", { parse_mode: "Markdown" });
  }

  const durasi = parseInt(jumlah);
  let detik;
  if (satuan === 'd') detik = durasi * 86400;
  else if (satuan === 'h') detik = durasi * 3600;
  else return bot.sendMessage(chatId, '❌ Format waktu salah. Gunakan "d" (hari) atau "h" (jam).');

  if (isNaN(durasi) || durasi <= 0) {
    return bot.sendMessage(chatId, '⚠️ Jumlah durasi harus angka positif.');
  }

  const now = Math.floor(Date.now() / 1000);
  const data = loadData();
  if (!data.premium) data.premium = {};

  const current = data.premium[userId] || now;
  data.premium[userId] = current > now ? current + detik : now + detik;

  saveData(data);
  const waktuText = satuan === 'd' ? 'hari' : 'jam';
  bot.sendMessage(chatId, `✅ User ${userId} berhasil ditambahkan Premium selama ${durasi} ${waktuText}.`);
});

// === /delakses ===
bot.onText(/^\/delakses(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isOwner(senderId)) {
    return bot.sendMessage(chatId, '❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!');
  }

  const userId = match[1];
  if (!userId) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/delakses 123`", { parse_mode: "Markdown" });
  }

  const data = loadData();
  if (!data.premium || !data.premium[userId]) {
    return bot.sendMessage(chatId, `❌ User ${userId} tidak ditemukan atau belum premium.`);
  }

  delete data.premium[userId];
  saveData(data);
  bot.sendMessage(chatId, `✅ Premium user ${userId} berhasil dihapus.`);
});

// === /listakses ===
bot.onText(/\/listakses/, (msg) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;
  
  if (!isOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!");
  }

  const data = loadData();
  const now = Math.floor(Date.now() / 1000);

  const entries = Object.entries(data.premium || {})
    .map(([uid, exp]) => {
      const sisaDetik = exp - now;
      if (sisaDetik <= 0) return null; // Filter yang sudah expired

      const hari = Math.floor(sisaDetik / 86400);
      const jam = Math.floor((sisaDetik % 86400) / 3600);
      const menit = Math.floor((sisaDetik % 3600) / 60);

      const sisa = `${hari ? hari + 'h ' : ''}${jam}j ${menit}m`;
      return `👤 ${uid} - ${sisa} tersisa`;
    })
    .filter(Boolean);

  if (entries.length === 0) {
    return bot.sendMessage(chatId, "📋 Daftar Premium:\n\nBelum ada user Premium yang aktif.");
  }

  const teks = `📋 Daftar Premium Aktif:\n\n${entries.join("\n")}`;
  bot.sendMessage(chatId, teks);
});

// === /addbl ===
bot.onText(/^\/addbl(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isMainOwner(senderId)) { // Gunakan isMainOwner karena ini tugas developer/owner utama
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!");
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/addbl 123`", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();
  if (!data.blacklist) data.blacklist = [];

  if (!data.blacklist.includes(targetId)) {
    data.blacklist.push(targetId);
    saveData(data);
    bot.sendMessage(chatId, `✅ User ${targetId} ditambahkan ke blacklist.`);
  } else {
    bot.sendMessage(chatId, `⚠️ User ${targetId} sudah ada di blacklist.`);
  }
});

// === /delbl ===
bot.onText(/^\/delbl(?:\s+(\d+))?$/, (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isMainOwner(senderId)) { // Gunakan isMainOwner karena ini tugas developer/owner utama
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!");
  }

  if (!match[1]) {
    return bot.sendMessage(chatId, "⚠️ Format salah. Contoh: `/delbl 123`", { parse_mode: "Markdown" });
  }

  const targetId = match[1];
  const data = loadData();

  if (data.blacklist && data.blacklist.includes(targetId)) {
    data.blacklist = data.blacklist.filter(x => x !== targetId);
    saveData(data);
    bot.sendMessage(chatId, `✅ User ${targetId} dihapus dari blacklist.`);
  } else {
    bot.sendMessage(chatId, `⚠️ User ${targetId} tidak ada di blacklist.`);
  }
});

// === /listbl ===
bot.onText(/^\/listbl$/, (msg) => {
  const senderId = msg.from.id.toString();

  if (!isMainOwner(senderId)) { // Gunakan isMainOwner karena ini tugas developer/owner utama
    return bot.sendMessage(msg.chat.id, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!");
  }

  const data = loadData();
  const list = data.blacklist || [];

  if (list.length === 0) {
    bot.sendMessage(msg.chat.id, "📋 Blacklist kosong.");
  } else {
    bot.sendMessage(msg.chat.id, "📋 Daftar blacklist:\n" + list.join("\n"));
  }
});

// === /updatefile ===
bot.onText(/^\/updatefile$/, async (msg) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isMainOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Developer Yang Bisa Menggunakan Perintah Ini!");
  }

  if (!msg.reply_to_message || !msg.reply_to_message.document) {
    return bot.sendMessage(chatId, "⚠️ Harap reply ke file JS yang ingin di-update.");
  }

  const fileId = msg.reply_to_message.document.file_id;
  const fileName = msg.reply_to_message.document.file_name || "update.js";
  const filePath = `./${fileName}`;

  try {
    const fileLink = await bot.getFileLink(fileId);
    
    // Pastikan tidak ada konflik nama file
    if (fileName !== 'index.js' && fileName !== 'main.js') {
        return bot.sendMessage(chatId, "❌ File yang di-reply harus memiliki nama file utama (misalnya: index.js atau main.js) agar bot bisa me-replace file utamanya.");
    }
    
    const fileStream = fs.createWriteStream(filePath);

    https.get(fileLink, (res) => {
      res.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();

        const oldPath = __filename;
        fs.copyFileSync(filePath, oldPath);
        bot.sendMessage(chatId, `✅ File berhasil diupdate: ${fileName}\n♻️ Restarting...`);

        setTimeout(() => {
          process.exit(1); 
        }, 1500);
      });
    }).on("error", (err) => {
      console.error(err);
      bot.sendMessage(chatId, "❌ Gagal mengunduh file baru.");
    });
  } catch (err) {
    console.error("❌ Error updatefile:", err);
    bot.sendMessage(chatId, "⚠️ Terjadi error saat update file.");
  }
});

// === /setmaintenance ===
bot.onText(/^\/setmaintenance(?:\s+(on|off))?$/, async (msg, match) => {
  const senderId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!isMainOwner(senderId)) {
    return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Developer Yang Bisa Menggunakan Perintah Ini!");
  }

  const arg = match[1];
  if (!arg) {
    const status = isMaintenance() ? "🔴 ON (Aktif)" : "🟢 OFF (Nonaktif)";
    return bot.sendMessage(chatId, `⚙️ Status Maintenance saat ini: ${status}. Gunakan /setmaintenance on/off.`);
  }

  if (arg.toLowerCase() === "on") {
    setMaintenance(true);
    return bot.sendMessage(chatId, "🔴 Mode Maintenance telah *AKTIF*.\nSemua user akan menerima notifikasi dan tidak bisa menggunakan bot.", { parse_mode: "Markdown" });
  } else if (arg.toLowerCase() === "off") {
    setMaintenance(false);
    return bot.sendMessage(chatId, "🟢 Mode Maintenance telah *DINONAKTIFKAN*.\nBot kembali normal digunakan.", { parse_mode: "Markdown" });
  } else {
    return bot.sendMessage(chatId, "⚠️ Format salah.\nGunakan `/setmaintenance on` atau `/setmaintenance off`.", { parse_mode: "Markdown" });
  }
});

// === /cekid ===
bot.onText(/\/cekid/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const username = msg.from.username ? '@' + msg.from.username : 'Tidak ada';
  const date = new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });

  const dcId = (userId >> 27) & 7;

  const caption = `
🪪 <b>ID CARD TELEGRAM</b>

👤 <b>Nama</b> : ${fullName}
🆔 <b>User ID</b> : <code>${userId}</code>
🌐 <b>Username</b> : ${username}
🔒 <b>DC ID</b> : ${dcId}
📅 <b>Tanggal</b> : ${date}

© ${DEVELOPER}
  `;

  try {
    const userProfilePhotos = await bot.getUserProfilePhotos(userId, { limit: 1 });

    if (userProfilePhotos.total_count === 0) throw new Error("No profile photo");

    const fileId = userProfilePhotos.photos[0][0].file_id;

    await bot.sendPhoto(chatId, fileId, {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: `${fullName}`, url: `tg://user?id=${userId}` }
          ]
        ]
      }
    });
  } catch (err) {
    await bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
  }
});

// === /tourl ===
bot.onText(/^\/tourl$/, async (msg) => {
  if (!(await requireNotBlacklisted(msg))) return;
  if (!(await requireNotMaintenance(msg))) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (!msg.reply_to_message || (!msg.reply_to_message.document && !msg.reply_to_message.photo && !msg.reply_to_message.video)) {
    return bot.sendMessage(
      chatId,
      "❌ Silakan reply sebuah file, foto, atau video dengan command /tourl",
      { reply_to_message_id: msg.message_id, parse_mode: "Markdown" }
    );
  }

  const repliedMsg = msg.reply_to_message;
  let fileId, fileName, contentType;

  if (repliedMsg.document) {
    fileId = repliedMsg.document.file_id;
    fileName = repliedMsg.document.file_name || `file_${Date.now()}`;
    contentType = repliedMsg.document.mime_type;
  } else if (repliedMsg.photo) {
    fileId = repliedMsg.photo[repliedMsg.photo.length - 1].file_id;
    fileName = `photo_${Date.now()}.jpg`;
    contentType = 'image/jpeg';
  } else if (repliedMsg.video) {
    fileId = repliedMsg.video.file_id;
    fileName = `video_${Date.now()}.mp4`;
    contentType = repliedMsg.video.mime_type;
  }
  
  // Tangani kasus jika fileId tidak ditemukan
  if (!fileId) {
      return bot.sendMessage(chatId, "❌ Gagal mendapatkan File ID dari pesan yang di-reply.");
  }

  try {
    const processingMsg = await bot.sendMessage(
      chatId,
      "⌛ Mengupload ke Catbox...",
      { reply_to_message_id: msg.message_id, parse_mode: "Markdown" }
    );

    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, { responseType: "stream" });

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", response.data, {
      filename: fileName,
      contentType: contentType || response.headers["content-type"]
    });

    const { data: catboxUrl } = await axios.post("https://catbox.moe/user/api.php", form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    // Catbox mengembalikan error dalam bentuk string biasa, bukan JSON.
    if (!catboxUrl.startsWith("http")) {
       await bot.editMessageText(
          `*❌ Upload Gagal!*\nRespon Catbox: \`${catboxUrl}\``,
          { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: "Markdown" }
        );
        return;
    }

    await bot.editMessageText(
      `*✅ Upload berhasil!*\n📎 URL:\n\`${catboxUrl}\``,
      {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: "Markdown"
      }
    );
  } catch (error) {
    console.error("❌ Error di /tourl:", error?.response?.data || error?.message || error);
    bot.sendMessage(chatId, "❌ Gagal mengupload file ke Catbox. Coba lagi nanti.");
  }
});

// === /done ===
bot.onText(/^\/done(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1]?.trim();
  const replyMsg = msg.reply_to_message;

  if (!input) {
    return bot.sendMessage(chatId, 
`📌 *FORMAT SALAH!*

Gunakan format berikut:
/done <nama barang>,<harga>,<metode bayar>

*Contoh:*
\`/done jasa install panel,15000,Dana\``, 
{ parse_mode: "Markdown" });
  }

  const [namaBarang, hargaBarang, metodeBayar] = input.split(",").map(x => x?.trim());
  if (!namaBarang || !hargaBarang) {
    return bot.sendMessage(chatId, 
`❗ *FORMAT TIDAK LENGKAP!*

Minimal isi *nama barang* dan *harga*.

*Contoh:*
\`/done jasa install panel,15000,Dana\``,
{ parse_mode: "Markdown" });
  }
  
  // Validasi harga adalah angka
  const numericHarga = Number(hargaBarang.replace(/[^0-9]/g, ''));
  if (isNaN(numericHarga) || numericHarga <= 0) {
      return bot.sendMessage(chatId, '⚠️ Harga harus berupa angka yang valid dan positif.', { parse_mode: "Markdown" });
  }

  const hargaFormatted = `Rp${numericHarga.toLocaleString("id-ID")}`;
  const metodePembayaran = metodeBayar || "Tidak disebutkan";
  const now = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const caption = `
<b>⿻ ⌜ TRANSAKSI BERHASIL ⌟ ⿻</b>
───────────────────────────
<b>▧ BARANG:</b> ${namaBarang}
<b>▧ NOMINAL:</b> ${hargaFormatted}
<b>▧ PAYMENT:</b> ${metodePembayaran}
<b>▧ WAKTU:</b> ${now}
───────────────────────────
<b>▧ KETERANGAN:</b> ALL TRX NO REFF!!!
───────────────────────────
<b>CONTACT:</b> ${DEVELOPER}
───────────────────────────
`;

  if (replyMsg && replyMsg.photo) {
    const photos = replyMsg.photo;
    const photoId = photos[photos.length - 1].file_id; 
    await bot.sendPhoto(chatId, photoId, {
      caption: caption,
      parse_mode: "HTML"
    }).catch((err) => {
      console.error("Send photo error:", err);
      bot.sendMessage(chatId, "⚠️ Gagal mengirim foto transaksi.");
    });
  } 
  else {
    await bot.sendMessage(chatId, caption, { parse_mode: "HTML" });
  }
});


// === /backup ===
bot.onText(/^\/backup$/, async (msg) => {
  const senderId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isAnyOwner(senderId)) return bot.sendMessage(chatId, "❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!");

  try {
    const backupPath = backupData();
    if (backupPath) {
      await bot.sendDocument(chatId, backupPath, {}, { filename: "data-backup.json" });
    } else {
      await bot.sendMessage(chatId, "⚠️ Tidak ada data.json untuk di-backup.");
    }
  } catch (e) {
    console.error("❌ Error backup manual:", e);
    bot.sendMessage(chatId, "❌ Gagal membuat backup.");
  }
});

// === /ping ===
bot.onText(/\/ping/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isAnyOwner(userId)) return bot.sendMessage(chatId, '❌ Akses Ditolak:\nHanya Owner Yang Bisa Menggunakan Perintah Ini!');

  try {
    const uptime = getUptime(); // Menggunakan fungsi getUptime yang lebih ringkas
    const totalMem = os.totalmem() / (1024 ** 3);
    const freeMem = os.freemem() / (1024 ** 3);
    const cpuModel = os.cpus()[0].model;
    const cpuCores = os.cpus().length;

    const teks = `
<blockquote>
🖥️ Informasi VPS

CPU: ${cpuModel} (${cpuCores} CORE)
RAM: ${freeMem.toFixed(2)} GB / ${totalMem.toFixed(2)} GB
Uptime: ${uptime}
</blockquote>
    `.trim();

    bot.sendMessage(chatId, teks, { parse_mode: 'HTML' });
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, '❌ Gagal membaca info VPS.');
  }
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d} hari, ${h} jam, ${m} menit, ${s} detik`;
}

console.log(
  chalk.hex("#FF4500").bold(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${chalk.hex("#FFD700").bold("BOT JASEB ACTIVE")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USERNAME : ${chalk.hex("#00FFFF")(DEVELOPER)}
ID : ${chalk.hex("#00FFFF")(OWNER_IDS)}
BOT TOKEN : ${chalk.hex("#00FFFF")(BOT_TOKEN)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
);

