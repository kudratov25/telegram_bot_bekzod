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
        noUsers: "Foydalanuvchilar topilmadi.",
        manageUsers: "👥 Foydalanuvchilar",
        exportExcel: "📥 Excel yuklash",
        globalBroadcast: "📢 Xabar yuborish",
        back: "⬅️ Orqaga",
        userStatus: "Holati",
        active: "Faol",
        isBlocked: "Bloklangan",
        unblock: "✅ Blokdan ochish",
        block: "🚫 Bloklash",
        selectUser: "Boshqarish uchun foydalanuvchini tanlang:",
        broadcastStart: "🚀 Xabar yuborish boshlandi...",
        broadcastDone: "📢 Tugatildi! Yuborildi: "
    },
    '🇷🇺 RU': {
        welcome: "Выберите язык:",
        askPhone: "Пожалуйста, отправьте свой номер:",
        btnPhone: "📱 Отправить номер",
        askName: "Как вас зовут?",
        askVideo: "Теперь загрузите видео:",
        done: "✅ Готово, спасибо!",
        blocked: "🚫 Вы заблокированы.",
        error: "❌ Происходила ошибка.",
        broadcastAsk: "Введите сообщение для рассылки (или /cancel):",
        adminMenu: "🛠 Админ панель:",
        noUsers: "Пользователи не найдены.",
        manageUsers: "👥 Пользователи",
        exportExcel: "📥 Экспорт Excel",
        globalBroadcast: "📢 Рассылка",
        back: "⬅️ Назад",
        userStatus: "Статус",
        active: "Активен",
        isBlocked: "Заблокирован",
        unblock: "✅ Разблокировать",
        block: "🚫 Блокировать",
        selectUser: "Выберите пользователя:",
        broadcastStart: "🚀 Рассылка началась...",
        broadcastDone: "📢 Готово! Отправлено: "
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
        noUsers: "No users found.",
        manageUsers: "👥 Manage Users",
        exportExcel: "📥 Export Excel",
        globalBroadcast: "📢 Global Broadcast",
        back: "⬅️ Back",
        userStatus: "Status",
        active: "Active",
        isBlocked: "Blocked",
        unblock: "✅ Unblock",
        block: "🚫 Block",
        selectUser: "Select a user to manage:",
        broadcastStart: "🚀 Starting broadcast...",
        broadcastDone: "📢 Done! Sent to: "
    }
};

// --- DATABASE HELPER ---
async function initDb() {
    db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            chatId TEXT PRIMARY KEY,
            lang TEXT DEFAULT '🇺🇸 EN',
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
    return ctx.reply("Cancelled / Bekor qilindi.", Markup.removeKeyboard());
});

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const step = ctx.session?.step;

    // Fetch user and fallback to EN if not found
    let user = await getUser(chatId);
    const lang = user?.lang || '🇺🇸 EN';
    const s = strings[lang];

    if (user?.blocked && chatId !== ADMIN_ID) {
        return ctx.reply(s.blocked);
    }

    // 1. LANGUAGE SELECTION
    if (step === 'LANG' && strings[text]) {
        await db.run(`INSERT INTO users (chatId, lang) VALUES (?, ?) ON CONFLICT(chatId) DO UPDATE SET lang=excluded.lang`, [chatId, text]);
        ctx.session.step = 'PHONE';
        return ctx.reply(strings[text].askPhone, Markup.keyboard([[Markup.button.contactRequest(strings[text].btnPhone)]]).oneTime().resize());
    }

    // 2. PHONE SELECTION
    if (step === 'PHONE') {
        let phoneNumber = null;
        if (ctx.message.contact) {
            if (ctx.message.contact.user_id !== ctx.from.id) return ctx.reply(s.error);
            phoneNumber = ctx.message.contact.phone_number;
        } else if (text) {
            const cleaned = text.replace(/\D/g, '');
            if (cleaned.length >= 9) phoneNumber = text;
        }

        if (phoneNumber) {
            await db.run('UPDATE users SET phone=? WHERE chatId=?', [phoneNumber, chatId]);
            ctx.session.step = 'NAME';
            return ctx.reply(s.askName, Markup.removeKeyboard());
        }
    }

    // 3. NAME SELECTION
    if (step === 'NAME' && text) {
        await db.run('UPDATE users SET name=? WHERE chatId=?', [text, chatId]);
        ctx.session.step = 'VIDEO';
        return ctx.reply(s.askVideo);
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
            return ctx.reply(s.done);
        } catch (e) {
            return ctx.reply(s.error);
        }
    }

    // 5. ADMIN BROADCAST
    if (step === 'BROADCAST' && chatId === ADMIN_ID) {
        const users = await db.all('SELECT chatId FROM users WHERE blocked = 0');
        ctx.session = null;
        let count = 0;
        ctx.reply(s.broadcastStart);
        for (const u of users) {
            try {
                await ctx.telegram.copyMessage(u.chatId, ctx.chat.id, ctx.message.message_id);
                count++;
            } catch (err) { console.error(err); }
        }
        return ctx.reply(`${s.broadcastDone}${count}`, Markup.removeKeyboard());
    }
});

