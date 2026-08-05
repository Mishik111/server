let noclip = false;
let godmode = false;
let espEnabled = false;
let vfly = false; // полёт на машине (/vfly)
const player = mp.players.local;

// Тестовая машина (/veh test) — супер-мощь в render
const TEST_MODEL_HASH = mp.game.joaat('test') >>> 0;

let escHold = 0; // фреймов после закрытия чата — блокируем раннее раскрытие меню паузы

// Состояние тюрьмы (таймер показывает клиент)
let jailActive = false;
let jailSeconds = 0;
let jailReason = '';
let jailComment = '';
let jailLastTickAt = 0;

// Маркер у входа в тюрьму (интерфейс посадки задержанного):
// большой маркер в мире + блин на радаре, видны админам с правом ajail
const PRISON_MARKER_POS = new mp.Vector3(1690.693, 2591.579, 45.901);
const PRISON_MARKER_RADIUS = 20.0;
let prisonBlip = null;
let prisonMarkerPos = null;

// Браузер интерфейса посадки в тюрьму
let jailBrowser = null;

// Метки выхода игроков от сервера: citizenId -> { x, y, z, text }
const quitMarkersMap = new Map();

// Браузер меню полномочий
let permBrowser = null;

// Спектатор: камера закреплена за игроком
let specTargetId = null;
let specCamera = null;
let specWasInvisible = false;
let specWasFrozen = false;
// Управление камерой спектатора: мышь — поворот, колесо — зум
let specYaw = 90;    // угол вокруг цели (градусы)
let specPitch = 75;  // высота камеры (90 = строго сверху)
let specDist = 6.0;  // дистанция до цели
// Позиция цели с СЕРВЕРА (если цель далеко и не стримится клиенту)
let specServerPos = null;
let specCurPos = null;

// Для невидимых игроков (перем. 'invis'): что мы уже применили на каждом стримленном педе
const ghostSeen = new Map(); // remoteId -> скрыт ли ник/коллизия
mp.events.add('playerStreamOut', (p) => { ghostSeen.delete(p.id); });

// Сброс визуального состояния зрителя (видимость/заморозка)
const restoreSpecState = () => {
    try { player.setVisible(specWasInvisible ? false : true, true); } catch (e) { /* ignore */ }
    try { player.setAlpha(255); } catch (e) { /* ignore */ }
    try { player.freezePosition(false); } catch (e) { /* ignore */ }
};

mp.events.add('spec:start', (targetId) => {
    specTargetId = targetId;
    specServerPos = null;
    specCurPos = null;
    // RAGE:MP стримит мир вокруг локального игрока, а не вокруг скриптовой камеры.
    // Если зритель остаётся на месте — вокруг камеры «белый вакуум» (мигает белым).
    // Поэтому прячем и замораживаем локального игрока и везём его за целью.
    try { specWasFrozen = player.isFrozen; player.freezePosition(true); } catch (e) { /* ignore */ }
    try { specWasInvisible = player.isInvisible; } catch (e) { /* ignore */ }
    try { player.setVisible(false, true); player.setAlpha(0); } catch (e) { /* ignore */ }
    // Скрываем для всех на сервере (кто-то мог зайти и увидеть «стоящего» зрителя)
    mp.events.callRemote('admin:setInvis', true);
    if (!specCamera) {
        try {
            const pos = player.position;
            specCamera = mp.cameras.new(
                'default',
                new mp.Vector3(pos.x, pos.y, pos.z + 4.5),
                new mp.Vector3(-90, 0, 0),
                70
            );
            specCamera.setActive(true);
            mp.game.cam.renderScriptCams(true, false, 0, false, false);
        } catch (e) { /* ignore */ }
    }
});

// Сервер присылает позицию цели каждые 0.5с — нужно для целей вне стрим-зоны
mp.events.add('spec:tick', (x, y, z) => {
    try {
        specServerPos = new mp.Vector3(x, y, z);
        if (!specCurPos) specCurPos = new mp.Vector3(x, y, z);
    } catch (e) { /* ignore */ }
});

mp.events.add('spec:stop', () => {
    specTargetId = null;
    specServerPos = null;
    specCurPos = null;
    restoreSpecState();
    if (specCamera) {
        try { specCamera.destroy(); } catch (e) { /* ignore */ }
        specCamera = null;
    }
    try { mp.game.cam.renderScriptCams(false, false, 0, false, false); } catch (e) { /* ignore */ }
    mp.events.callRemote('admin:setInvis', false);
});

// Принудительное выбрасывание из транспорта (/eject). Делаем на клиенте:
// штатным методом, а если не вышло — нативным TASK_LEAVE_ANY_VEHICLE и телепортом.
mp.events.add('admin:forceEject', () => {
    // Если пристёгнут (флаг 32/33 = false) — на время «расстёгиваем», иначе пед не вылетит.
    try {
        if (seatbelt) {
            try { mp.game.invoke('0x9A77DFD295E29B09', player.handle, 32, true); } catch (e) { /* ignore */ }
            try { mp.game.invoke('0x9A77DFD295E29B09', player.handle, 33, true); } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }

    // 1) штатный способ
    try { player.removeFromVehicle(false); } catch (e) { /* ignore */ }

    // 2) через 400мс — натив TASK_LEAVE_ANY_VEHICLE (0x504DFE62A1692296), если всё ещё в тачке
    setTimeout(() => {
        try {
            if (player.vehicle) mp.game.invoke('0x504DFE62A1692296', player.handle, 0, 64);
        } catch (e) { /* ignore */ }
    }, 400);

    // 3) подстраховка: если всё ещё в машине — выкидываем через телепорт вверх
    setTimeout(() => {
        try {
            if (player.vehicle) {
                const pos = player.vehicle.position;
                player.position = new mp.Vector3(pos.x, pos.y, pos.z + 1.5);
            }
        } catch (e) { /* ignore */ }
    }, 800);
});

// Убрать коллизию и плашку с именем у невидимого игрока (/invis, /fly, /spec)
// Ник скрывает ресурс nametags.js (пропускает игроков с переменной 'invis'),
// здесь — только коллизия для себя.
mp.events.add('admin:invis', (state) => {
    try { player.setCollision(!state, !state); } catch (e) { /* ignore */ }
});

// /sbiv — сбить анимацию: дефолтное положение, обнулить скорость/ускорение.
mp.events.add('admin:sbiv', () => {
    const me = mp.players.local;
    if (!me.handle) return;
    // Очистка всех задач: выйти из любых анимаций, рагдолла, сидения, прицела
    try { mp.game.invoke('0xAAA34F8A7CB32098', me.handle, true); } catch (e) { /* CLEAR_PED_TASKS_IMMEDIATELY */ }
    try { mp.game.invoke('0xE1EF3C1216AFF2CD', me.handle); } catch (e) { /* CLEAR_PED_TASKS */ }
    // Линейная скорость педа в ноль
    try { mp.game.invoke('0x1C99BB7B6E96D16F', me.handle, 0, 0, 0); } catch (e) { /* SET_ENTITY_VELOCITY */ }
    // Если сидит в машине — сбросить скорость транспорта
    if (me.vehicle && me.vehicle.handle) {
        try { mp.game.invoke('0x1C99BB7B6E96D16F', me.vehicle.handle, 0, 0, 0); } catch (e) { /* SET_ENTITY_VELOCITY */ }
    }
});

// Свои права (от сервера, для F5 и т.п.)
let myPerms = {};
mp.events.add('perm:sync', (json) => {
    try { myPerms = JSON.parse(json) || {}; } catch (e) { myPerms = {}; }
});

const closePerm = () => {
    if (permBrowser) {
        try { permBrowser.destroy(); } catch (e) { /* ignore */ }
        permBrowser = null;
    }
    try { mp.gui.cursor.show(false, false); } catch (e) { /* ignore */ }
};

// Кэш данных машин: remoteId -> { id, fuel }
// Сервер шлёт данные событиями, чтобы не зависеть от синхронизации переменных
const vehInfo = new Map();

function getCameraDirection() {
    const rot = mp.game.cam.getGameplayCamRot(2);
    const cz = rot.z * (Math.PI / 180);
    const cx = rot.x * (Math.PI / 180);
    const multX = Math.abs(Math.cos(cx));

    return {
        x: -Math.sin(cz) * multX,
        y: Math.cos(cz) * multX,
        z: Math.sin(cx)
    };
}

// Локальный joaat: RAGE:MP может передавать хэши > 2^31 с потерей точности (float32),
// поэтому хэш всегда считается на той стороне, где он нужен, из имени-строки.
function localJoaat(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (h + str.charCodeAt(i)) & 0xFFFFFFFF;
        h = (h + ((h << 10) & 0xFFFFFFFF)) & 0xFFFFFFFF;
        h = (h ^ (h >>> 6)) & 0xFFFFFFFF;
    }
    h = (h + ((h << 3) & 0xFFFFFFFF)) & 0xFFFFFFFF;
    h = (h ^ (h >>> 11)) & 0xFFFFFFFF;
    h = (h + ((h << 15) & 0xFFFFFFFF)) & 0xFFFFFFFF;
    return h >>> 0;
}

