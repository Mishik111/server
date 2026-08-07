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
    'money INTEGER NOT NULL DEFAULT 5000,' +
    'chips INTEGER NOT NULL DEFAULT 0,' +
    'created INTEGER NOT NULL,' +
    'lastLogin INTEGER' +
    ')';

const CREATE_PERMS_TABLE = 'CREATE TABLE IF NOT EXISTS admin_perms (' +
    'id INTEGER PRIMARY KEY,' +
    'cmds TEXT NOT NULL DEFAULT \'{}\',' +
    'updated INTEGER NOT NULL' +
    ')';

// Тюремные записи (Demorgan + посадка задержанного): переживают рестарт сервера
const CREATE_JAILS_TABLE = 'CREATE TABLE IF NOT EXISTS jails (' +
    'citizenId INTEGER PRIMARY KEY,' +
    'release INTEGER NOT NULL,' +
    'reason TEXT NOT NULL DEFAULT \'\',' +
    'comment TEXT NOT NULL DEFAULT \'\',' +
    'updated INTEGER NOT NULL' +
    ')';

// Розыск: переживает рестарт сервера
const CREATE_WANTED_TABLE = 'CREATE TABLE IF NOT EXISTS wanted (' +
    'citizenId INTEGER PRIMARY KEY,' +
    'stars INTEGER NOT NULL DEFAULT 0,' +
    'reason TEXT NOT NULL DEFAULT \'\',' +
    'updated INTEGER NOT NULL' +
    ')';

// Бинды клавиш игрока (/bind): переживают рестарт сервера и перезаход
const CREATE_BINDS_TABLE = 'CREATE TABLE IF NOT EXISTS binds (' +
    'citizenId INTEGER PRIMARY KEY,' +
    'data TEXT NOT NULL DEFAULT \'{}\',' +
    'updated INTEGER NOT NULL' +
    ')';

// Дома (/hcreate, /hbuy, /hsell): переживают рестарт сервера
const CREATE_HOUSES_TABLE = 'CREATE TABLE IF NOT EXISTS houses (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'name TEXT NOT NULL DEFAULT \'Дом\',' +
    'price INTEGER NOT NULL DEFAULT 100000,' +
    'x REAL NOT NULL,' +
    'y REAL NOT NULL,' +
    'z REAL NOT NULL,' +
    'owner INTEGER NOT NULL DEFAULT 0,' +
    'ix REAL,' +
    'iy REAL,' +
    'iz REAL,' +
    'ih REAL NOT NULL DEFAULT 0,' +
    'created INTEGER NOT NULL,' +
    'updated INTEGER NOT NULL' +
    ')';

