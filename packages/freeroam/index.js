// ---------- База данных персонажей (SQLite) ----------
const db = require('./char-db.js');

// Уникальный СТАТИЧЕСКИЙ id игрока (постоянный, из базы данных).
// Выдаётся один раз при создании персонажа и больше не меняется.
mp.events.add('playerJoin', (player) => {
    // ---------- Статический id + персонаж из базы данных (SQLite) ----------
    player._charReady = false;
    player._playerReady = false;
    player.charPending = false;
    try {
        db.getCharacter(player.socialClub, (ch) => {
            try {
                if (ch) {
                    // Возвращающийся игрок: статический id + имя и внешность
                    player.citizenId = ch.id;
                    player.setVariable('citizenId', ch.id);
                    player.char = ch;
                    player.setVariable('charName', ch.name);
                    player._charReady = true;
                    applyAppearance(player, ch.gender, ch.appearance);
                } else {
                    // Первый вход: нужно создать персонажа (id выдастся при создании)
                    player.charPending = true;
                    if (player._playerReady) startCharacterCreation(player);
                }
            } catch (e) {
                console.log(`[char] lookup cb err: ${e}`);
            }
        });
    } catch (e) {
        console.log(`[char] lookup err: ${e}`);
    }
});

mp.events.add('playerQuit', (player) => {
    delete player.citizenId;
});

mp.events.add('playerReady', (player) => {
    player._playerReady = true;
    player.outputChatBox('Добро пожаловать на сервер! Используйте админ-команды.');
    if (player.charPending) startCharacterCreation(player);
});

const SPAWN_POS = new mp.Vector3(186.4, -909.8, 30.7);
// Открытое плоское место (аэродром Sandy Shores) — чтобы вокруг не было стен
const LOBBY_POS = new mp.Vector3(1718.0, 3275.0, 41.0);

function startCharacterCreation(player) {
    if (player.charPending !== true) return;
    openCharEditor(player, null);
}

// /reset — изменить внешность/имя существующего персонажа
mp.events.addCommand('reset', (player) => {
    if (!player.char) {
        player.outputChatBox('!{FF4444}У вас ещё нет персонажа.');
        return;
    }
    if (player.charPending || player.charEditing) {
        player.outputChatBox('!{FF4444}Редактор персонажа уже открыт.');
        return;
    }
    player.charEditing = true;
    openCharEditor(player, {
        name: player.char.name,
        gender: player.char.gender,
        appearance: player.char.appearance
    });
});

function openCharEditor(player, prefill) {
    try {
        player.position = LOBBY_POS;
        // Своя вселенная: во время создания персонажа других игроков не видно
        player.dimension = 1000 + player.id;
        player.call('char:openCreator', [prefill ? JSON.stringify(prefill) : null]);
    } catch (e) {
        console.log(`[char] open editor err: ${e}`);
    }
}

function clampNum(v, min, max) {
    v = Number(v);
    if (isNaN(v)) v = min;
    return Math.max(min, Math.min(max, v));
}
function intClamp(v, min, max) { return Math.round(clampNum(v, min, max)); }

// Пределы freemode-одежды по полу
const CLOTH_LIMITS = {
    male: { top: 281, pants: 108, shoes: 88, undershirt: 32, arms: 48, accessory: 130, hair: 73 },
    female: { top: 262, pants: 122, shoes: 88, undershirt: 32, arms: 46, accessory: 125, hair: 73 }
};
// Максимум стилей головных оверлеев по слотам (0 = выкл)
const OVERLAY_MAX = [23, 28, 33, 14, 74, 6, 11, 10, 17, 16];

