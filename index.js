require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CHANNEL_ID = process.env.CHANNEL_ID;

let db;

/* ===========================
   LANGUAGE STRINGS
=========================== */

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
        broadcastAsk: "Yubormoqchi bo'lgan xabarni yozing:",
        broadcastDone: (c) => `📢 Yuborildi: ${c} ta foydalanuvchi`,
        adminMenu: "🛠 Admin paneli:",
        usersList: "📂 Foydalanuvchini tanlang:",
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
        broadcastAsk: "Введите сообщение для рассылки:",
        broadcastDone: (c) => `📢 Отправлено ${c} пользователям`,
        adminMenu: "🛠 Админ панель:",
        usersList: "📂 Выберите пользователя:",
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
        broadcastAsk: "Type message to send to all users:",
        broadcastDone: (c) => `📢 Sent to ${c} users`,
        adminMenu: "🛠 Admin panel:",
        usersList: "📂 Select user:",
        noUsers: "No users found."
    }
};

const escape = (text = '') =>
    text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');

const getUser = (chatId) =>
    db.get('SELECT * FROM users WHERE chatId = ?', [chatId]);

/* ===========================
   DATABASE
=========================== */

(async () => {
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
    console.log("🚀 Bot started");
})();

bot.use(session());

/* ===========================
   START
=========================== */

bot.start(async (ctx) => {
    ctx.session = { step: 'LANG' };

    await ctx.reply("Select Language:",
        Markup.keyboard([['🇺🇿 UZ', '🇷🇺 RU', '🇺🇸 EN']]).resize()
    );
});

/* ===========================
   MAIN HANDLER
=========================== */

bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const step = ctx.session?.step;

    let user = await getUser(chatId);
    if (user?.blocked)
        return ctx.reply(strings[user.lang || '🇺🇸 EN'].blocked);

    /* LANGUAGE */
    if (step === 'LANG' && strings[text]) {
        await db.run(`
      INSERT INTO users (chatId, lang)
      VALUES (?, ?)
      ON CONFLICT(chatId) DO UPDATE SET lang=excluded.lang
    `, [chatId, text]);

        ctx.session.step = 'PHONE';
        return ctx.reply(strings[text].askPhone,
            Markup.keyboard([
                [Markup.button.contactRequest(strings[text].btnPhone)]
            ]).resize()
        );
    }

    /* PHONE */
    if (step === 'PHONE' && ctx.message.contact) {
        if (ctx.message.contact.user_id !== ctx.from.id)
            return ctx.reply("❌ Send your own number.");

        await db.run(
            'UPDATE users SET phone=? WHERE chatId=?',
            [ctx.message.contact.phone_number, chatId]
        );

        ctx.session.step = 'NAME';
        user = await getUser(chatId);
        return ctx.reply(strings[user.lang].askName, Markup.removeKeyboard());
    }

    /* NAME */
    if (step === 'NAME' && text) {
        await db.run(
            'UPDATE users SET name=? WHERE chatId=?',
            [text, chatId]
        );

        ctx.session.step = 'VIDEO';
        user = await getUser(chatId);
        return ctx.reply(strings[user.lang].askVideo);
    }

    /* VIDEO */
    if (step === 'VIDEO' && ctx.message.video) {
        user = await getUser(chatId);

        try {
            await ctx.telegram.sendVideo(CHANNEL_ID, ctx.message.video.file_id, {
                caption:
                    `📹 *New Upload*
👤 Name: ${escape(user.name)}
📞 Phone: ${escape(user.phone)}
🆔 ID: \`${chatId}\``,
                parse_mode: 'MarkdownV2'
            });

            await db.run(
                'INSERT INTO uploads (chatId, userName, fileId) VALUES (?, ?, ?)',
                [chatId, user.name, ctx.message.video.file_id]
            );

            ctx.session = null;
            return ctx.reply(strings[user.lang].done);

        } catch (e) {
            console.error(e);
            return ctx.reply(strings[user.lang].error);
        }
    }

    /* ADMIN COMMAND */
    if (chatId === ADMIN_ID && text === '/admin') {
        return showAdmin(ctx);
    }
    // ──────────────────────────────────────────────
    // Replace your current broadcast block with this:
    // ──────────────────────────────────────────────

    if (ctx.session?.step === 'BROADCAST' && chatId === ADMIN_ID) {

        // Optional: let admin cancel
        if (text === '❌ Cancel') {
            ctx.session = null;
            return ctx.reply("❌ Cancelled.", Markup.removeKeyboard());
        }

        const users = await db.all(
            'SELECT chatId FROM users WHERE blocked = 0'
        );

        let success = 0;
        let failed = 0;

        // Important: remember the message we want to broadcast
        const messageToForward = ctx.message;

        // Clear session **before** the long loop (prevents re-trigger on next messages)
        ctx.session = null;

        // Now do the heavy work
        for (const u of users) {
            try {
                await ctx.telegram.copyMessage(
                    u.chatId,
                    messageToForward.chat.id,
                    messageToForward.message_id
                );
                success++;
            } catch (err) {
                failed++;
                console.error(`Failed to send to ${u.chatId}:`, err.message);
            }
        }

        return ctx.reply(
            `📢 Broadcast finished\n\n` +
            `✅ Sent: ${success}\n` +
            `❌ Failed: ${failed}`,
            Markup.removeKeyboard()
        );
    }

});

