let noclip = false;
let godmode = false;
let espEnabled = false;
let vfly = false; // полёт на машине (/vfly)
const player = mp.players.local;

let chatOpen = false;
let chatScrollInjected = false;
let escHold = 0; // фреймов после ESC — блокируем раньше раскрытие меню паузы

// Состояние тюрьмы (таймер показывает клиент)
let jailActive = false;
let jailSeconds = 0;
let jailReason = '';
let jailLastTickAt = 0;

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

mp.events.add('spec:stop', () => {
    specTargetId = null;
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

// 100% Рабочая выдача оружия через системный натив GTA V (без вызовов несуществующих функций)
mp.events.add('admin:giveWeapon', (weaponHash, ammo) => {
    // Native 0xBF0FD6E56C964FCB = GIVE_WEAPON_TO_PED
    mp.game.invoke('0xBF0FD6E56C964FCB', player.handle, weaponHash >>> 0, ammo, false, true);
    // Native 0xADF692B254977C0C = SET_CURRENT_PED_WEAPON (сразу берёт в руки)
    mp.game.invoke('0xADF692B254977C0C', player.handle, weaponHash >>> 0, true);
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

// ---------- Чат: прокрутка колёсиком мыши ----------
mp.keys.bind(0x54, true, () => { chatOpen = true; }); // T — открыть ввод чата
mp.keys.bind(0x0D, true, () => { chatOpen = false; }); // Enter — отправить/закрыть
mp.keys.bind(0x1B, true, () => { // ESC — закрыть чат и НЕ давать открыться паузе/карте
    chatOpen = false;
    escHold = 2;
    closePerm();
    try {
        if (mp.gui.cursor && typeof mp.gui.cursor.show === 'function') {
            mp.gui.cursor.show(false, false);
        }
    } catch (e) { /* ignore */ }
});

// События тюрьмы от сервера (таймер / блок полёта)
mp.events.add('jail:start', (seconds, reason) => {
    jailActive = true;
    jailSeconds = Number(seconds) || 0;
    jailReason = reason ? String(reason) : '';
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

// Делаем блок сообщений чата прокручиваемым (по умолчанию overflow:hidden)
const injectChatScroll = () => {
    try {
        if (typeof mp.gui === 'undefined' || !mp.gui.chat || typeof mp.gui.chat.execute !== 'function') return;
        mp.gui.chat.execute(
            "(function(){ if (window.__rcs) return; window.__rcs = true; " +
            "var ul = document.getElementById('chat_messages'); if (!ul) return; " +
            "ul.style.overflowY = 'auto'; ul.style.scrollbarWidth = 'none'; })();"
        );
        chatScrollInjected = true;
    } catch (e) { /* ignore */ }
};
setTimeout(injectChatScroll, 3000);
setInterval(injectChatScroll, 30000);

// История чата: стрелка вверх/вниз во вводе листает прошлые команды/сообщения (как в cmd)
const injectChatHistory = () => {
    try {
        if (typeof mp.gui === 'undefined' || !mp.gui.chat || typeof mp.gui.chat.execute !== 'function') return;
        mp.gui.chat.execute(
            "(function(){ if (window.__chh) return; window.__chh = true; " +
            "var inp = document.getElementById('chat_input') || document.getElementById('chatInput'); " +
            "if (!inp) return; window.__hist = window.__hist || []; window.__hi = window.__hist.length; " +
            "inp.addEventListener('keydown', function(e){ " +
            "  var k = e.key || ''; " +
            "  if (k === 'Enter' || e.keyCode === 13) { " +
            "    var v = this.value; if (v && v.length) { window.__hist.push(v); window.__hi = window.__hist.length; } " +
            "  } else if (k === 'ArrowUp' || e.keyCode === 38) { " +
            "    if (window.__hist.length) { window.__hi = Math.max(0, window.__hi - 1); this.value = window.__hist[window.__hi] || ''; } " +
            "    e.preventDefault(); e.stopPropagation(); " +
            "  } else if (k === 'ArrowDown' || e.keyCode === 40) { " +
            "    if (window.__hist.length) { window.__hi = Math.min(window.__hist.length, window.__hi + 1); this.value = window.__hist[window.__hi] || ''; } " +
            "    e.preventDefault(); e.stopPropagation(); } " +
            "}); })();"
        );
    } catch (e) { /* ignore */ }
};
setTimeout(injectChatHistory, 3000);
setInterval(injectChatHistory, 30000);

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
        mp.gui.chat.push('!{FF4444}Вы не в транспорте');
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
        mp.gui.chat.push('!{FF4444}В тюрьме полёт запрещён!');
        return;
    }
    if (myCuffed) {
        mp.gui.chat.push('!{FF4444}Вы в наручниках — полёт недоступен!');
        return;
    }
    if (!myPerms.noclip) {
        mp.gui.chat.push('!{FF4444}У вас нет прав на F5 (полёт)!');
        return;
    }
    mp.events.call('admin:toggleNoclip');
});

// Стрелка вверх — меню полномочий (только для главного админа, сервер проверит)
mp.keys.bind(0x26, true, () => { // 0x26 = Up
    if (chatOpen || jailActive || permBrowser) return;
    mp.events.callRemote('perm:requestPlayers');
});

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
        mp.gui.chat.push('!{FF4444}Вы должны находиться в машине!');
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

mp.events.add('render', () => {
    // Спектатор: камера следует за целью, можно крутить мышью и зумить колёсиком
    if (specTargetId != null && specCamera) {
        try {
            const target = mp.players.atRemoteId(specTargetId);
            if (target) {
                const p = target.position;
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

    // Чат открыт — не даём колёсику менять оружие
    if (chatOpen) {
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
        drawTextRow(0.95, 0.72, 'ТЮРЬМА DEMORGAN', [255, 70, 70, 255], 0.5);
        drawTextRow(0.95, 0.80, `${mm}:${ss}`, [255, 255, 255, 255], 1.4);
        if (jailReason) {
            // Причина крупнее, перенос на две строки
            const words = String(jailReason);
            const max = 22;
            const lines = [];
            let cur = '';
            let num = 0;
            for (let ch of words) {
                cur += ch;
                num++;
                if (num >= max) { lines.push(cur); cur = ''; num = 0; }
            }
            if (cur) lines.push(cur);
            lines.slice(0, 3).forEach((line, i) => {
                drawTextRow(0.95, 0.885 + i * 0.045, line, [255, 230, 160, 255], 0.5);
            });
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
});