// --- ADMIN PANEL FUNCTIONS ---
async function showAdminMenu(ctx) {
    if (ctx.from.id !== ADMIN_ID) return;
    const user = await getUser(ctx.from.id);
    const s = strings[user?.lang || '🇺🇸 EN'];

    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback(s.manageUsers, 'admin_users')],
        [Markup.button.callback(s.exportExcel, 'admin_export')],
        [Markup.button.callback(s.globalBroadcast, 'admin_broadcast')]
    ]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(s.adminMenu, buttons).catch(() => { });
    }
    return ctx.reply(s.adminMenu, buttons);
}

bot.action('admin_users', async (ctx) => {
    const admin = await getUser(ctx.from.id);
    const s = strings[admin.lang];
    const users = await db.all('SELECT * FROM users LIMIT 50');
    const buttons = users.map(u => [Markup.button.callback(`${u.blocked ? '🚫' : '👤'} ${u.name || u.chatId}`, `info_${u.chatId}`)]);
    buttons.push([Markup.button.callback(s.back, 'admin_home')]);
    return ctx.editMessageText(s.selectUser, Markup.inlineKeyboard(buttons));
});

bot.action(/info_(.+)/, async (ctx) => {
    const admin = await getUser(ctx.from.id);
    const s = strings[admin.lang];
    const id = ctx.match[1];
    const u = await getUser(id);

    const text = `👤 *User Info*\nName: ${u.name}\nPhone: ${u.phone}\nID: \`${u.chatId}\`\n${s.userStatus}: ${u.blocked ? s.isBlocked : s.active}`;
    const buttons = [
        [Markup.button.callback(u.blocked ? s.unblock : s.block, `${u.blocked ? 'unblock' : 'block'}_${id}`)],
        [Markup.button.callback(s.back, 'admin_users')]
    ];
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/(block|unblock)_(.+)/, async (ctx) => {
    await db.run('UPDATE users SET blocked = ? WHERE chatId = ?', [ctx.match[1] === 'block' ? 1 : 0, ctx.match[2]]);
    ctx.answerCbQuery();
    return showAdminMenu(ctx);
});

bot.action('admin_broadcast', async (ctx) => {
    const admin = await getUser(ctx.from.id);
    ctx.session = { step: 'BROADCAST' };
    await ctx.answerCbQuery();
    return ctx.reply(strings[admin.lang].broadcastAsk);
});

bot.action('admin_home', (ctx) => showAdminMenu(ctx));
bot.action('admin_export', async (ctx) => {
    const data = await db.all(`SELECT u.*, usr.phone FROM uploads u LEFT JOIN users usr ON u.chatId = usr.chatId`);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Report');

    sheet.columns = [
        { header: 'Name', key: 'userName' },
        { header: 'Phone', key: 'phone' },
        { header: 'FileID', key: 'fileId' },
        { header: 'Date', key: 'formattedDate' }
    ];

    data.forEach(r => {
        const dateObj = new Date(r.timestamp);

        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');

        const formattedDate = `${year}.${month}.${day} ${hours}:${minutes}`;

        sheet.addRow({
            userName: r.userName || 'N/A',
            phone: r.phone || 'N/A',
            fileId: r.fileId,
            formattedDate: formattedDate
        });
    });

    // --- AUTO-FIT LOGIC ---
    sheet.columns.forEach(column => {
        let maxColumnLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxColumnLength) {
                maxColumnLength = columnLength;
            }
        });
        column.width = maxColumnLength < 10 ? 10 : maxColumnLength + 2;
    });

    sheet.getRow(1).font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    return ctx.replyWithDocument(
        { source: buffer, filename: 'users_with_videos.xlsx' },
        { caption: "📊 Export completed with auto-fitted columns." }
    );
});

initDb().then(() => {
    bot.launch();
    console.log("✅ Bot is running properly");
});