// Выдача оружия по имени (строка передаётся без потерь; хэш считаем локально)
// Клиентский обработчик выдачи оружия
mp.events.add('admin:giveWeaponName', (weaponName, ammo) => {
    const me = mp.players.local;
    if (!me || !me.handle) return;

    // В RAGE:MP на клиенте хеш берется через mp.game.joaat
    const hash = mp.game.joaat(weaponName) >>> 0;

    try {
        // Выдаем и берем в руки штатным методом RAGE:MP (третий параметр true = достать в руки)
        me.giveWeapon(hash, ammo || 999, true);
    } catch (e) { /* ignore */ }

    setTimeout(() => {
        // Вместо вызова натива берем хеш текущего оружия прямо из свойства me.weapon
        const currentHash = (me.weapon) >>> 0;
        const inHand = (currentHash === hash);

        mp.events.callRemote('admin:gunConfirmResult', weaponName, inHand, currentHash);
    }, 200);
});

// Данные машин от сервера (ID + топливо)
let vehSyncLogged = false;
mp.events.add('admin:vehData', (remoteId, id, fuel) => {
    vehInfo.set(remoteId, { id: id, fuel: fuel });
    if (!vehSyncLogged) {
        vehSyncLogged = true;
        mp.console.logInfo(`ESP DIAG: vehData пришёл remoteId=${remoteId}, id=${id}`);
    }
});
mp.events.add('admin:vehFuel', (remoteId, fuel) => {
    const info = vehInfo.get(remoteId);
    if (info) info.fuel = fuel;
});
mp.events.add('admin:vehList', (list) => {
    list.forEach((entry) => {
        const serverId = entry[0];
        vehInfo.set(serverId, { id: entry[1], fuel: entry[2], x: entry[3], y: entry[4], z: entry[5] });
    });
    if (!vehSyncLogged && list.length > 0) {
        vehSyncLogged = true;
        mp.console.logInfo(`ESP DIAG: vehList пришёл, len=${list.length}`);
    }
});

// Чат — кастомный CEF (client_packages/chat). Ввод открывается на T, история ↑/↓ и скролл
// PageUp/PageDown сделаны внутри страницы. Здесь только закрытие меню полномочий на ESC.
mp.keys.bind(0x1B, true, () => { // ESC — закрыть меню полномочий / интерфейс посадки и скрыть курсор
    closePerm();
    closeJailUi();
    try {
        if (mp.gui.cursor && typeof mp.gui.cursor.show === 'function') {
            mp.gui.cursor.show(false, false);
        }
    } catch (e) { /* ignore */ }
});
// Сразу после закрытия строки ввода чата не даём ESC открыть меню паузы/карту
mp.events.add('chatInput', (state) => {
    if (!state) escHold = 2;
});

// События тюрьмы от сервера (таймер / блок полёта)
mp.events.add('jail:start', (seconds, reason, comment) => {
    jailActive = true;
    jailSeconds = Number(seconds) || 0;
    jailReason = reason ? String(reason) : '';
    jailComment = comment ? String(comment) : '';
});
mp.events.add('jail:tick', (seconds) => {
    if (jailActive) {
        jailSeconds = Number(seconds) || 0;
        try { jailLastTickAt = Date.now(); } catch (e) { jailLastTickAt = 0; }
    }
});
mp.events.add('jail:stop', () => {
    jailActive = false;
    jailSeconds = 0;
    jailReason = '';
    jailComment = '';
});

// ---------- Маркер тюрьмы (блин на радаре + жёлтый маркер в мире) ----------
// Сам маркер рисуем каждый кадр нативом drawMarker (mp.markers.new в этой
// сборке клиента не отображает) — круг на земле + стены вверх как градиент.
mp.events.add('prison:blip', (x, y, z) => {
    try { if (prisonBlip) { prisonBlip.destroy(); prisonBlip = null; } } catch (e) { /* ignore */ }
    prisonMarkerPos = new mp.Vector3(x, y, z);
    try {
        prisonBlip = mp.blips.new(163, prisonMarkerPos, { name: 'Тюрьма', color: 1, scale: 1.4 });
    } catch (e) { /* ignore */ }
});

// ---------- Маркеры выхода игроков («вышел N мин назад») ----------
mp.events.add('quitmarker:list', (payload) => {
    quitMarkersMap.clear();
    try {
        const list = JSON.parse(payload) || [];
        const now = Date.now();
        list.forEach((m) => {
            const left = Math.max(0, now - m[5]);
            const mins = Math.floor(left / 60000);
            const h = Math.floor(mins / 60);
            const mm = mins % 60;
            const ago = h > 0 ? `${h} ч ${mm} мин` : `${mins} мин`;
            quitMarkersMap.set(String(m[4]), { x: m[0], y: m[1], z: m[2], text: `${m[3]} ${m[4]} вышел ${ago} назад` });
        });
    } catch (e) { /* ignore */ }
});

