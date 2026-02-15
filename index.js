require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CHANNEL_ID = process.env.CHANNEL_ID;

// 1. Language Dictionary
const strings = {
    '🇺🇿 UZ': {
        welcome: "Xush kelibsiz! Tilni tanlang:",
        askPhone: "Iltimos, telefon raqamingizni yuboring:",
        btnPhone: "📱 Raqamni yuborish",
        askName: "Ismingiz nima?",
        askVideo: "Endi videoni yuklang:",
        done: "✅ Hammasi tayyor, rahmat!",
        blocked: "🚫 Siz bloklangansiz.",
        adminMenu: "🛠 **Admin Paneli**\nQuyidagi amallardan birini tanlang:"
    },
    '🇷🇺 RU': {
        welcome: "Добро пожаловать! Выберите язык:",
        askPhone: "Пожалуйста, отправьте свой номер телефона:",
        btnPhone: "📱 Отправить номер",
        askName: "Как вас зовут?",
        askVideo: "Теперь загрузите видео:",
        done: "✅ Все готово, спасибо!",
        blocked: "🚫 Вы заблокированы.",
        adminMenu: "🛠 **Админ Панель**\nВыберите действие:"
    },
    '🇺🇸 EN': {
        welcome: "Welcome! Choose your language:",
        askPhone: "Please send your phone number:",
        btnPhone: "📱 Send Phone Number",
        askName: "What is your name?",
        askVideo: "Now upload the video:",
        done: "✅ All done, thank you!",
        blocked: "🚫 You are blocked.",
        adminMenu: "🛠 **Admin Control Panel**\nChoose an action:"
    }
};

let db;

// 2. Database Initialization
(async () => {
    db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
    await db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (chatId TEXT PRIMARY KEY, lang TEXT, phone TEXT, name TEXT, blocked INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, chatId TEXT, userName TEXT, fileId TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
    `);
    console.log("🚀 Bot is live!");
})();

bot.use(session());

// 3. Main Message Handler
bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    // Admin Access
    if (chatId === ADMIN_ID && text === '/admin') return handleAdmin(ctx);

    const user = await db.get('SELECT * FROM users WHERE chatId = ?', [chatId]);
    if (user?.blocked) return ctx.reply(strings[user.lang || '🇺🇸 EN'].blocked);

    const step = ctx.session?.step;

    if (text === '/start') {
        ctx.session = { step: 'ASK_LANG' };
        return ctx.reply("Select Language / Tilni tanlang / Выберите язык:",
            Markup.keyboard([['🇺🇿 UZ', '🇷🇺 RU', '🇺🇸 EN']]).resize()
        );
    }

    if (step === 'ASK_LANG' && strings[text]) {
        await db.run('INSERT OR REPLACE INTO users (chatId, lang) VALUES (?, ?)', [chatId, text]);
        ctx.session.step = 'ASK_PHONE';
        return ctx.reply(strings[text].askPhone,
            Markup.keyboard([[Markup.button.contactRequest(strings[text].btnPhone)]]).resize()
        );
    }

    if (step === 'ASK_PHONE' && ctx.message.contact) {
        await db.run('UPDATE users SET phone = ? WHERE chatId = ?', [ctx.message.contact.phone_number, chatId]);
        ctx.session.step = 'ASK_NAME';
        return ctx.reply(strings[user?.lang || '🇺🇸 EN'].askName, Markup.removeKeyboard());
    }

    if (step === 'ASK_NAME' && text) {
        await db.run('UPDATE users SET name = ? WHERE chatId = ?', [text, chatId]);
        ctx.session.step = 'ASK_VIDEO';
        return ctx.reply(strings[user?.lang || '🇺🇸 EN'].askVideo);
    }

    if (step === 'ASK_VIDEO' && ctx.message.video) {
        const videoFileId = ctx.message.video.file_id;
        try {
            await ctx.telegram.sendVideo(CHANNEL_ID, videoFileId, {
                caption: `📹 **New Upload**\n👤 User: ${user.name}\n📞 Phone: ${user.phone}\n🆔 ID: \`${chatId}\``,
                parse_mode: 'Markdown'
            });
            await db.run('INSERT INTO uploads (chatId, userName, fileId) VALUES (?, ?, ?)', [chatId, user.name, videoFileId]);
            ctx.session.step = null;
            return ctx.reply(strings[user.lang].done);
        } catch (e) {
            console.error(e);
            return ctx.reply("❌ Error forwarding to channel. Check bot permissions.");
        }
    }
});

