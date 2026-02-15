const { Telegraf, Markup, session } = require('telegraf');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');

const bot = new Telegraf('8256004519:AAHo1m0KEQ8q2UG6T8mNf3CUOKUBZoSkijM');
const ADMIN_ID = 123456789; // YOUR TELEGRAM ID

let db;

(async () => {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    // PERFORMANCE TWEAKS FOR LOCAL STORAGE
    await db.exec('PRAGMA journal_mode = WAL;'); // Allows concurrent read/write
    await db.exec('PRAGMA synchronous = NORMAL;'); // Speeds up disk writing

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
    console.log("🚀 Bot is live locally!");
})();

bot.use(session());

bot.on('message', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    // 1. Admin bypass (Instant)
    if (chatId === ADMIN_ID && text?.startsWith('/admin')) {
        return handleAdmin(ctx);
    }

    // 2. Check block status (Fast query)
    const userStatus = await db.get('SELECT blocked FROM users WHERE chatId = ?', [chatId]);
    if (userStatus?.blocked) return ctx.reply("🚫 You are blocked.");

    // 3. Logic flow
    const step = ctx.session?.step;

    if (text === '/start') {
        ctx.session = { step: 'ASK_LANG' };
        return ctx.reply("Select Language:", Markup.keyboard([['🇺🇿 UZ', '🇷🇺 RU', '🇺🇸 EN']]).resize());
    }

    // Handle steps
    if (step === 'ASK_LANG') {
        db.run('INSERT OR REPLACE INTO users (chatId, lang) VALUES (?, ?)', [chatId, text]);
        ctx.session.step = 'ASK_PHONE';
        return ctx.reply("Share phone:", Markup.keyboard([[Markup.button.contactRequest("📱 Send Phone")]]).resize());
    }

    if (step === 'ASK_PHONE' && ctx.message.contact) {
        db.run('UPDATE users SET phone = ? WHERE chatId = ?', [ctx.message.contact.phone_number, chatId]);
        ctx.session.step = 'ASK_NAME';
        return ctx.reply("What is your name?", Markup.removeKeyboard());
    }

    if (step === 'ASK_NAME') {
        db.run('UPDATE users SET name = ? WHERE chatId = ?', [text, chatId]);
        ctx.session.step = 'ASK_VIDEO';
        return ctx.reply("Now upload the video!");
    }

    if (step === 'ASK_VIDEO' && ctx.message.video) {
        const user = await db.get('SELECT name FROM users WHERE chatId = ?', [chatId]);
        db.run('INSERT INTO uploads (chatId, userName, fileId) VALUES (?, ?, ?)', [chatId, user.name, ctx.message.video.file_id]);
        ctx.session.step = null;
        return ctx.reply("✅ Done!");
    }
});

// Admin Panel Functions
async function handleAdmin(ctx) {
    const cmd = ctx.message.text;
    if (cmd === '/admin_export') {
        const data = await db.all('SELECT * FROM uploads');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Uploads');
        sheet.columns = [{header:'User', key:'userName'}, {header:'FileID', key:'fileId'}, {header:'Time', key:'timestamp'}];
        data.forEach(d => sheet.addRow(d));
        const buffer = await workbook.xlsx.writeBuffer();
        return ctx.replyWithDocument({ source: buffer, filename: 'data.xlsx' });
    }
    // ... other admin commands
}

bot.launch();