// Телепорт-маркеры (/tpmark, /tptarget): переживают рестарт сервера
const CREATE_TELEPORTS_TABLE = 'CREATE TABLE IF NOT EXISTS teleports (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    'name TEXT NOT NULL DEFAULT \'Телепорт\',' +
    'x REAL NOT NULL,' +
    'y REAL NOT NULL,' +
    'z REAL NOT NULL,' +
    'tx REAL NOT NULL,' +
    'ty REAL NOT NULL,' +
    'tz REAL NOT NULL,' +
    'th REAL NOT NULL DEFAULT 0,' +
    'eh REAL NOT NULL DEFAULT 0,' +
    'created INTEGER NOT NULL,' +
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
        db.run(CREATE_JAILS_TABLE);
        db.run(CREATE_WANTED_TABLE);
        db.run(CREATE_BINDS_TABLE);
        db.run(CREATE_HOUSES_TABLE);
        db.run(CREATE_TELEPORTS_TABLE);
        // Миграция: heading на точке входа (eh) в старой таблице teleports
        try {
            const tcols = db.exec('PRAGMA table_info(teleports)');
            if (tcols[0] && !tcols[0].values.some((c) => c[1] === 'eh')) {
                db.run('ALTER TABLE teleports ADD COLUMN eh REAL NOT NULL DEFAULT 0');
                console.log('[DB] таблица teleports мигрирована: добавлена колонка eh');
            }
        } catch (e) { /* ignore */ }
        // Миграция: интерьер дома (ix, iy, iz, ih) в старой таблице houses
        try {
            const hcols = db.exec('PRAGMA table_info(houses)');
            if (hcols[0]) {
                const names = hcols[0].values.map((c) => c[1]);
                if (!names.includes('ix')) {
                    db.run('ALTER TABLE houses ADD COLUMN ix REAL');
                    console.log('[DB] таблица houses мигрирована: добавлена колонка ix');
                }
                if (!names.includes('iy')) db.run('ALTER TABLE houses ADD COLUMN iy REAL');
                if (!names.includes('iz')) db.run('ALTER TABLE houses ADD COLUMN iz REAL');
                if (!names.includes('ih')) {
                    db.run('ALTER TABLE houses ADD COLUMN ih REAL NOT NULL DEFAULT 0');
                    console.log('[DB] таблица houses мигрирована: добавлена колонка ih');
                }
            }
        } catch (e) { /* ignore */ }
        // Миграция: деньги и фишки (казино) в старой таблице characters
        try {
            const ccols = db.exec('PRAGMA table_info(characters)');
            if (ccols[0] && !ccols[0].values.some((c) => c[1] === 'money')) {
                db.run('ALTER TABLE characters ADD COLUMN money INTEGER NOT NULL DEFAULT 5000');
                console.log('[DB] таблица characters мигрирована: добавлена колонка money');
            }
            const ccols2 = db.exec('PRAGMA table_info(characters)');
            if (ccols2[0] && !ccols2[0].values.some((c) => c[1] === 'chips')) {
                db.run('ALTER TABLE characters ADD COLUMN chips INTEGER NOT NULL DEFAULT 0');
                console.log('[DB] таблица characters мигрирована: добавлена колонка chips');
            }
        } catch (e) { /* ignore */ }
        // Миграция: добавляем колонку comment в старую таблицу jails (если её нет)
        try {
            const jcols = db.exec('PRAGMA table_info(jails)');
            if (jcols[0] && !jcols[0].values.some((c) => c[1] === 'comment')) {
                db.run("ALTER TABLE jails ADD COLUMN comment TEXT NOT NULL DEFAULT ''");
                console.log('[DB] таблица jails мигрирована: добавлена колонка comment');
            }
        } catch (e) { /* ignore */ }
        // Миграция: добавляем колонку type (demorgan | prison) в jails (если её нет)
        try {
            const jtcols = db.exec('PRAGMA table_info(jails)');
            if (jtcols[0] && !jtcols[0].values.some((c) => c[1] === 'jtype')) {
                db.run("ALTER TABLE jails ADD COLUMN jtype TEXT NOT NULL DEFAULT 'demorgan'");
                console.log('[DB] таблица jails мигрирована: добавлена колонка jtype');
            }
        } catch (e) { /* ignore */ }
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
                const res = db.exec('SELECT id, name, gender, appearance, money, chips FROM characters WHERE social = ?', [social]);
                const v = res[0] && res[0].values[0];
                if (v) {
                    result = {
                        id: v[0], name: v[1], gender: v[2], appearance: JSON.parse(v[3] || '{}'),
                        money: v[4] == null ? 5000 : v[4],
                        chips: v[5] == null ? 0 : v[5]
                    };
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
    },
    saveBalance(citizenId, money, chips) {
        whenReady(() => {
            try {
                db.run('UPDATE characters SET money = ?, chips = ?, lastLogin = ? WHERE id = ?',
                    [Math.max(0, parseInt(money, 10) || 0), Math.max(0, parseInt(chips, 10) || 0), Date.now(), citizenId]);
                persist();
            } catch (e) {
                console.log(`[DB] saveBalance err: ${e}`);
            }
        });
    },
    saveJail(citizenId, release, reason, comment, type) {
        whenReady(() => {
            try {
                db.run(
                    'INSERT INTO jails (citizenId, release, reason, comment, jtype, updated) VALUES (?,?,?,?,?,?) ' +
                    'ON CONFLICT(citizenId) DO UPDATE SET release=excluded.release, reason=excluded.reason, comment=excluded.comment, jtype=excluded.jtype, updated=excluded.updated',
                    [citizenId, Math.floor(release), String(reason || ''), String(comment || ''), String(type || 'demorgan'), Date.now()]
                );
                persist();
            } catch (e) {
                console.log(`[DB] saveJail err: ${e}`);
            }
        });
    },
    removeJail(citizenId) {
        whenReady(() => {
            try {
                db.run('DELETE FROM jails WHERE citizenId = ?', [citizenId]);
                persist();
            } catch (e) {
                console.log(`[DB] removeJail err: ${e}`);
            }
        });
    },
    getJails(cb) {
        whenReady(() => {
            const out = [];
            try {
                const res = db.exec('SELECT citizenId, release, reason, comment, jtype FROM jails');
                if (res[0]) {
                    res[0].values.forEach((r) => out.push({ citizenId: r[0], release: r[1], reason: r[2] || '', comment: r[3] || '', jtype: r[4] || 'demorgan' }));
                }
            } catch (e) {
                console.log(`[DB] getJails err: ${e}`);
            }
            cb(out);
        });
    },
    saveWanted(citizenId, stars, reason) {
        whenReady(() => {
            try {
                if (!stars || stars < 1) {
                    db.run('DELETE FROM wanted WHERE citizenId = ?', [citizenId]);
                } else {
                    db.run(
                        'INSERT INTO wanted (citizenId, stars, reason, updated) VALUES (?,?,?,?) ' +
                        'ON CONFLICT(citizenId) DO UPDATE SET stars=excluded.stars, reason=excluded.reason, updated=excluded.updated',
                        [citizenId, Math.max(1, Math.min(5, parseInt(stars, 10) || 1)), String(reason || ''), Date.now()]
                    );
                }
                persist();
            } catch (e) {
                console.log(`[DB] saveWanted err: ${e}`);
            }
        });
    },
    removeWanted(citizenId) {
        whenReady(() => {
            try {
                db.run('DELETE FROM wanted WHERE citizenId = ?', [citizenId]);
                persist();
            } catch (e) {
                console.log(`[DB] removeWanted err: ${e}`);
            }
        });
    },
    getWanted(cb) {
        whenReady(() => {
            const out = [];
            try {
                const res = db.exec('SELECT citizenId, stars, reason FROM wanted');
                if (res[0]) {
                    res[0].values.forEach((r) => out.push({ citizenId: r[0], stars: r[1] || 0, reason: r[2] || '' }));
                }
            } catch (e) {
                console.log(`[DB] getWanted err: ${e}`);
            }
            cb(out);
        });
    },
    saveBinds(citizenId, bindsObj) {
        whenReady(() => {
            try {
                let data = '{}';
                if (bindsObj && typeof bindsObj === 'object') {
                    const clean = {};
                    Object.keys(bindsObj).forEach((k) => {
                        const num = Number(k);
                        if (Number.isInteger(num) && bindsObj[k]) clean[num] = String(bindsObj[k]);
                    });
                    data = JSON.stringify(clean);
                }
                db.run(
                    'INSERT INTO binds (citizenId, data, updated) VALUES (?,?,?) ' +
                    'ON CONFLICT(citizenId) DO UPDATE SET data=excluded.data, updated=excluded.updated',
                    [citizenId, data, Date.now()]
                );
                persist();
            } catch (e) {
                console.log(`[DB] saveBinds err: ${e}`);
            }
        });
    },
    getBinds(citizenId, cb) {
        whenReady(() => {
            let data = {};
            try {
                const res = db.exec('SELECT data FROM binds WHERE citizenId = ?', [citizenId]);
                const v = res[0] && res[0].values[0];
                if (v && v[0]) {
                    const parsed = JSON.parse(v[0]);
                    if (parsed && typeof parsed === 'object') data = parsed;
                }
            } catch (e) {
                console.log(`[DB] getBinds err: ${e}`);
            }
            cb(data);
        });
    },
    getHouses(cb) {
        whenReady(() => {
            const out = [];
            try {
                const res = db.exec('SELECT id, name, price, x, y, z, owner, ix, iy, iz, ih FROM houses ORDER BY id');
                if (res[0]) {
                    res[0].values.forEach((r) => out.push({
                        id: r[0], name: r[1] || 'Дом', price: r[2] || 0,
                        x: r[3], y: r[4], z: r[5], owner: r[6] || 0,
                        ix: r[7], iy: r[8], iz: r[9], ih: r[10] || 0
                    }));
                }
            } catch (e) {
                console.log(`[DB] getHouses err: ${e}`);
            }
            cb(out);
        });
    },
    createHouse(data, cb) {
        whenReady(() => {
            let id = null;
            try {
                db.run(
                    'INSERT INTO houses (name, price, x, y, z, owner, ix, iy, iz, ih, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                    [String(data.name || 'Дом'), parseInt(data.price, 10) || 0, data.x, data.y, data.z,
                    data.owner || 0, data.ix, data.iy, data.iz, data.ih || 0, Date.now(), Date.now()]
                );
                const res = db.exec('SELECT id FROM houses WHERE rowid = last_insert_rowid()');
                const v = res[0] && res[0].values[0];
                if (v) id = v[0];
                persist();
            } catch (e) {
                console.log(`[DB] createHouse err: ${e}`);
            }
            if (cb) cb(id);
        });
    },
    updateHouseOwner(houseId, owner) {
        whenReady(() => {
            try {
                db.run('UPDATE houses SET owner = ?, updated = ? WHERE id = ?',
                    [owner || 0, Date.now(), houseId]);
                persist();
            } catch (e) {
                console.log(`[DB] updateHouseOwner err: ${e}`);
            }
        });
    },
    updateHouseInterior(houseId, x, y, z, heading) {
        whenReady(() => {
            try {
                db.run('UPDATE houses SET ix = ?, iy = ?, iz = ?, ih = ?, updated = ? WHERE id = ?',
                    [x, y, z, heading || 0, Date.now(), houseId]);
                persist();
            } catch (e) {
                console.log(`[DB] updateHouseInterior err: ${e}`);
            }
        });
    },
    deleteHouse(houseId) {
        whenReady(() => {
            try {
                db.run('DELETE FROM houses WHERE id = ?', [houseId]);
                persist();
            } catch (e) {
                console.log(`[DB] deleteHouse err: ${e}`);
            }
        });
    },
    getTeleports(cb) {
        whenReady(() => {
            const out = [];
            try {
                const res = db.exec('SELECT id, name, x, y, z, tx, ty, tz, th, eh FROM teleports ORDER BY id');
                if (res[0]) {
                    res[0].values.forEach((r) => out.push({
                        id: r[0], name: r[1] || 'Телепорт',
                        x: r[2], y: r[3], z: r[4],
                        tx: r[5], ty: r[6], tz: r[7], th: r[8] || 0, eh: r[9] || 0
                    }));
                }
            } catch (e) {
                console.log(`[DB] getTeleports err: ${e}`);
            }
            cb(out);
        });
    },
    createTeleport(data, cb) {
        whenReady(() => {
            let id = null;
            try {
                db.run(
                    'INSERT INTO teleports (name, x, y, z, tx, ty, tz, th, eh, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    [String(data.name || 'Телепорт'), data.x, data.y, data.z,
                    data.tx, data.ty, data.tz, data.th || 0, data.eh || 0, Date.now(), Date.now()]
                );
                const res = db.exec('SELECT id FROM teleports WHERE rowid = last_insert_rowid()');
                const v = res[0] && res[0].values[0];
                if (v) id = v[0];
                persist();
            } catch (e) {
                console.log(`[DB] createTeleport err: ${e}`);
            }
            if (cb) cb(id);
        });
    },
    updateTeleportTarget(teleportId, tx, ty, tz, th) {
        whenReady(() => {
            try {
                db.run('UPDATE teleports SET tx = ?, ty = ?, tz = ?, th = ?, updated = ? WHERE id = ?',
                    [tx, ty, tz, th || 0, Date.now(), teleportId]);
                persist();
            } catch (e) {
                console.log(`[DB] updateTeleportTarget err: ${e}`);
            }
        });
    },
    updateTeleportMarker(teleportId, x, y, z, eh) {
        whenReady(() => {
            try {
                db.run('UPDATE teleports SET x = ?, y = ?, z = ?, eh = ?, updated = ? WHERE id = ?',
                    [x, y, z, eh || 0, Date.now(), teleportId]);
                persist();
            } catch (e) {
                console.log(`[DB] updateTeleportMarker err: ${e}`);
            }
        });
    },
    deleteTeleport(teleportId) {
        whenReady(() => {
            try {
                db.run('DELETE FROM teleports WHERE id = ?', [teleportId]);
                persist();
            } catch (e) {
                console.log(`[DB] deleteTeleport err: ${e}`);
            }
        });
    }
};