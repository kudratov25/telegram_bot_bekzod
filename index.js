require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CHANNEL_ID = process.env.CHANNEL_ID;

let db;

// --- STRINGS ---
const strings = {
    '🇺🇿 UZ': {
        welcome: "Tilni tanlang:",
        askPhone: "Iltimos, telefon raqamingizni yuboring:",
        btnPhone: "📱 Raqamni yuborish",
        askName: "Ismingiz nima?",
        askVideo: "Endi videoni yuklang:",
        done: "✅ Hammasi tayyor, rahmat!",
        blocked: "🚫 Siz bloklangansiz.",
        error: "❌ Xatolik yuz berdi.",
        broadcastAsk: "Yubormoqchi bo'lgan xabarni yozing (yoki bekor qilish uchun /cancel):",
        adminMenu: "🛠 Admin paneli:",
        noUsers: "Foydalanuvchilar topilmadi."
    },
    '🇷🇺 RU': {
        welcome: "Выберите язык:",
        askPhone: "Пожалуйста, отправьте свой номер:",
        btnPhone: "📱 Отправить номер",
        askName: "Как вас зовут?",
        askVideo: "Теперь загрузите видео:",
        done: "✅ Готово, спасибо!",
        blocked: "🚫 Вы заблокированы.",
        error: "❌ Произошла ошибка.",
        broadcastAsk: "Введите сообщение для рассылки (или /cancel):",
        adminMenu: "🛠 Админ панель:",
        noUsers: "Пользователи не найдены."
    },
    '🇺🇸 EN': {
        welcome: "Choose language:",
        askPhone: "Please send your phone number:",
        btnPhone: "📱 Send phone number",
        askName: "What is your name?",
        askVideo: "Now upload the video:",
        done: "✅ Completed. Thank you!",
        blocked: "🚫 You are blocked.",
        error: "❌ Something went wrong.",
        broadcastAsk: "Type message to broadcast (or /cancel):",
        adminMenu: "🛠 Admin panel:",
        noUsers: "No users found."
    }
};

// --- DATABASE HELPER ---
async function initDb() {
    db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            chatId TEXT PRIMARY KEY,
            lang TEXT,
            phone TEXT,
            name TEXT,
            blocked INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chatId TEXT,
            userName TEXT,
            fileId TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

// --- UTILS ---
const escapeMD = (text = '') => text.toString().replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
const getUser = (chatId) => db.get('SELECT * FROM users WHERE chatId = ?', [chatId]);

// --- MIDDLEWARE & COMMANDS ---
bot.use(session());

bot.start(async (ctx) => {
    ctx.session = { step: 'LANG' };
    return ctx.reply("🌍 Select Language / Tilni tanlang / Выберите язык:",
        Markup.keyboard([['🇺🇿 UZ', '🇷🇺 RU', '🇺🇸 EN']]).resize()
    );
});

bot.command('admin', (ctx) => showAdminMenu(ctx));
bot.command('cancel', (ctx) => {
    ctx.session = null;
    return ctx.reply("Cancelled.", Markup.removeKeyboard());
});

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const step = ctx.session?.step;
    const user = await getUser(chatId);

    if (user?.blocked && chatId !== ADMIN_ID) {
        return ctx.reply(strings[user.lang || '🇺🇸 EN'].blocked);
    }

    // 1. LANGUAGE SELECTION
    if (step === 'LANG' && strings[text]) {
        await db.run(`INSERT INTO users (chatId, lang) VALUES (?, ?) ON CONFLICT(chatId) DO UPDATE SET lang=excluded.lang`, [chatId, text]);
        ctx.session.step = 'PHONE';
        return ctx.reply(strings[text].askPhone, Markup.keyboard([[Markup.button.contactRequest(strings[text].btnPhone)]]).oneTime().resize());
    }

    // 2. PHONE SELECTION
    if (step === 'PHONE' && ctx.message.contact) {
        if (ctx.message.contact.user_id !== ctx.from.id) return ctx.reply("❌ Use the button to send your own number.");
        await db.run('UPDATE users SET phone=? WHERE chatId=?', [ctx.message.contact.phone_number, chatId]);
        ctx.session.step = 'NAME';
        return ctx.reply(strings[user.lang].askName, Markup.removeKeyboard());
    }

    // 3. NAME SELECTION
    if (step === 'NAME' && text) {
        await db.run('UPDATE users SET name=? WHERE chatId=?', [text, chatId]);
        ctx.session.step = 'VIDEO';
        return ctx.reply(strings[user.lang].askVideo);
    }

    // 4. VIDEO UPLOAD
    if (step === 'VIDEO' && ctx.message.video) {
        try {
            await ctx.telegram.sendVideo(CHANNEL_ID, ctx.message.video.file_id, {
                caption: `📹 *New Submission*\n👤 Name: ${escapeMD(user.name)}\n📞 Phone: ${escapeMD(user.phone)}\n🆔 ID: \`${chatId}\``,
                parse_mode: 'MarkdownV2'
            });
            await db.run('INSERT INTO uploads (chatId, userName, fileId) VALUES (?, ?, ?)', [chatId, user.name, ctx.message.video.file_id]);
            ctx.session = null;
            return ctx.reply(strings[user.lang].done);
        } catch (e) {
            console.error(e);
            return ctx.reply(strings[user.lang].error);
        }
    }

    // 5. ADMIN BROADCAST LOGIC
    if (step === 'BROADCAST' && chatId === ADMIN_ID) {
        const users = await db.all('SELECT chatId FROM users WHERE blocked = 0');
        ctx.session = null;
        let count = 0;

        ctx.reply(`🚀 Starting broadcast to ${users.length} users...`);
        for (const u of users) {
            try {
                await ctx.telegram.copyMessage(u.chatId, ctx.chat.id, ctx.message.message_id);
                count++;
            } catch (err) { console.error(`Failed: ${u.chatId}`); }
        }
        return ctx.reply(`📢 Done! Sent to ${count} users.`, Markup.removeKeyboard());
    }
});