// ---------- Интерфейс посадки в тюрьму (CEF) ----------
const closeJailUi = () => {
    if (jailBrowser) {
        try { jailBrowser.destroy(); } catch (e) { /* ignore */ }
        jailBrowser = null;
    }
    try { mp.gui.cursor.show(false, false); } catch (e) { /* ignore */ }
};

mp.events.add('prison:openUi', (listJson) => {
    if (jailBrowser) closeJailUi();
    try {
        jailBrowser = mp.browsers.new('package://admin/jail.html');
    } catch (e) { closeJailUi(); return; }
    jailBrowser.__pending = listJson || '{}';
    try { mp.gui.cursor.show(true, true); } catch (e) { /* ignore */ }
});

// CEF готов — передаём данные
mp.events.add('jailCef:ready', () => {
    if (!jailBrowser) return;
    try { jailBrowser.execute(`window.__jailInit(${jailBrowser.__pending || '{}'})`); } catch (e) { /* ignore */ }
});

// CEF: посадить в тюрьму -> сервер
mp.events.add('jailCef:submit', (id, minutes, reason, comment) => {
    mp.events.callRemote('arrest:jail', String(id), String(minutes), String(reason || ''), String(comment || ''));
});

// CEF: закрыть браузер
mp.events.add('jailCef:close', closeJailUi);

// U-замена: E — открыть интерфейс посадки в тюрьму у маркера
mp.keys.bind(0x45, true, () => { // 0x45 = E
    if (jailBrowser) return;
    if (!myPerms.ajail) return;
    try {
        let typing = false;
        try { typing = !!mp.players.local.isTypingInChat; } catch (e) { typing = false; }
        if (!typing) { try { typing = mp.gui.chat.active === true; } catch (e2) { typing = false; } }
        if (typing) return;
    } catch (e) { /* ignore */ }
    try {
        const p = mp.players.local.position;
        if (Math.hypot(p.x - PRISON_MARKER_POS.x, p.y - PRISON_MARKER_POS.y) > PRISON_MARKER_RADIUS) {
            return;
        }
    } catch (e) { /* ignore */ }
    mp.events.callRemote('arrest:open', true);
});

// ---------- Меню полномочий (CEF) ----------
let pendingPermPayload = null;

mp.events.add('perm:open', (payload) => {
    closePerm();
    pendingPermPayload = payload;
    try { permBrowser = mp.browsers.new('package://admin/perm.html'); } catch (e) { closePerm(); return; }
    try { mp.gui.cursor.show(true, true); } catch (e) { /* ignore */ }
});

// CEF готов — передаём данные
mp.events.add('perm:ready', () => {
    if (!permBrowser || pendingPermPayload == null) return;
    try { permBrowser.execute(`window.__permInit(${pendingPermPayload})`); } catch (e) { /* ignore */ }
});

// CEF: сохранить полномочия -> сервер
mp.events.add('perm:save', (targetId, cmdsJson) => {
    mp.events.callRemote('perm:save', String(targetId), cmdsJson);
});

// CEF: закрыть браузер
mp.events.add('perm:close', closePerm);

// Быстрое возрождение на клавишу R (в тюрьме R разрешена)
mp.keys.bind(0x52, true, () => { // 0x52 = R
    if (!myPerms.respawn && !jailActive) return;
    if (player.getHealth() <= 0 || player.isDead()) {
        mp.events.callRemote('admin:respawnSelf');
    }
});

// ---------- Ремень безопасности (J) ----------
let seatbelt = false;
mp.keys.bind(0x4A, true, () => { // 0x4A = J
    if (!player.vehicle) {
        return;
    }
    seatbelt = !seatbelt;
    mp.events.callRemote('seatbelt:toggle', seatbelt);
    if (seatbelt) {
        // Сразу ставим флаги «не выбивает из авто» (render будет держать их дальше)
        try {
            if (typeof player.setConfigFlag === 'function') {
                player.setConfigFlag(32, false);
                player.setConfigFlag(33, false);
            }
            mp.game.invoke('0x9A77DFD295E29B09', player.handle, 32, false);
        } catch (e) { /* ignore */ }
    } else {
        // Отстегнулись — вернуть флаги «можно выбить из авто».
        // Иначе пед навсегда остаётся «прилипшим» и не вылетает при аварии.
        try {
            if (typeof player.setConfigFlag === 'function') {
                player.setConfigFlag(32, true);
                player.setConfigFlag(33, true);
            }
            mp.game.invoke('0x9A77DFD295E29B09', player.handle, 32, true);
            mp.game.invoke('0x9A77DFD295E29B09', player.handle, 33, true);
        } catch (e) { /* ignore */ }
    }
});
// Если ремень уже пристёгнут — затягиваем флаги сразу при посадке в машину
mp.events.add('playerEnterVehicle', () => {
    if (!seatbelt || !player.vehicle) return;
    try {
        if (typeof player.setConfigFlag === 'function') {
            player.setConfigFlag(32, false);
            player.setConfigFlag(33, false);
        }
        mp.game.invoke('0x9A77DFD295E29B09', player.handle, 32, false);
    } catch (e) { /* ignore */ }
});

// ---------- Наручники и ведение — отдельный модуль client_packages/cuff/index.js ----------
// Здесь хранится только зеркало состояния наручников (для F5 и т.п.)
let myCuffed = false;
mp.events.add('cuff:localState', (state) => {
    myCuffed = !!state;
});

// F5 — переключение полёта (noclip)
mp.keys.bind(0x74, true, () => { // 0x74 = F5
    if (jailActive) {
        chatPush('!{FF4444}В тюрьме полёт запрещён!');
        return;
    }
    if (myCuffed) {
        chatPush('!{FF4444}Вы в наручниках — полёт недоступен!');
        return;
    }
    if (!myPerms.noclip) {
        chatPush('!{FF4444}У вас нет прав на F5 (полёт)!');
        return;
    }
    mp.events.call('admin:toggleNoclip');
});

// Стрелка вверх больше НЕ занята меню полномочий — она свободна для истории чата.
// Меню полномочий открывается командой /perm (только для главного админа, сервер проверит).

// Переключение Noclip
mp.events.add('admin:toggleNoclip', () => {
    if (jailActive) return;
    noclip = !noclip;
    player.freezePosition(noclip);
    player.setInvincible(noclip || godmode);
    player.setCollision(!noclip, !noclip);
    player.setVisible(!noclip, !noclip);
    // Инвиз при полёте (F5 / /fly / /noclip)
    try {
        player.setAlpha(noclip ? 0 : 255);
    } catch (e) { /* ignore */ }
    // Скрываем для всех на сервере (иначе другие игроки увидят «парящего»)
    mp.events.callRemote('admin:setInvis', noclip);
    mp.game.audio.playSoundFrontend(-1, 'NAV_UP_DOWN', 'HUD_FRONTEND_DEFAULT_SOUNDSET', true);
});

