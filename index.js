require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const SUPER_ADMIN_ID = String(process.env.SUPER_ADMIN_ID); // Set this in .env
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
        broadcastAsk: "Xabarni yozing:",
        adminMenu: "🛠 Admin paneli:",
        manageUsers: "👥 Foydalanuvchilar",
        exportExcel: "📥 Excel yuklash",
        globalBroadcast: "📢 Xabar yuborish",
        back: "⬅️ Orqaga",
        userStatus: "Holati",
        active: "Faol",
        isBlocked: "Bloklangan",
        unblock: "✅ Ochish",
        block: "🚫 Bloklash",
        selectUser: "Foydalanuvchini tanlang:",
        broadcastDone: "📢 Yuborildi: ",
        askPass: "Admin parolini kiriting:",
        adminSuccess: "🎉 Tabriklaymiz! Endi siz adminsiz. /admin buyrug'ini ishlating.",
        wrongPass: "❌ Parol noto'g'ri!",
        changePass: "🔐 Parolni o'zgartirish"
    },
    '🇷🇺 RU': {
        welcome: "Выберите язык:",
        askPhone: "Отправьте свой номер:",
        btnPhone: "📱 Отправить номер",
        askName: "Как вас зовут?",
        askVideo: "Загрузите видео:",
        done: "✅ Готово!",
        blocked: "🚫 Вы заблокированы.",
        error: "❌ Ошибка.",
        broadcastAsk: "Введите сообщение:",
        adminMenu: "🛠 Админ панель:",
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
        broadcastDone: "📢 Отправлено: ",
        askPass: "Введите пароль админа:",
        adminSuccess: "🎉 Теперь вы админ! Используйте /admin.",
        wrongPass: "❌ Неверный пароль!",
        changePass: "🔐 Изменить пароль"
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
        broadcastAsk: "Type message:",
        adminMenu: "🛠 Admin panel:",
        manageUsers: "👥 Manage Users",
        exportExcel: "📥 Export Excel",
        globalBroadcast: "📢 Global Broadcast",
        back: "⬅️ Back",
        userStatus: "Status",
        active: "Active",
        isBlocked: "Blocked",
        unblock: "✅ Unblock",
        block: "🚫 Block",
        selectUser: "Select a user:",
        broadcastDone: "📢 Sent to: ",
        askPass: "Enter admin password:",
        adminSuccess: "🎉 Success! You are an admin. Use /admin.",
        wrongPass: "❌ Wrong password!",
        changePass: "🔐 Change Password"
    }
};