// 4. Admin Dashboard Logic
async function handleAdmin(ctx) {
    const menu = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Users List', 'admin_users')],
        [Markup.button.callback('📥 Export Excel', 'admin_export')],
        [Markup.button.callback('📢 Broadcast', 'admin_broadcast')]
    ]);
    return ctx.reply(strings['🇺🇸 EN'].adminMenu, menu);
}
bot.action('admin_users', async (ctx) => {
    try {
        const users = await db.all('SELECT * FROM users');
        if (users.length === 0) return ctx.answerCbQuery("No users found.");

        const buttons = users.map(u => [
            Markup.button.callback(
                `${u.blocked ? '🚫' : '👤'} ${u.name || 'No Name'}`,
                `user_info_${u.chatId}`
            )
        ]);

        await ctx.answerCbQuery();
        return ctx.reply("📂 **Click a name to see their full data:**", Markup.inlineKeyboard(buttons));
    } catch (err) {
        console.error(err);
        ctx.reply("❌ Error loading user list.");
    }
});

bot.action(/user_info_(.+)/, async (ctx) => {
    try {
        const targetId = ctx.match[1];
        const user = await db.get('SELECT * FROM users WHERE chatId = ?', [targetId]);

        if (!user) {
            return ctx.answerCbQuery("User not found!");
        }

        const details = [
            `📑 **FULL USER DATA**`,
            `━━━━━━━━━━━━━━`,
            `👤 **Name:** ${user.name || 'N/A'}`,
            `🆔 **Chat ID:** \`${user.chatId}\``,
            `📞 **Phone:** ${user.phone || 'Not shared'}`,
            `🌍 **Language:** ${user.lang || 'N/A'}`,
            `🛡 **Status:** ${user.blocked ? '🚫 BLOCKED' : '✅ ACTIVE'}`,
            `━━━━━━━━━━━━━━`
        ].join('\n');

        const controls = Markup.inlineKeyboard([
            [
                user.blocked
                    ? Markup.button.callback('✅ Unblock', `unblock_${targetId}`)
                    : Markup.button.callback('🚫 Block', `block_${targetId}`)
            ],
            [Markup.button.callback('⬅️ Back to List', 'admin_users')]
        ]);

        await ctx.answerCbQuery();
        return ctx.replyWithMarkdown(details, controls);

    } catch (err) {
        console.error("Detail Error:", err);
        ctx.reply("❌ Error fetching details.");
    }
});

bot.action('admin_export', async (ctx) => {
    await ctx.answerCbQuery("Generating...");
    const data = await db.all('SELECT * FROM uploads');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    sheet.columns = [{ header: 'Name', key: 'userName' }, { header: 'ID', key: 'chatId' }, { header: 'File', key: 'fileId' }];
    data.forEach(d => sheet.addRow(d));
    const buffer = await workbook.xlsx.writeBuffer();
    return ctx.replyWithDocument({ source: buffer, filename: 'data.xlsx' });
});

bot.action('admin_broadcast', (ctx) => {
    ctx.session.step = 'BROADCAST_WAIT';
    ctx.answerCbQuery();
    return ctx.reply("Type the message you want to send to ALL users:");
});

// Broadcast logic handler
bot.on('text', async (ctx, next) => {
    if (ctx.session?.step === 'BROADCAST_WAIT' && ctx.from.id === ADMIN_ID) {
        const users = await db.all('SELECT chatId FROM users');
        let count = 0;
        for (const u of users) {
            try {
                await ctx.telegram.sendMessage(u.chatId, ctx.message.text);
                count++;
            } catch (e) { console.log(`Failed for ${u.chatId}`); }
        }
        ctx.session.step = null;
        return ctx.reply(`📢 Broadcast complete! Sent to ${count} users.`);
    }
    return next();
});

bot.launch();