// Полёт на машине (/vfly): машина следует за камерой, как ноклип
mp.events.add('admin:vflyToggle', () => {
    if (jailActive) return;
    if (!player.vehicle) {
        chatPush('!{FF4444}Вы должны находиться в машине!');
        return;
    }
    vfly = !vfly;
    try {
        const veh = player.vehicle;
        if (typeof veh.setInvincible === 'function') veh.setInvincible(vfly);
        if (typeof veh.setEngineOn === 'function') veh.setEngineOn(true);
    } catch (e) { /* ignore */ }
    if (!vfly) {
        // вернуть обычный транспорт: сброс невидимости (если была) на сервере
        mp.events.callRemote('admin:setInvis', false);
    }
    mp.game.audio.playSoundFrontend(-1, 'NAV_UP_DOWN', 'HUD_FRONTEND_DEFAULT_SOUNDSET', true);
});

// Выйти из машины — полёт на ней выключается
mp.events.add('playerExitVehicle', () => {
    if (vfly) { vfly = false; }
});

// Активация Godmode
mp.events.add('admin:godmode', (state) => {
    godmode = state;
    player.setInvincible(godmode || noclip);
});

// Заморозка
mp.events.add('admin:freeze', (state) => {
    player.freezePosition(state);
});

// ESP: рисует метки над игроками и машинами
mp.events.add('admin:toggleEsp', () => {
    espEnabled = !espEnabled;
    if (espEnabled) {
        try {
            const streamed = mp.vehicles.toArray().length;
            mp.console.logInfo(`ESP DIAG: машин в стриме=${streamed}, в кэше vehInfo=${vehInfo.size}`);
        } catch (e) { /* ignore */ }
    }
});

// Взрыв машины (native ADD_EXPLOSION + EXPLODE_VEHICLE)
mp.events.add('admin:explodeVehicle', (remoteId, x, y, z) => {
    // ADD_EXPLOSION: поднимаем точку взрыва над землёй, усиленный урон
    mp.game.invoke('0xE3AD2BDBAEE269AC', x, y, z + 1.0, 7, 5.0, true, false, 1.0);
    const veh = mp.vehicles.toArray().find(
        (v) => v.remoteId === remoteId || (typeof v.getVariable === 'function' && v.getVariable('vehicleId') === remoteId)
    );
    if (veh) {
        veh.health = 0;
        // EXPLODE_VEHICLE — мгновенный взрыв машины с визуальным эффектом
        mp.game.invoke('0xBA71116ADF5B514C', veh.handle, true, false);
    }
});

// ---------- Безопасный вывод текста на экран ----------
// getScreenCoordFromWorldCoord уже возвращает нормализованные координаты 0..1
const worldToScreen = (wx, wy, wz) => {
    try {
        const sc = mp.game.graphics.getScreenCoordFromWorldCoord(wx, wy, wz);
        if (!sc || sc.result === false || sc.result === undefined) return null;
        let sx = sc.screenX;
        let sy = sc.screenY;
        if (sx > 1.5 || sx < -1.5 || sy > 1.5 || sy < -1.5) {
            return null;
        }
        return { x: sx, y: sy };
    } catch (e) { return null; }
};

const drawTextRow = (x, y, text, color, scale) => {
    try {
        const ui = mp.game.ui;
        if (typeof ui.setTextEntry === 'function') ui.setTextEntry('STRING');
        if (typeof ui.addTextComponentSubstringPlayerName === 'function') ui.addTextComponentSubstringPlayerName(String(text));
        if (typeof ui.setTextScale === 'function') ui.setTextScale(scale, scale);
        if (typeof ui.setTextColour === 'function') ui.setTextColour(color[0], color[1], color[2], color[3]);
        if (typeof ui.setTextFont === 'function') ui.setTextFont(0);
        if (typeof ui.setTextEdge === 'function') ui.setTextEdge(1, 0, 0, 0, 255);
        if (typeof ui.setTextCentre === 'function') ui.setTextCentre(true);
        else if (typeof ui.setTextJustification === 'function') ui.setTextJustification(0);
        if (typeof ui.drawText === 'function') ui.drawText(x, y);
    } catch (e) { /* ignore */ }
};

const drawEspLabel = (worldPos, lines, color, scale = 0.35) => {
    const sc = worldToScreen(worldPos.x, worldPos.y, worldPos.z);
    if (!sc) return;
    lines.forEach((line, i) => drawTextRow(sc.x, sc.y + i * 0.033, line, color, scale));
};

// Имена над головами рисует отдельный ресурс nametags.js (mp.nametags.enabled = false +
// ручная отрисовка имён). Здесь НЕ включаем системные плашки (иначе вернётся дефолтный ник + полоска HP).

// ---------- NPC-трафик (/traffic, гл. админ) ----------
// Сущности (педы + машины с водителями) спавнит СЕРВЕР через mp.peds/mp.vehicles —
// такие объекты основной части видят ВСЕ игроки, а не только админ.
// Здесь в клиенте мы только «оживляем» застримленные к себе педы:
// пешеход — TASK_WANDER_IN_AREA (блуждание), водитель — TASK_VEHICLE_DRIVE_WANDER (езда).
let trafficDensity = 0; // 0-100 (%): сколько NPC спавнить; 0 = выключено

const TRAFFIC_CAR_MODELS = ['adder', 'buffalo', 'blista', 'felon', 'oracle', 'sultan', 'sentinel', 'surano', 'kuruma', 'comet2'];
const TRAFFIC_PED_MODELS = ['a_m_y_hipster_01', 'a_m_m_skater_01', 'a_f_m_fat_old_01', 'a_m_y_stwhi_01', 'a_m_m_bevhills_02', 'a_f_y_business_02', 'a_m_y_beach_01'];
const TRAFFIC_CAR_HASHES = TRAFFIC_CAR_MODELS.map((m) => mp.game.joaat(m) >>> 0);
const TRAFFIC_PED_HASHES = TRAFFIC_PED_MODELS.map((m) => mp.game.joaat(m) >>> 0);

mp.events.add('entityStreamIn', (entity) => {
    if (trafficDensity <= 0) return;
    if (entity.type !== 'ped') return;
    if (TRAFFIC_PED_HASHES.indexOf(entity.model >>> 0) === -1) return;
    try {
        if (entity.vehicle && entity.vehicle.handle &&
            TRAFFIC_CAR_HASHES.indexOf(entity.vehicle.model >>> 0) !== -1) {
            // Водитель трафик-авто: езда по городу (TASK_VEHICLE_DRIVE_WANDER: пед, авто, скорость, стиль)
            mp.game.invoke('0x480142959D337D00', entity.handle, entity.vehicle.handle, 25.0 + Math.random() * 10, 0);
        } else {
            // Обычный пешеход: блуждание в радиусе 50 м от точки (TASK_WANDER_IN_AREA)
            const p = entity.position;
            mp.game.invoke('0xE054346CA3A0F315', entity.handle, p.x, p.y, p.z, 50, 0, 0);
        }
    } catch (e) { /* ignore */ }
});

