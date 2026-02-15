require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);

// 1. Translation Dictionary
const strings = {
    '🇺🇿 UZ': {
        welcome: "Xush kelibsiz! Tilni tanlang:",
        askPhone: "Iltimos, telefon raqamingizni yuboring:",
        btnPhone: "📱 Raqamni yuborish",
        askName: "Ismingiz nima?",
        askVideo: "Endi videoni yuklang:",
        done: "✅ Hammasi tayyor, rahmat!",
        blocked: "🚫 Siz bloklangansiz."
    },
    '🇷🇺 RU': {
        welcome: "Добро пожаловать! Выберите язык:",
        askPhone: "Пожалуйста, отправьте свой номер телефона:",
        btnPhone: "📱 Отправить номер",
        askName: "Как вас зовут?",
        askVideo: "Теперь загрузите видео:",
        done: "✅ Все готово, спасибо!",
        blocked: "🚫 Вы заблокированы."
    },
    '🇺🇸 EN': {
        welcome: "Welcome! Choose your language:",
        askPhone: "Please send your phone number:",
        btnPhone: "📱 Send Phone Number",
        askName: "What is your name?",
        askVideo: "Now upload the video:",
        done: "✅ All done, thank you!",
        blocked: "🚫 You are blocked."
    }
};

let db;

(async () => {
    db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
    await db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (chatId TEXT PRIMARY KEY, lang TEXT, phone TEXT, name TEXT, blocked INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, chatId TEXT, userName TEXT, fileId TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
    `);
    console.log("🚀 Bot is live locally!");
})();

bot.use(session());

bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (chatId === ADMIN_ID && text?.startsWith('/admin')) return handleAdmin(ctx);

    const user = await db.get('SELECT * FROM users WHERE chatId = ?', [chatId]);
    if (user?.blocked) return ctx.reply(strings[user.lang || '🇺🇸 EN'].blocked);

    const step = ctx.session?.step;

    // --- START / LANGUAGE SELECTION ---
    if (text === '/start') {
        ctx.session = { step: 'ASK_LANG' };
        return ctx.reply("Select Language / Tilni tanlang / Выберите язык:",
            Markup.keyboard([['🇺🇿 UZ', '🇷🇺 RU', '🇺🇸 EN']]).resize()
        );
    }

    // --- STEP 1: SAVE LANGUAGE ---
    if (step === 'ASK_LANG' && strings[text]) {
        await db.run('INSERT OR REPLACE INTO users (chatId, lang) VALUES (?, ?)', [chatId, text]);
        ctx.session.step = 'ASK_PHONE';
        return ctx.reply(strings[text].askPhone,
            Markup.keyboard([[Markup.button.contactRequest(strings[text].btnPhone)]]).resize()
        );
    }

    // --- STEP 2: SAVE PHONE ---
    if (step === 'ASK_PHONE' && ctx.message.contact) {
        const lang = user?.lang || '🇺🇸 EN';
        await db.run('UPDATE users SET phone = ? WHERE chatId = ?', [ctx.message.contact.phone_number, chatId]);
        ctx.session.step = 'ASK_NAME';
        return ctx.reply(strings[lang].askName, Markup.removeKeyboard());
    }

    // --- STEP 3: SAVE NAME ---
    if (step === 'ASK_NAME' && text) {
        const lang = user?.lang || '🇺🇸 EN';
        await db.run('UPDATE users SET name = ? WHERE chatId = ?', [text, chatId]);
        ctx.session.step = 'ASK_VIDEO';
        return ctx.reply(strings[lang].askVideo);
    }

    // --- STEP 4: SAVE VIDEO ---
    if (step === 'ASK_VIDEO' && ctx.message.video) {
        const lang = user?.lang || '🇺🇸 EN';
        await db.run('INSERT INTO uploads (chatId, userName, fileId) VALUES (?, ?, ?)',
            [chatId, user.name || 'Unknown', ctx.message.video.file_id]);
        ctx.session.step = null;
        return ctx.reply(strings[lang].done);
    }
});

async function handleAdmin(ctx) {
    const text = ctx.message.text;
    const args = text.split(' '); // Split command from arguments

    // --- COMMAND: /admin_users ---
    if (text === '/admin_users') {
        const users = await db.all('SELECT * FROM users');
        if (users.length === 0) return ctx.reply("No users registered yet.");

        let userList = "👤 **Registered Users:**\n\n";
        users.forEach((u, index) => {
            const status = u.blocked ? "🚫 Blocked" : "✅ Active";
            userList += `${index + 1}. **${u.name || 'No Name'}**\n`;
            userList += `   ID: \`${u.chatId}\`\n`;
            userList += `   Phone: ${u.phone || 'N/A'}\n`;
            userList += `   Lang: ${u.lang}\n`;
            userList += `   Status: ${status}\n\n`;
        });

        // If list is too long for one message, you might need to split it
        return ctx.replyWithMarkdown(userList);
    }

    // --- COMMAND: /admin_block [chatId] ---
    if (text.startsWith('/admin_block')) {
        const targetId = args[1];
        if (!targetId) return ctx.reply("Usage: /admin_block 12345678");

        await db.run('UPDATE users SET blocked = 1 WHERE chatId = ?', [targetId]);
        return ctx.reply(`User ${targetId} has been 🚫 **Blocked**.`);
    }

    // --- COMMAND: /admin_unblock [chatId] ---
    if (text.startsWith('/admin_unblock')) {
        const targetId = args[1];
        if (!targetId) return ctx.reply("Usage: /admin_unblock 12345678");

        await db.run('UPDATE users SET blocked = 0 WHERE chatId = ?', [targetId]);
        return ctx.reply(`User ${targetId} has been ✅ **Unblocked**.`);
    }

    // --- COMMAND: /admin_export ---
    if (text === '/admin_export') {
        const data = await db.all('SELECT * FROM uploads');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Uploads');
        sheet.columns = [
            { header: 'User Name', key: 'userName', width: 20 },
            { header: 'User ID', key: 'chatId', width: 15 },
            { header: 'File ID', key: 'fileId', width: 30 },
            { header: 'Timestamp', key: 'timestamp', width: 25 }
        ];
        data.forEach(d => sheet.addRow(d));
        const buffer = await workbook.xlsx.writeBuffer();
        return ctx.replyWithDocument({ source: buffer, filename: 'users_data.xlsx' });
    }
}

bot.launch();