function sanitizeAppearance(a, gender) {
    const lim = CLOTH_LIMITS[gender === 1 ? 'female' : 'male'];
    const hb = a.headBlend || {};
    const face = Array.isArray(a.face) ? a.face.slice(0, 20).map((v) => clampNum(v, -1, 1)) : [];
    while (face.length < 20) face.push(0);
    const hair = a.hair || {};
    const cl = a.clothes || {};
    // item: старый формат (число) или новый ({d, t})
    const clothItem = (key, max) => {
        const v = cl[key];
        if (v && typeof v === 'object') {
            return { d: intClamp(v.d, 0, max), t: intClamp(v.t, 0, 9) };
        }
        return { d: intClamp(v, 0, max), t: 0 };
    };
    const overlays = [];
    const ov = Array.isArray(a.overlays) ? a.overlays : [];
    for (let i = 0; i < 10; i++) {
        const o = ov[i] || {};
        overlays.push({ s: intClamp(o.s, 0, OVERLAY_MAX[i]), o: clampNum(o.o, 0, 1) });
    }
    let tattoo = null;
    if (a.tattoo && typeof a.tattoo === 'object' && a.tattoo.collection && a.tattoo.overlay) {
        tattoo = {
            collection: String(a.tattoo.collection).slice(0, 64),
            overlay: String(a.tattoo.overlay).slice(0, 64)
        };
    }
    return {
        headBlend: {
            shapeFirst: intClamp(hb.shapeFirst, 0, 45),
            shapeSecond: intClamp(hb.shapeSecond, 0, 45),
            shapeThird: intClamp(hb.shapeThird, 0, 45),
            skinFirst: intClamp(hb.skinFirst, 0, 45),
            skinSecond: intClamp(hb.skinSecond, 0, 45),
            skinThird: intClamp(hb.skinThird, 0, 45),
            shapeMix: clampNum(hb.shapeMix, 0, 1),
            skinMix: clampNum(hb.skinMix, 0, 1),
            thirdMix: clampNum(hb.thirdMix, 0, 1)
        },
        face,
        overlays,
        hair: {
            style: intClamp(hair.style, 0, 73),
            colorId: intClamp(hair.colorId, 0, 63),
            highlight: intClamp(hair.highlight, 0, 63)
        },
        eyes: intClamp(a.eyes, 0, 31),
        clothes: {
            top: clothItem('top', lim.top),
            pants: clothItem('pants', lim.pants),
            shoes: clothItem('shoes', lim.shoes),
            undershirt: clothItem('undershirt', lim.undershirt),
            arms: clothItem('arms', lim.arms),
            accessory: clothItem('accessory', lim.accessory)
        },
        tattoo
    };
}

function applyAppearanceOnce(player, gender, app) {
    const hb = app.headBlend;
    player.setCustomization(
        gender !== 1,
        hb.shapeFirst, hb.shapeSecond, hb.shapeThird,
        hb.skinFirst, hb.skinSecond, hb.skinThird,
        hb.shapeMix, hb.skinMix, hb.thirdMix,
        app.eyes, app.hair.colorId, app.hair.highlight,
        app.face
    );
    // Причёска в GTA V — компонент 2 (freemode) + её цвет
    player.setClothes(2, app.hair.style, 0, 0);
    player.setHairColor(app.hair.colorId, app.hair.highlight);
    // Одежда: все слоты + текстура (v может быть числом — старый формат, или {d,t})
    const c = app.clothes || {};
    const setSlot = (slot, v) => {
        if (v && typeof v === 'object') {
            player.setClothes(slot, Number(v.d) || 0, Number(v.t) || 0, 0);
        } else {
            player.setClothes(slot, Number(v) || 0, 0, 0);
        }
    };
    setSlot(3, c.arms);       // руки / торс
    setSlot(4, c.pants);      // штаны
    setSlot(6, c.shoes);      // обувь
    setSlot(7, c.accessory);  // аксессуары
    setSlot(8, c.undershirt); // майка / подклад
    setSlot(11, c.top);       // верх
    // Тату (если API поддерживается сервером, иначе видит только сам игрок на клиенте)
    const t = app.tattoo;
    if (t && t.collection && t.overlay) {
        try { player.setTattoo(t.collection, t.overlay, 0); } catch (e) { /* серверный API может отсутствовать */ }
    }
}

function applyAppearance(player, gender, app) {
    try {
        // Если админ сменил скин (/skin) — не сбрасываем его при респавне
        if (player.customSkinModel) {
            player.model = player.customSkinModel;
        } else {
            player.model = mp.joaat(gender === 1 ? 'mp_f_freemode_01' : 'mp_m_freemode_01');
        }
    } catch (e) { /* модель меняется на стороне клиента */ }
    try {
        applyAppearanceOnce(player, gender, app);
    } catch (e) {
        console.log(`[char] applyAppearance err: ${e}`);
    }
    setTimeout(() => {
        try { applyAppearanceOnce(player, gender, app); } catch (e) { /* ignore */ }
    }, 800);
}