// --- DATABASE HELPER ---
async function initDb() {
    db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
    try {
        await db.exec(`ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0`);
        console.log("✅ Column isAdmin added to users table.");
    } catch (e) {
        console.log("ℹ️ Column isAdmin already exists, skipping.");
    }

    await db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', '12345');
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            chatId TEXT PRIMARY KEY,
            lang TEXT DEFAULT '🇺🇸 EN',
            phone TEXT,
            name TEXT,
            blocked INTEGER DEFAULT 0,
            isAdmin INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chatId TEXT,
            userName TEXT,
            fileId TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', '12345');
    `);
}

// --- UTILS ---
const escapeMD = (text = '') => text.toString().replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
const getUser = (chatId) => db.get('SELECT * FROM users WHERE chatId = ?', [String(chatId)]);
const isUserAdmin = (user) => user && (user.isAdmin === 1 || String(user.chatId) === SUPER_ADMIN_ID);
const getAdminPass = async () => (await db.get('SELECT value FROM settings WHERE key = "admin_password"')).value;

// --- MIDDLEWARE & COMMANDS ---
bot.use(session());

bot.start(async (ctx) => {
    ctx.session = { step: 'LANG' };
    return ctx.reply("🌍 Select Language / Tilni tanlang / Выберите язык:",
        Markup.keyboard([['🇺🇿 UZ', '🇷🇺 RU', '🇺🇸 EN']]).resize()
    );
});

bot.command('setadmin', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const s = strings[user?.lang || '🇺🇸 EN'];
    ctx.session = { step: 'WAIT_PASS' };
    return ctx.reply(s.askPass);
});

bot.command('admin', async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (isUserAdmin(user)) return showAdminMenu(ctx, user);
});

bot.command('cancel', (ctx) => {
    ctx.session = null;
    return ctx.reply("Cancelled.", Markup.removeKeyboard());
});

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text;
    const step = ctx.session?.step;
    let user = await getUser(chatId);
    const s = strings[user?.lang || '🇺🇸 EN'];

    if (user?.blocked && !isUserAdmin(user)) return ctx.reply(s.blocked);

    // Admin Password Check
    if (step === 'WAIT_PASS') {
        const dbPass = await getAdminPass();
        if (text === dbPass) {
            await db.run('UPDATE users SET isAdmin = 1 WHERE chatId = ?', [chatId]);
            ctx.session = null;
            return ctx.reply(s.adminSuccess);
        } else {
            ctx.session = null;
            return ctx.reply(s.wrongPass);
        }
    }

    // Change Admin Password Logic (Super Admin only)
    if (step === 'SET_NEW_PASS' && chatId === SUPER_ADMIN_ID) {
        await db.run('UPDATE settings SET value = ? WHERE key = "admin_password"', [text]);
        ctx.session = null;
        return ctx.reply("✅ Password updated!");
    }

    // 1. LANGUAGE
    if (step === 'LANG' && strings[text]) {
        await db.run(`INSERT INTO users (chatId, lang) VALUES (?, ?) ON CONFLICT(chatId) DO UPDATE SET lang=excluded.lang`, [chatId, text]);
        ctx.session.step = 'PHONE';
        return ctx.reply(strings[text].askPhone, Markup.keyboard([[Markup.button.contactRequest(strings[text].btnPhone)]]).oneTime().resize());
    }

    // 2. PHONE
    if (step === 'PHONE') {
        let phone = ctx.message.contact ? ctx.message.contact.phone_number : (text?.length >= 9 ? text : null);
        if (phone) {
            await db.run('UPDATE users SET phone=? WHERE chatId=?', [phone, chatId]);
            ctx.session.step = 'NAME';
            return ctx.reply(s.askName, Markup.removeKeyboard());
        }
    }

    // 3. NAME
    if (step === 'NAME' && text) {
        await db.run('UPDATE users SET name=? WHERE chatId=?', [text, chatId]);
        ctx.session.step = 'VIDEO';
        return ctx.reply(s.askVideo);
    }

    // 4. VIDEO
    if (step === 'VIDEO' && ctx.message.video) {
        try {
            await ctx.telegram.sendVideo(CHANNEL_ID, ctx.message.video.file_id, {
                caption: `📹 *New Submission*\n👤 Name: ${escapeMD(user.name)}\n📞 Phone: ${escapeMD(user.phone)}`,
                parse_mode: 'MarkdownV2'
            });
            await db.run('INSERT INTO uploads (chatId, userName, fileId) VALUES (?, ?, ?)', [chatId, user.name, ctx.message.video.file_id]);
            ctx.session = null;
            return ctx.reply(s.done);
        } catch (e) { return ctx.reply(s.error); }
    }

    // 5. BROADCAST
    if (step === 'BROADCAST' && isUserAdmin(user)) {
        const all = await db.all('SELECT chatId FROM users WHERE blocked = 0');
        ctx.session = null;
        let count = 0;
        for (const u of all) {
            try { await ctx.telegram.copyMessage(u.chatId, ctx.chat.id, ctx.message.message_id); count++; } catch (e) { }
        }
        return ctx.reply(`${s.broadcastDone}${count}`);
    }
});

// --- ADMIN PANEL ---
async function showAdminMenu(ctx, user) {
    const s = strings[user.lang || '🇺🇸 EN'];
    const buttons = [
        [Markup.button.callback(s.manageUsers, 'admin_users_0')],
        [Markup.button.callback(s.exportExcel, 'admin_export')],
        [Markup.button.callback(s.globalBroadcast, 'admin_broadcast')]
    ];

    if (String(ctx.from.id) === SUPER_ADMIN_ID) {
        buttons.push([Markup.button.callback(s.changePass, 'admin_change_pass')]);
    }

    const keyboard = Markup.inlineKeyboard(buttons);
    return ctx.callbackQuery ? ctx.editMessageText(s.adminMenu, keyboard) : ctx.reply(s.adminMenu, keyboard);
}

bot.action('admin_change_pass', async (ctx) => {
    if (String(ctx.from.id) !== SUPER_ADMIN_ID) return ctx.answerCbQuery("Denied");
    ctx.session = { step: 'SET_NEW_PASS' };
    return ctx.editMessageText("Enter new admin password:");
});

bot.action(/admin_users_(\d+)/, async (ctx) => {
    const user = await getUser(ctx.from.id);
    if (!isUserAdmin(user)) return;
    const page = parseInt(ctx.match[1]);
    const limit = 10;
    const offset = page * limit;

    const users = await db.all('SELECT * FROM users LIMIT ? OFFSET ?', [limit, offset]);
    const total = (await db.get('SELECT COUNT(*) as count FROM users')).count;

    const buttons = users.map(u => [Markup.button.callback(`${u.blocked ? '🚫' : '👤'} ${u.name || u.chatId}`, `info_${u.chatId}_${page}`)]);

    const nav = [];
    if (page > 0) nav.push(Markup.button.callback('⬅️', `admin_users_${page - 1}`));
    if (offset + limit < total) nav.push(Markup.button.callback('➡️', `admin_users_${page + 1}`));

    if (nav.length) buttons.push(nav);
    buttons.push([Markup.button.callback(strings[user.lang].back, 'admin_home')]);

    return ctx.editMessageText(strings[user.lang].selectUser, Markup.inlineKeyboard(buttons));
});

bot.action(/info_(.+)_(\d+)/, async (ctx) => {
    const admin = await getUser(ctx.from.id);
    const [_, id, page] = ctx.match;
    const u = await getUser(id);
    const s = strings[admin.lang];

    const text = `👤 *User Info*\nName: ${u.name}\nPhone: ${u.phone}\nRole: ${u.isAdmin ? 'Admin' : 'User'}\nStatus: ${u.blocked ? s.isBlocked : s.active}`;
    const buttons = [[Markup.button.callback(u.blocked ? s.unblock : s.block, `toggle_block_${id}_${page}`)]];

    // Only Super Admin can demote other admins
    if (String(ctx.from.id) === SUPER_ADMIN_ID && String(u.chatId) !== SUPER_ADMIN_ID) {
        buttons.push([Markup.button.callback(u.isAdmin ? "Remove Admin" : "Make Admin", `toggle_role_${id}_${page}`)]);
    }

    buttons.push([Markup.button.callback(s.back, `admin_users_${page}`)]);
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/toggle_(block|role)_(.+)_(\d+)/, async (ctx) => {
    const [_, type, id, page] = ctx.match;
    const admin = await getUser(ctx.from.id);
    const u = await getUser(id);
    const s = strings[admin.lang];
    if (type === 'block') {
        await db.run('UPDATE users SET blocked = ? WHERE chatId = ?', [u.blocked ? 0 : 1, id]);
    } else if (type === 'role' && String(ctx.from.id) === SUPER_ADMIN_ID) {
        await db.run('UPDATE users SET isAdmin = ? WHERE chatId = ?', [u.isAdmin ? 0 : 1, id]);
    }
    ctx.answerCbQuery("Updated");
    const updatedUser = await getUser(id);
    const text = `👤 *User Info*\nName: ${updatedUser.name}\nPhone: ${updatedUser.phone}\nRole: ${updatedUser.isAdmin ? 'Admin' : 'User'}\nStatus: ${updatedUser.blocked ? s.isBlocked : s.active}`;
    const buttons = [[Markup.button.callback(updatedUser.blocked ? s.unblock : s.block, `toggle_block_${id}_${page}`)]];
    if (String(ctx.from.id) === SUPER_ADMIN_ID && String(updatedUser.chatId) !== SUPER_ADMIN_ID) {
        buttons.push([Markup.button.callback(updatedUser.isAdmin ? "Remove Admin" : "Make Admin", `toggle_role_${id}_${page}`)]);
    }
    buttons.push([Markup.button.callback(s.back, `admin_users_${page}`)]);
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(() => { });
});

bot.action('admin_home', async (ctx) => showAdminMenu(ctx, await getUser(ctx.from.id)));

bot.action('admin_broadcast', async (ctx) => {
    ctx.session = { step: 'BROADCAST' };
    return ctx.reply(strings[(await getUser(ctx.from.id)).lang].broadcastAsk);
});

bot.action('admin_export', async (ctx) => {
    const data = await db.all(`SELECT u.*, usr.phone FROM uploads u LEFT JOIN users usr ON u.chatId = usr.chatId`);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Report');
    sheet.columns = [
        { header: 'Name', key: 'userName' },
        { header: 'Phone', key: 'phone' },
        { header: 'Date', key: 'date' }
    ];
    data.forEach(r => {
        sheet.addRow({
            userName: r.userName,
            phone: r.phone,
            date: new Date(r.timestamp).toLocaleString()
        });
    });
    // Auto-width
    sheet.columns.forEach(col => { col.width = 20; });
    const buffer = await wb.xlsx.writeBuffer();
    return ctx.replyWithDocument({ source: buffer, filename: 'report.xlsx' });
});

initDb().then(() => {
    bot.launch();
    console.log("✅ Bot is online");
});