mp.events.add('render', () => {
    // Спектатор: камера следует за целью, можно крутить мышью и зумить колёсиком
    if (specTargetId != null && specCamera) {
        try {
            // Позиция цели: стримнутый игрок — каждый кадр; иначе — серверный тик
            // (0.5с) с плавной интерполяцией, чтобы камера не дёргалась.
            let p = null;
            const streamed = mp.players.atRemoteId(specTargetId);
            if (streamed && streamed.position) {
                p = streamed.position;
            } else if (specServerPos) {
                if (!specCurPos) specCurPos = new mp.Vector3(specServerPos.x, specServerPos.y, specServerPos.z);
                specCurPos.x += (specServerPos.x - specCurPos.x) * 0.3;
                specCurPos.y += (specServerPos.y - specCurPos.y) * 0.3;
                specCurPos.z += (specServerPos.z - specCurPos.z) * 0.3;
                p = specCurPos;
            }
            if (!p) return;
            // Тащим локального игрока за целью — чтобы мир стримился вокруг камеры.
                // Отдельный try: даже если мышь не работает — камера обязана ехать за целью.
                try { player.position = new mp.Vector3(p.x, p.y, p.z); } catch (e) { /* ignore */ }

                // Мышь — поворот камеры, колёсико — зум. В изолированном try:
                // недоступный нативный не должен ломать след камеры за игроком.
                try {
                    if (typeof mp.game.controls.getDisabledControlValue === 'function') {
                        mp.game.controls.disableControlAction(0, 1, true); // LOOK_LR
                        mp.game.controls.disableControlAction(0, 2, true); // LOOK_UD
                        specYaw += mp.game.controls.getDisabledControlValue(0, 1) * 4.0;
                        specPitch += mp.game.controls.getDisabledControlValue(0, 2) * 4.0;
                    } else if (typeof mp.game.controls.getControlValue === 'function') {
                        specYaw += mp.game.controls.getControlValue(0, 1) * 4.0;
                        specPitch += mp.game.controls.getControlValue(0, 2) * 4.0;
                    }
                    specPitch = Math.max(-85, Math.min(85, specPitch));

                    if (typeof mp.game.controls.isDisabledControlPressed === 'function') {
                        mp.game.controls.disableControlAction(0, 14, true); // вниз (дальше)
                        mp.game.controls.disableControlAction(0, 15, true); // вверх (ближе)
                        if (mp.game.controls.isDisabledControlPressed(0, 14)) specDist += 1.0;
                        if (mp.game.controls.isDisabledControlPressed(0, 15)) specDist -= 1.0;
                    }
                    specDist = Math.max(1.0, Math.min(50.0, specDist));
                } catch (e) { /* мышь не критична */ }

                try {
                    const radPitch = specPitch * (Math.PI / 180);
                    const radYaw = specYaw * (Math.PI / 180);
                    const horiz = Math.cos(radPitch) * specDist;
                    const cx = p.x + Math.sin(radYaw) * horiz;
                    const cy = p.y + Math.cos(radYaw) * horiz;
                    const cz = p.z + Math.sin(radPitch) * specDist;
                    specCamera.setCoord(cx, cy, cz);

                    // Направление камеры на цель (pointAt нестабилен — считаем ротацию сами)
                    const ddx = p.x - cx;
                    const ddy = p.y - cy;
                    const ddz = p.z - cz;
                    const len = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1;
                    const nx = ddx / len, ny = ddy / len, nz = ddz / len;
                    const rotX = Math.asin(nz) * (180 / Math.PI);
                    const cosX = Math.cos(rotX * (Math.PI / 180));
                    let rotZ = 0;
                    if (Math.abs(cosX) > 1e-6) rotZ = Math.atan2(-nx, ny) * (180 / Math.PI);
                    specCamera.setRot(rotX, 0, rotZ);
                } catch (e) {
                    // Фолбэк: камера над целью, смотрим вниз
                    try { specCamera.setCoord(p.x, p.y, p.z + 4.5); specCamera.setRot(-90, 0, 0); } catch (e2) { /* ignore */ }
                }
        } catch (e) { /* камера спектатора не должна валить render */ }
    }

    // Невидимые игроки (перем. 'invis'): убираем им плашку с именем и коллизию у всех, кто их видит
    mp.players.forEachInStreamRange((p) => {
        if (p === player) return;
        let hidden = false;
        try { hidden = p.getVariable && p.getVariable('invis') === true; } catch (e) { hidden = false; }
        if (ghostSeen.get(p.id) !== hidden) {
            ghostSeen.set(p.id, hidden);
            try { p.setCollision(!hidden, !hidden); } catch (e) { /* ignore */ }
        }
    });

    // Идёт набор текста в чате — не даём колёсику менять оружие
    let chatTyping = false;
    try { chatTyping = isChatTyping(); } catch (e) { chatTyping = false; }
    if (chatTyping) {
        mp.game.controls.disableControlAction(0, 14, true); // Колёсико вниз
        mp.game.controls.disableControlAction(0, 15, true); // Колёсико вверх
    }

    // Только что нажали ESC (закрыли чат) — заблокировать меню паузы/карту
    if (escHold > 0) {
        // 199/200 = INPUT_FRONTEND_PAUSE (ESC открывает меню паузы)
        mp.game.controls.disableControlAction(0, 199, true);
        mp.game.controls.disableControlAction(0, 200, true);
        escHold--;
    }

    // Большой таймер тюрьмы справа снизу
    if (jailActive && jailSeconds > 0) {
        let timeLeft = jailSeconds;
        try {
            // Корректируем по пройденному времени между тиками (1 сек)
            if (typeof jailLastTickAt === 'number' && jailLastTickAt > 0) {
                const elapsed = (Date.now() - jailLastTickAt) / 1000;
                timeLeft = Math.max(0, jailSeconds - elapsed);
            }
        } catch (e) { /* ignore */ }
        const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
        const ss = String(Math.floor(timeLeft % 60)).padStart(2, '0');
        drawTextRow(0.95, 0.72, 'ТЮРЬМА', [255, 70, 70, 255], 0.5);
        drawTextRow(0.95, 0.80, `${mm}:${ss}`, [255, 255, 255, 255], 1.4);
        let ty = 0.885;
        if (jailReason) {
            drawTextRow(0.95, ty, 'ПРИЧИНА: ' + jailReason, [255, 230, 160, 255], 0.4);
            ty += 0.045;
        }
        if (jailComment) {
            drawTextRow(0.95, ty, 'КОММЕНТАРИЙ: ' + jailComment, [255, 230, 160, 255], 0.4);
        }
    }

    if (godmode) {
        player.setInvincible(true);
    }

    if (espEnabled) {
        mp.players.forEachInStreamRange((target) => {
            if (target === player) return;
            const p = target.position;
            mp.game.graphics.drawLine(p.x, p.y, p.z, p.x, p.y, p.z + 2.0, 0, 255, 0, 255);
            let cid = null;
            if (typeof target.getVariable === 'function') cid = target.getVariable('citizenId');
            const dist = target.dist(player.position).toFixed(1);
            const hp = Math.round(target.getHealth());
            const ar = Math.round(target.getArmour());
            drawEspLabel(
                new mp.Vector3(p.x, p.y, p.z + 1.6),
                [
                    `Гражданин ${cid != null ? cid : '?'} [${dist}м]`,
                    `HP: ${hp}`,
                    `Броня: ${ar}`
                ],
                [0, 255, 0, 255]
            );
        });

        mp.vehicles.forEachInStreamRange((veh) => {
            const v = veh.position;
            mp.game.graphics.drawLine(v.x, v.y, v.z, v.x, v.y, v.z + 2.5, 0, 200, 255, 255);

            // 1) точное совпадение по remoteId
            let info = veh.remoteId != null ? vehInfo.get(veh.remoteId) : null;
            // 2) запасной вариант: ближайшая машина из списка сервера по позиции
            if (!info) {
                let best = null;
                let bestDist = 3.0;
                vehInfo.forEach((cand) => {
                    if (cand.x == null) return;
                    const d = Math.hypot(cand.x - v.x, cand.y - v.y, cand.z - v.z);
                    if (d < bestDist) {
                        bestDist = d;
                        best = cand;
                    }
                });
                if (best) info = best;
            }

            let vid = info ? info.id : null;
            let fuel = info ? info.fuel : null;
            if (typeof veh.getVariable === 'function') {
                if (vid == null) vid = veh.getVariable('vehicleId');
                if (fuel == null) fuel = veh.getVariable('fuel');
            }
            const dist = veh.dist(player.position).toFixed(1);
            const hp = Math.round(veh.getHealth());
            drawEspLabel(
                new mp.Vector3(v.x, v.y, v.z + 2.6),
                [
                    `Машина ${vid != null ? vid : '?'} [${dist}м]`,
                    `Топливо: ${fuel != null ? Number(fuel).toFixed(1) : '?'}л`,
                    `HP: ${hp}`
                ],
                [0, 200, 255, 255]
            );
        });
    }

    // Ремень безопасности: держим флаги педа «не выбивает из транспорта»
    // обновлёнными каждый кадр (игра сбрасывает их сама)
    if (seatbelt && player.vehicle) {
        try {
            if (typeof player.setConfigFlag === 'function') {
                player.setConfigFlag(32, false); // CAN_BE_KNOCKED_OFF_VEHICLE
                player.setConfigFlag(33, false); // и при перевороте
            }
            mp.game.invoke('0x9A77DFD295E29B09', player.handle, 32, false);
            mp.game.invoke('0x9A77DFD295E29B09', player.handle, 33, false);
        } catch (e) { /* ignore */ }
    }

    // Наручники (руки за спиной, блокировка) и магнит ведения обрабатывает
    // отдельный модуль client_packages/cuff/index.js — здесь их нет.

    // Полёт на машине: двигаем транспорт по камере (не требует настоящего полёта)
    if (vfly && player.vehicle) {
        try {
            const veh = player.vehicle;
            const dir = getCameraDirection();
            let speed = 2.0;
            if (mp.game.controls.isControlPressed(0, 21)) speed = 8.0; // Shift
            if (mp.game.controls.isControlPressed(0, 19)) speed = 0.5; // Alt
            const pos = veh.position;
            if (mp.game.controls.isControlPressed(0, 32)) {
                pos.x += dir.x * speed; pos.y += dir.y * speed; pos.z += dir.z * speed;
            }
            if (mp.game.controls.isControlPressed(0, 33)) {
                pos.x -= dir.x * speed; pos.y -= dir.y * speed; pos.z -= dir.z * speed;
            }
            if (mp.game.controls.isControlPressed(0, 34)) {
                pos.x -= dir.y * speed; pos.y += dir.x * speed;
            }
            if (mp.game.controls.isControlPressed(0, 35)) {
                pos.x += dir.y * speed; pos.y -= dir.x * speed;
            }
            if (mp.game.controls.isControlPressed(0, 22)) pos.z += speed;
            if (mp.game.controls.isControlPressed(0, 36)) pos.z -= speed;
            veh.position = pos;
            // Поворот машины за камерой (только по горизонтали)
            try {
                const r = mp.game.cam.getGameplayCamRot(2);
                veh.rotation = new mp.Vector3(0, 0, r.z);
            } catch (e2) { /* ignore */ }
        } catch (e) { /* ignore */ }
    }

    if (player.vehicle && player.vehicle.handle) {
        const veh = player.vehicle;
        // Радио в ЛЮБОЙ машине выключено (SET_VEHICLE_RADIO_ENABLED = off)
        try { mp.game.invoke('0x3B988190C0AA6C0B', veh.handle, false); } catch (e) { /* ignore */ }
        // Тестовая машина: супер-мощь (множители двигателя) + кап скорости 1000 км/ч
        if ((veh.model >>> 0) === TEST_MODEL_HASH) {
            try { mp.game.invoke('0x93A3996368C94158', veh.handle, 50.0); } catch (e) { /* _SET_VEHICLE_ENGINE_POWER_MULTIPLIER */ }
            try { mp.game.invoke('0xB59E4BD37AE292DB', veh.handle, 50.0); } catch (e) { /* _SET_VEHICLE_ENGINE_TORQUE_MULTIPLIER */ }
            try { mp.game.invoke('0x0E46A3FCBDE2A1B1', veh.handle, 277.78); } catch (e) { /* SET_ENTITY_MAX_SPEED: 277.78 м/с = 1000 км/ч */ }
        }
    }

    // ---------- Спидометр (справа снизу, если в машине) ----------
    if (player.vehicle && player.getHealth() > 0) {
        try {
            const veh = player.vehicle;
            const kmh = Math.round(Math.abs(veh.getSpeed() * 3.6));
            // Скорость крупно
            drawTextRow(0.95, 0.885, `${kmh} км/ч`, [255, 255, 255, 255], 1.2);
            // Передача + топливо мелкой строкой
            let sub = '';
            const gear = veh.gear;
            if (gear != null) {
                if (gear === 0 && Math.abs(veh.getSpeed()) > 0.5) sub += 'R';
                else if (gear === 0) sub += 'N';
                else sub += gear;
            }
            let fuel = null;
            const info = veh.remoteId != null ? vehInfo.get(veh.remoteId) : null;
            if (info) fuel = info.fuel;
            if (typeof veh.getVariable === 'function' && fuel == null) {
                try { fuel = veh.getVariable('fuel'); } catch (e) { /* ignore */ }
            }
            if (fuel != null) {
                if (sub) sub += ' · ';
                sub += `${Number(fuel).toFixed(1)} л`;
            }
            if (sub) drawTextRow(0.95, 0.93, sub, [150, 200, 255, 255], 0.45);
        } catch (e) { /* ignore */ }
    }

    if (!noclip) return;

    // Клавиши движения читаем обычным isControlPressed (перемещение делаем
    // сами через player.position), потому что isDisabledControlPressed для
    // локального игрока в RAGE:MP часто возвращает false — полёт «зависал».
    // freezePosition уже нажат, поэтому игрок сам никуда не побежит.
    let speed = 0.5;
    if (mp.game.controls.isControlPressed(0, 21)) speed = 2.0; // Shift
    if (mp.game.controls.isControlPressed(0, 19)) speed = 0.05; // Alt

    const dir = getCameraDirection();
    let pos = player.position;

    if (mp.game.controls.isControlPressed(0, 32)) {
        pos.x += dir.x * speed;
        pos.y += dir.y * speed;
        pos.z += dir.z * speed;
    }
    if (mp.game.controls.isControlPressed(0, 33)) {
        pos.x -= dir.x * speed;
        pos.y -= dir.y * speed;
        pos.z -= dir.z * speed;
    }
    if (mp.game.controls.isControlPressed(0, 34)) {
        pos.x -= dir.y * speed; // влево
        pos.y += dir.x * speed;
    }
    if (mp.game.controls.isControlPressed(0, 35)) {
        pos.x += dir.y * speed; // вправо
        pos.y -= dir.x * speed;
    }
    if (mp.game.controls.isControlPressed(0, 22)) pos.z += speed;
    if (mp.game.controls.isControlPressed(0, 36)) pos.z -= speed;

    player.position = pos;

    // ---------- Жёлтый маркер тюрьмы (круг на земле + стены-градиент вверх) ----------
    // drawMarker: тип 4 — круг на земле; тип 1 — вертикальный цилиндр («стены»).
    // Рисуем только вблизи, чтобы не тратить кадры на дальних концах карты.
    if (prisonMarkerPos) {
        const px = prisonMarkerPos.x;
        const py = prisonMarkerPos.y;
        const pz = prisonMarkerPos.z;
        const lpPos = player.position;
        const d = Math.sqrt((lpPos.x - px) * (lpPos.x - px) + (lpPos.y - py) * (lpPos.y - py));
        if (d < 400) {
            try {
                // Круг на земле (жёлтый) — вплотную к точке
                mp.game.graphics.drawMarker(4, px, py, pz + 0.02, 0, 0, 0, 0, 0, 0, 10, 10, 0.4, 255, 200, 20, 130, false, false, 2, false, null, null, false);
                // Стены вверх (цилиндр-градиент, полупрозрачный жёлтый) — от земли
                mp.game.graphics.drawMarker(1, px, py, pz + 0.1, 0, 0, 0, 0, 0, 0, 9, 9, 2.4, 255, 220, 40, 80, false, false, 2, false, null, null, false);
            } catch (e) { /* ignore */ }
        }
    }
    // Метки выхода игроков: красный круг на земле + надпись «вышел ... назад»
    if (quitMarkersMap.size > 0) {
        try {
            const qp = player.position;
            quitMarkersMap.forEach((mk) => {
                const dx = qp.x - mk.x, dy = qp.y - mk.y;
                if (dx * dx + dy * dy > 300 * 300) return;
                mp.game.graphics.drawMarker(4, mk.x, mk.y, mk.z + 0.05, 0, 0, 0, 0, 0, 0, 1.4, 1.4, 0.3, 255, 60, 60, 150, false, false, 2, false, null, null, false);
                drawEspLabel(new mp.Vector3(mk.x, mk.y, mk.z + 1.6), [mk.text], [255, 220, 160, 255], 0.33);
            });
        } catch (e) { /* ignore */ }
    }
});