mp.events.add('playerSpawn', (player) => {
    if (player.char) {
        const c = player.char;
        applyAppearance(player, c.gender, c.appearance);
        try {
            player.call('char:applyAppearance', [JSON.stringify({ gender: c.gender, appearance: c.appearance })]);
        } catch (e) { /* ignore */ }
    }
});

mp.events.add('char:create', (player, name, gender, appearanceJson) => {
    if (player.charPending !== true && player.charEditing !== true) return;

    name = String(name || '').trim();
    if (!/^[A-Za-zА-Яа-яЁё0-9_]{3,20}$/.test(name)) {
        try { player.call('char:error', ['Имя: 3-20 символов (буквы, цифры, _).']); } catch (e) { /* ignore */ }
        return;
    }

    let raw = null;
    try { raw = JSON.parse(String(appearanceJson || 'null')); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') {
        try { player.call('char:error', ['Ошибка данных внешности.']); } catch (e) { /* ignore */ }
        return;
    }

    const genderV = gender === 1 ? 1 : 0;
    const app = sanitizeAppearance(raw, genderV);

    db.upsertCharacter(player.socialClub, name, genderV, app, (charId) => {
        try {
            player.char = { id: charId, name, gender: genderV, appearance: app };
            if (charId) {
                player.citizenId = charId;
                player.setVariable('citizenId', charId);
            }
            player.charPending = false;
            player.charEditing = false;
            player.setVariable('charName', name);
            applyAppearance(player, genderV, app);
            player.dimension = 0;
            player.position = SPAWN_POS;
            player.call('char:done', []);
            console.log(`[char] персонаж сохранён: ${name} (${player.socialClub}), статический id=${charId}, пол=${genderV ? 'Ж' : 'М'}`);
        } catch (e) {
            console.log(`[char] done err: ${e}`);
        }
    });
});

// ---------- Уникальные ID машин (минимум 1, у всех разные) ----------
let nextVehicleId = 1;
const freeVehicleIds = new Set();

mp.events.add('vehicleCreate', (veh) => {
    let id;
    if (freeVehicleIds.size > 0) {
        id = Math.min(...freeVehicleIds);
        freeVehicleIds.delete(id);
    } else {
        id = nextVehicleId;
        nextVehicleId++;
    }

    veh.vehicleId = id;
    veh.setVariable('vehicleId', id);

    veh.fuel = 100;
    veh.setVariable('fuel', veh.fuel);

    console.log(`[freeroam] vehicleCreate: serentityId=${veh.id}, vehicleId=${id}`);
    mp.players.forEach((p) => p.call('admin:vehData', [veh.id, id, veh.fuel]));
});

mp.events.add('vehicleDestroy', (veh) => {
    if (veh.vehicleId != null) {
        freeVehicleIds.add(veh.vehicleId);
        delete veh.vehicleId;
    }
});

// ---------- Расход топлива (~4 л/мин при включенном двигателе) ----------
setInterval(() => {
    mp.vehicles.forEach((veh) => {
        if (!veh.engine || veh.fuel == null) return;
        veh.fuel = Math.max(0, veh.fuel - 0.06);
        veh.setVariable('fuel', veh.fuel);
        mp.players.forEach((p) => p.call('admin:vehFuel', [veh.id, veh.fuel]));
        if (veh.fuel === 0) veh.engine = false;
    });
}, 1000);

// ---------- Полный список машин клиентам (ID + топливо + позиция) ----------
let vehListLogged = false;
setInterval(() => {
    const list = [];
    mp.vehicles.forEach((veh) => {
        if (veh.vehicleId == null) {
            let mid;
            if (freeVehicleIds.size > 0) {
                mid = Math.min(...freeVehicleIds);
                freeVehicleIds.delete(mid);
            } else {
                mid = nextVehicleId;
                nextVehicleId++;
            }
            veh.vehicleId = mid;
            veh.setVariable('vehicleId', mid);
        }
        if (veh.fuel == null) {
            veh.fuel = 100;
            veh.setVariable('fuel', 100);
        }
        list.push([veh.id, veh.vehicleId, Number(veh.fuel.toFixed(2)), veh.position.x, veh.position.y, veh.position.z]);
    });
    if (list.length > 0 && !vehListLogged) {
        vehListLogged = true;
        console.log(`[freeroam] vehList: отправлено машин=${list.length}, игроков=${mp.players.length}`);
    }
    mp.players.forEach((p) => p.call('admin:vehList', [list]));
}, 3000);