// --- ADMIN PANEL FUNCTIONS ---
async function showAdminMenu(ctx) {
    if (ctx.from.id !== ADMIN_ID) return;
    const text = "🛠 **Admin Control Panel**";
    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('👥 Manage Users', 'admin_users')],
        [Markup.button.callback('📥 Export Excel', 'admin_export')],
        [Markup.button.callback('📢 Global Broadcast', 'admin_broadcast')]
    ]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(text, { parse_mode: 'Markdown', ...buttons }).catch(() => {});
    }
    return ctx.reply(text, { parse_mode: 'Markdown', ...buttons });
}

bot.action('admin_users', async (ctx) => {
    const users = await db.all('SELECT * FROM users LIMIT 50'); // Limit to avoid button overflow
    const buttons = users.map(u => [Markup.button.callback(`${u.blocked ? '🚫' : '👤'} ${u.name || u.chatId}`, `info_${u.chatId}`)]);
    buttons.push([Markup.button.callback('⬅️ Back', 'admin_home')]);
    return ctx.editMessageText("Select a user to manage:", Markup.inlineKeyboard(buttons));
});

bot.action(/info_(.+)/, async (ctx) => {
    const id = ctx.match[1];
    const u = await getUser(id);
    const text = `👤 *User Info*\nName: ${u.name}\nPhone: ${u.phone}\nID: \`${u.chatId}\`\nStatus: ${u.blocked ? 'Blocked' : 'Active'}`;
    const buttons = [
        [Markup.button.callback(u.blocked ? '✅ Unblock' : '🚫 Block', `${u.blocked ? 'unblock' : 'block'}_${id}`)],
        [Markup.button.callback('⬅️ Back to List', 'admin_users')]
    ];
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/(block|unblock)_(.+)/, async (ctx) => {
    const [action, id] = [ctx.match[1], ctx.match[2]];
    await db.run('UPDATE users SET blocked = ? WHERE chatId = ?', [action === 'block' ? 1 : 0, id]);
    ctx.answerCbQuery(`User ${action}ed`);
    return showAdminMenu(ctx);
});

bot.action('admin_broadcast', async (ctx) => {
    ctx.session = { step: 'BROADCAST' };
    await ctx.answerCbQuery();
    return ctx.reply("Please send the message (text, photo, or video) you want to broadcast to everyone.");
});

bot.action('admin_home', (ctx) => showAdminMenu(ctx));

bot.action('admin_export', async (ctx) => {
    const data = await db.all(`SELECT u.*, usr.phone FROM uploads u LEFT JOIN users usr ON u.chatId = usr.chatId`);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Report');
    sheet.columns = [
        { header: 'Name', key: 'userName' }, { header: 'Phone', key: 'phone' },
        { header: 'FileID', key: 'fileId' }, { header: 'Date', key: 'timestamp' }
    ];
    data.forEach(r => sheet.addRow(r));
    const buffer = await wb.xlsx.writeBuffer();
    return ctx.replyWithDocument({ source: buffer, filename: 'report.xlsx' });
});

// --- START ---
initDb().then(() => {
    bot.launch();
    console.log("✅ Bot is running properly");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));