/* ===========================
   ADMIN PANEL
=========================== */

async function showAdmin(ctx) {
    return ctx.reply(strings['🇺🇸 EN'].adminMenu,
        Markup.inlineKeyboard([
            [Markup.button.callback('👥 Users', 'admin_users')],
            [Markup.button.callback('📥 Export', 'admin_export')],
            // [Markup.button.callback('📢 Broadcast', 'admin_broadcast')]
        ])
    );
}

bot.action('admin_users', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const users = await db.all('SELECT * FROM users');
    if (!users.length)
        return ctx.answerCbQuery("No users.");

    const buttons = users.map(u => [
        Markup.button.callback(
            `${u.blocked ? '🚫' : '👤'} ${u.name || 'No Name'}`,
            `info_${u.chatId}`
        )
    ]);

    await ctx.answerCbQuery();
    return ctx.reply("Users:", Markup.inlineKeyboard(buttons));
});

bot.action(/info_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const id = ctx.match[1];
    const user = await getUser(id);

    const text =
        `👤 Name: ${user.name}
📞 Phone: ${user.phone}
🌍 Lang: ${user.lang}
🛡 Status: ${user.blocked ? 'Blocked' : 'Active'}`;

    return ctx.reply(text,
        Markup.inlineKeyboard([
            [
                user.blocked
                    ? Markup.button.callback('✅ Unblock', `unblock_${id}`)
                    : Markup.button.callback('🚫 Block', `block_${id}`)
            ]
        ])
    );
});
// --- BLOCK HANDLER ---
bot.action(/block_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const id = ctx.match[1];

    if (Number(id) === ADMIN_ID) return ctx.answerCbQuery("❌ Cannot block yourself.");

    try {
        await db.run('UPDATE users SET blocked = 1 WHERE chatId = ?', [id]);
        const user = await getUser(id); // Using the helper function above

        await ctx.answerCbQuery("User blocked 🚫");
        return ctx.editMessageText(
            `👤 Name: ${user.name || 'N/A'}\n📞 Phone: ${user.phone || 'N/A'}\n🌍 Lang: ${user.lang}\n🛡 Status: 🚫 Blocked`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('✅ Unblock', `unblock_${id}`)]])
            }
        ).catch(() => { }); // Catch "message not modified" errors
    } catch (err) {
        console.error(err);
        ctx.reply("Error blocking user.");
    }
});

// --- UNBLOCK HANDLER ---
bot.action(/unblock_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const id = ctx.match[1];

    try {
        await db.run('UPDATE users SET blocked = 0 WHERE chatId = ?', [id]);
        const user = await getUser(id); // Using the helper function above

        await ctx.answerCbQuery("User unblocked ✅");
        return ctx.editMessageText(
            `👤 Name: ${user.name || 'N/A'}\n📞 Phone: ${user.phone || 'N/A'}\n🌍 Lang: ${user.lang}\n🛡 Status: ✅ Active`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Block', `block_${id}`)]])
            }
        ).catch(() => { });
    } catch (err) {
        console.error(err);
        ctx.reply("Error unblocking user.");
    }
});

bot.action('admin_export', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Unauthorized");

    try {
        // SQL JOIN: Get data from uploads and join the phone number from the users table
        const data = await db.all(`
            SELECT 
                u.userName, 
                u.chatId, 
                u.fileId, 
                u.timestamp, 
                usr.phone 
            FROM uploads u
            LEFT JOIN users usr ON u.chatId = usr.chatId
        `);

        if (data.length === 0) return ctx.answerCbQuery("No data to export!");

        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('All Uploads');

        // Define Columns
        sheet.columns = [
            { header: 'User Name', key: 'userName', width: 20 },
            { header: 'Chat ID', key: 'chatId', width: 15 },
            { header: 'Phone Number', key: 'phone', width: 15 },
            { header: 'File ID', key: 'fileId', width: 35 },
            { header: 'Date/Time', key: 'timestamp', width: 20 }
        ];

        // Add rows to the sheet
        data.forEach(row => {
            sheet.addRow({
                userName: row.userName,
                chatId: row.chatId,
                phone: row.phone || 'N/A', // Shows N/A if phone is missing
                fileId: row.fileId,
                timestamp: row.timestamp
            });
        });

        const buffer = await wb.xlsx.writeBuffer();

        await ctx.answerCbQuery("Exporting...");
        return await ctx.replyWithDocument({
            source: buffer,
            filename: `uploads_report_${new Date().toISOString().split('T')[0]}.xlsx`
        });

    } catch (err) {
        console.error("Export Error:", err);
        return ctx.reply("❌ Failed to generate Excel report.");
    }
});

bot.action('admin_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const user = await getUser(ctx.from.id);
    const lang = user?.lang || '🇺🇸 EN';

    ctx.session.step = 'BROADCAST';

    await ctx.answerCbQuery();

    return ctx.reply(
        strings[lang].broadcastAsk,
        Markup.keyboard([['❌ Cancel']]).resize()
    );
});

/* ===========================
   ERROR HANDLER
=========================== */

bot.catch((err) => console.error("BOT ERROR:", err));

bot.launch();
