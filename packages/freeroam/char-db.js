// SQLite через sql.js (чистый JS + WASM, без нативных модулей и без внешнего сервера БД).
// Файл БД: server.db в корне server-files. Сохраняется на диск через db.export().
const fs = require('fs');
const path = require('path');
const initSqlJs = require('./sql/sql-wasm.js');

const DB_FILE = path.join(__dirname, '..', '..', 'server.db');
const WASM_FILE = path.join(__dirname, 'sql', 'sql-wasm.wasm');

const CREATE_TABLE = 'CREATE TABLE characters (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'social TEXT NOT NULL UNIQUE,' +
    'name TEXT NOT NULL,' +
    'gender INTEGER NOT NULL DEFAULT 0,' +
    'appearance TEXT NOT NULL DEFAULT \'{}\',' +
    'created INTEGER NOT NULL,' +
    'lastLogin INTEGER' +
    ')';

const CREATE_PERMS_TABLE = 'CREATE TABLE IF NOT EXISTS admin_perms (' +
    'id INTEGER PRIMARY KEY,' +
    'cmds TEXT NOT NULL DEFAULT \'{}\',' +
    'updated INTEGER NOT NULL' +
    ')';

let db = null;
const waiting = [];

function whenReady(fn) {
    if (db) {
        try { fn(); } catch (e) { console.log(`[DB] query err: ${e}`); }
    } else {
        waiting.push(fn);
    }
}

function persist() {
    try {
        fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
    } catch (e) {
        console.log(`[DB] save err: ${e}`);
    }
}

initSqlJs({ wasmBinary: fs.readFileSync(WASM_FILE) })
    .then((SQL) => {
        db = fs.existsSync(DB_FILE)
            ? new SQL.Database(new Uint8Array(fs.readFileSync(DB_FILE)))
            : new SQL.Database();

        // Миграция: если таблицы нет — создаём. Если есть, но без id — пересоздаём (статические id)
        const cols = db.exec('PRAGMA table_info(characters)');
        const hasTable = cols[0] && cols[0].values.length > 0;
        const hasId = hasTable && cols[0].values.some((r) => r[1] === 'id');
        if (hasTable && !hasId) {
            db.run('ALTER TABLE characters RENAME TO characters_old');
            db.run(CREATE_TABLE);
            db.run('INSERT INTO characters (social, name, gender, appearance, created, lastLogin) ' +
                'SELECT social, name, gender, appearance, created, lastLogin FROM characters_old');
            db.run('DROP TABLE characters_old');
            console.log('[DB] таблица characters мигрирована: добавлен статический id');
        } else if (!hasTable) {
            db.run(CREATE_TABLE);
        }

        if (!fs.existsSync(DB_FILE)) persist();
        db.run(CREATE_PERMS_TABLE);
        let count = 0;
        try {
            const rows = db.exec('SELECT COUNT(*) AS c FROM characters');
            count = rows && rows[0] ? rows[0].values[0][0] : 0;
        } catch (e) { /* ignore */ }
        console.log(`[DB] SQLite готов. Персонажей: ${count}`);
        while (waiting.length) waiting.shift()();
    })
    .catch((e) => console.log(`[DB] init err: ${e}`));

module.exports = {
    whenReady,
    persist,
    getCharacter(social, cb) {
        whenReady(() => {
            let result = null;
            try {
                const res = db.exec('SELECT id, name, gender, appearance FROM characters WHERE social = ?', [social]);
                const v = res[0] && res[0].values[0];
                if (v) {
                    result = { id: v[0], name: v[1], gender: v[2], appearance: JSON.parse(v[3] || '{}') };
                }
            } catch (e) {
                console.log(`[DB] getCharacter err: ${e}`);
            }
            cb(result);
        });
    },
    upsertCharacter(social, name, gender, appearance, cb) {
        whenReady(() => {
            let id = null;
            try {
                db.run(
                    'INSERT INTO characters (social, name, gender, appearance, created, lastLogin) VALUES (?,?,?,?,?,?) ' +
                    'ON CONFLICT(social) DO UPDATE SET name=excluded.name, gender=excluded.gender, appearance=excluded.appearance, lastLogin=excluded.lastLogin',
                    [social, name, gender, JSON.stringify(appearance), Date.now(), Date.now()]
                );
                const res = db.exec('SELECT id FROM characters WHERE social = ?', [social]);
                const v = res[0] && res[0].values[0];
                if (v) id = v[0];
                persist();
            } catch (e) {
                console.log(`[DB] upsertCharacter err: ${e}`);
            }
            if (cb) cb(id);
        });
    },
    getPerms(cb) {
        whenReady(() => {
            const out = {};
            try {
                const res = db.exec('SELECT id, cmds FROM admin_perms');
                if (res[0]) {
                    res[0].values.forEach((r) => {
                        try { out[r[0]] = JSON.parse(r[1] || '{}'); } catch (e) { out[r[0]] = {}; }
                    });
                }
            } catch (e) {
                console.log(`[DB] getPerms err: ${e}`);
            }
            cb(out);
        });
    },
    savePerms(id, cmdsObj) {
        whenReady(() => {
            try {
                db.run(
                    'INSERT INTO admin_perms (id, cmds, updated) VALUES (?,?,?) ' +
                    'ON CONFLICT(id) DO UPDATE SET cmds=excluded.cmds, updated=excluded.updated',
                    [id, JSON.stringify(cmdsObj || {}), Date.now()]
                );
                persist();
            } catch (e) {
                console.log(`[DB] savePerms err: ${e}`);
            }
        });
    }
};