// ---------- Проверка DLC-модели после /veh ----------
// Сервер просит клиента проверить, знает ли игра модель по хешу
// (IS_MODEL_IN_CDIMAGE): если false — DLC не смонтирован/не скачан.
mp.events.add('veh:verify', (name, hash) => {
    let mounted = false;
    try {
        mounted = typeof mp.game.streaming.isModelInCdimage === 'function'
            ? mp.game.streaming.isModelInCdimage(hash)
            : false;
    } catch (e) { /* ignore */ }
    if (mounted) {
        chatPush(`!{44FF44}Модель ${name} загружена на клиенте (DLC смонтирован).`);
    } else {
        chatPush(`!{FF4444}Модель ${name} НЕ загружена на клиенте — DLC не смонтирован/не скачан. Перезайди полностью после рестарта сервера.`);
    }
});

// ---------- Розыск: применение звёзд на самом игроке (/star) ----------
// setFakeWantedLevel рисует HUD-звёзды GTA; setWantedLevel — реальный уровень;
// setPoliceIgnorePlayer(true) — чтобы не спавнились NPC-копы.
mp.events.add('star:apply', (stars) => {
    stars = Math.max(0, Math.min(5, parseInt(stars, 10) || 0));
    try {
        if (typeof mp.game.gameplay.setFakeWantedLevel === 'function') {
            mp.game.gameplay.setFakeWantedLevel(stars);
        }
    } catch (e) { /* ignore */ }
    try {
        if (typeof mp.game.player.setWantedLevel === 'function') {
            mp.game.player.setWantedLevel(stars);
        }
    } catch (e) { /* ignore */ }
    try {
        if (typeof mp.game.player.setPoliceIgnorePlayer === 'function') {
            mp.game.player.setPoliceIgnorePlayer(true);
        }
    } catch (e) { /* ignore */ }
});

// ---------- /mtp: телепорт по метке на карте ----------
// Координаты метки доступны только клиенту (waypoint blip type = 8).
mp.events.add('playerCommand', (command) => {
    let parts;
    try { parts = String(command).trim().split(/\s+/); } catch (e) { return; }
    if (!parts || !parts.length || parts[0] !== 'mtp') return;
    try {
        const wp = mp.game.ui.getFirstBlipInfoId(8); // 8 = waypoint
        if (!mp.game.ui.doesBlipExist(wp)) {
            chatPush('!{FF4444}Сначала поставьте метку на карте (M → правая кнопка мыши).');
            return;
        }
        const coords = mp.game.ui.getBlipInfoIdCoord(wp);
        // Реальная высота земли, чтобы не телепортнуть под карту.
        // Ставим ТОЧКУ ВЫШЕ цели и даём гравитации уронить на поверхность —
        // так надёжнее, чем прижиматься к земле (иначе слегка «проваливаемся»).
        let groundZ = 0;
        try {
            if (typeof mp.game.gameplay.getGroundZFor3dCoord === 'function') {
                groundZ = mp.game.gameplay.getGroundZFor3dCoord(coords.x, coords.y, 1000.0, 0, false);
            }
        } catch (e) { /* ignore */ }
        const zOff = (mp.players.local.vehicle) ? 4.5 : 3.0;
        let z;
        if (!groundZ || !Number.isFinite(groundZ)) {
            z = ((typeof coords.z === 'number' && Number.isFinite(coords.z)) ? coords.z : 50.0) + zOff;
        } else {
            z = groundZ + zOff;
        }
        mp.events.callRemote('mtp:teleport', coords.x, coords.y, z);
    } catch (e) {
        chatPush('!{FF4444}Не удалось получить координаты метки.');
    }
});

// ---------- Маркер преступника (/orm) ----------
// Блин на карте; координаты каждую секунду присылает сервер (не зависит от
// стрима/дальности цели). Бессрочный — убирается /unorm (событие orm:stop).
let ormBlip = null;

function ormClear() {
    if (ormBlip) { try { ormBlip.destroy(); } catch (e) { /* ignore */ } ormBlip = null; }
}

mp.events.add('orm:showMarker', (name, stars, reason) => {
    ormClear();
    try {
        ormBlip = mp.blips.new(163, mp.players.local.position, {
            color: 1,
            name: `${name} (${stars} зв.)`,
            scale: 1.0
        });
    } catch (e) { /* ignore */ }
});

mp.events.add('orm:tick', (x, y, z) => {
    try {
        if (!ormBlip) return;
        ormBlip.position = new mp.Vector3(x, y, z);
        ormBlip.dimension = mp.players.local.dimension;
    } catch (e) { /* ignore */ }
});

mp.events.add('orm:stop', ormClear);

// ---------- Бинды клавиш (/bind) ----------
// Привязка цепочки команд к клавише: /bind a /fly;/givemoney 100 —
// нажатие 'a' выполнит обе команды. Хранятся на клиенте (mp.storage).
const BIND_STORAGE_KEY = 'adminKeyBinds';
const RESERVED_VK = { 0x1B: 1, 0x54: 1, 0x52: 1, 0x4A: 1, 0x45: 1, 0x74: 1 }; // ESC, T, R, J, E, F5

const KEY_TO_VK = (() => {
    const m = {};
    for (let i = 0; i < 26; i++) m[String.fromCharCode(65 + i)] = 0x41 + i; // A-Z
    for (let i = 0; i < 10; i++) m[String(i)] = 0x30 + i; // 0-9
    for (let i = 1; i <= 12; i++) m['F' + i] = 0x6F + i; // F1-F12
    const extra = {
        SPACE: 0x20, ENTER: 0x0D, TAB: 0x09, BACKSPACE: 0x08,
        LSHIFT: 0xA0, RSHIFT: 0xA1, LCTRL: 0xA2, RCTRL: 0xA3, LALT: 0xA4, RALT: 0xA5,
        INSERT: 0x2D, DELETE: 0x2E, HOME: 0x24, END: 0x23, PGUP: 0x21, PGDOWN: 0x22,
        MINUS: 0xBD, EQUALS: 0xBB, SEMICOLON: 0xBA, QUOTE: 0xDE, COMMA: 0xBC,
        PERIOD: 0xBE, SLASH: 0xBF, LBRACKET: 0xDB, RBRACKET: 0xDD, BACKSLASH: 0xDC, TILDE: 0xC0
    };
    Object.keys(extra).forEach((k) => { m[k] = extra[k]; });
    return m;
})();

const VK_TO_NAME = (() => {
    const m = {};
    Object.keys(KEY_TO_VK).forEach((k) => { m[KEY_TO_VK[k]] = k; });
    return m;
})();

let keyBinds = {}; // vk (число-ключ) -> 'команда;команда'
const boundVk = new Set(); // на какие VK уже повесили обработчик

const saveBinds = () => {
    try {
        const arr = Object.keys(keyBinds).map((vk) => [Number(vk), keyBinds[vk]]);
        mp.storage.set(BIND_STORAGE_KEY, JSON.stringify(arr));
    } catch (e) { /* ignore */ }
};

const loadBinds = () => {
    try {
        const raw = mp.storage.get(BIND_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        if (Array.isArray(arr)) arr.forEach((b) => { keyBinds[b[0]] = String(b[1]); });
    } catch (e) { keyBinds = {}; }
};

const applyBind = (vk) => {
    if (boundVk.has(vk)) return;
    boundVk.add(vk);
    try {
        mp.keys.bind(Number(vk), true, () => {
            if (isChatTyping()) return;
            const cmds = keyBinds[vk];
            if (!cmds) return;
            cmds.split(';').forEach((c) => {
                c = String(c).replace(/^\//, '').trim();
                if (!c) return;
                mp.events.callRemote('bind:execute', c);
            });
        });
    } catch (e) { boundVk.delete(vk); }
};

loadBinds();
Object.keys(keyBinds).forEach((vk) => applyBind(vk));

// /bind, /unbind, /binds обрабатываются на клиенте (серверу такие команды не нужны)
mp.events.add('playerCommand', (command) => {
    let parts;
    try { parts = String(command).trim().split(/\s+/); } catch (e) { return; }
    if (!parts.length) return;
    const first = parts[0].toLowerCase();
    if (first !== 'bind' && first !== 'unbind' && first !== 'binds') return;

    if (first === 'binds') {
        const keys = Object.keys(keyBinds);
        if (keys.length === 0) {
            chatPush('!{FFFF00}Бинды не заданы. Пример: /bind a /fly;/givemoney 100');
            return;
        }
        chatPush('!{FFFF00}Ваши бинды:');
        keys.forEach((vk) => {
            const nm = VK_TO_NAME[Number(vk)] || String(vk);
            chatPush(` !{44FF44}${nm}: !{FFFFFF}/${keyBinds[vk].split(';').join('  /')}`);
        });
        return;
    }

    const keyName = parts[1] ? parts[1].toUpperCase() : '';
    const vk = KEY_TO_VK[keyName];
    if (vk === undefined) {
        chatPush('!{FF4444}Клавиша не поддерживается. Доступны: A-Z, 0-9, F1-F12, SPACE, TAB, LSHIFT, RSHIFT, LCTRL, RCTRL, LALT, RALT, MINUS, EQUALS, COMMA, PERIOD, SLASH и др.');
        return;
    }
    if (RESERVED_VK[vk]) {
        chatPush('!{FF4444}Клавиша занята системой (ESC / T / R / J / E / F5). Выберите другую.');
        return;
    }

    if (first === 'unbind') {
        if (keyBinds[vk]) {
            delete keyBinds[vk];
            saveBinds();
            chatPush(`!{44FF44}Бинд снят с клавиши ${keyName}.`);
        } else {
            chatPush(`!{FFFF00}На клавишу ${keyName} ничего не привязано.`);
        }
        return;
    }

    // /bind <клавиша> без команд — снять; с командами — привязать
    if (parts.length < 3) {
        if (keyBinds[vk]) {
            delete keyBinds[vk];
            saveBinds();
            chatPush(`!{44FF44}Бинд снят с клавиши ${keyName}.`);
        } else {
            chatPush('!{FFFF00}Использование: /bind [клавиша] [команды], напр.: /bind a /fly;/givemoney 100');
        }
        return;
    }

    const cmds = parts.slice(2).join(' ').replace(/^\//, '');
    keyBinds[vk] = cmds;
    applyBind(vk);
    saveBinds();
    chatPush(`!{44FF44}Клавиша ${keyName} привязана: /${cmds.split(';').join('  /')}`);
});
