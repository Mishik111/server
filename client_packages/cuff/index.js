// ---------- Наручники (6) и ведение задержанного (7) — отдельный модуль ----------
const me = mp.players.local;

let cuffed = false;        // у меня наручники
let leadLeaderId = null;   // id офицера, который меня ведёт (remoteId)
let lastCuffAnimAt = 0;    // для повтора анимации «руки за спиной»

// Сообщаем другим скриптам (admin/index.js для F5), что мы в наручниках
const notifyCuffState = () => {
    try { mp.events.call('cuff:localState', cuffed); } catch (e) { /* ignore */ }
};

// Наручники: руки за спиной (флаг 52 = IS_HANDCUFFED + анимация mp_arresting/idle),
// полная блокировка управления — нельзя бегать, прыгать, доставать оружие.
mp.events.add('cuff:set', (state) => {
    cuffed = !!state;
    try {
        if (typeof me.setControl === 'function') me.setControl(!cuffed);
    } catch (e) { /* ignore */ }
    if (!cuffed) {
        try { mp.game.invoke('0xE1EF3C1216AFF2CD', me.handle); } catch (e) { /* CLEAR_PED_TASKS */ }
        leadLeaderId = null;
        lastCuffAnimAt = 0;
    } else {
        lastCuffAnimAt = 0; // render сразу зациклит анимацию
    }
    try {
        if (typeof me.setConfigFlag === 'function') me.setConfigFlag(52, cuffed);
        mp.game.invoke('0x9A77DFD295E29B09', me.handle, 52, cuffed);
    } catch (e) { /* ignore */ }
    notifyCuffState();
});

// Начать/прекратить ведение (сервер говорит, кто ведёт)
mp.events.add('lead:start', (leaderId) => {
    leadLeaderId = leaderId;
});
mp.events.add('lead:stop', () => {
    leadLeaderId = null;
});

// 3D-расстояние своими руками (Math.hypot и p.dist есть не во всех версиях клиента)
const dist3 = (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Проекция точки мира на экран (нормализованные 0..1) — тот же приём, что в ESP.
const projectToScreen = (x, y, z) => {
    try {
        const sc = mp.game.graphics.getScreenCoordFromWorldCoord(x, y, z);
        if (!sc || sc.result === false || sc.result === undefined) return null;
        if (sc.screenX > 1.5 || sc.screenX < -1.5 || sc.screenY > 1.5 || sc.screenY < -1.5) return null;
        return { x: sc.screenX, y: sc.screenY };
    } catch (e) { return null; }
};

// Камера: пробуем обёртки mp.game.cam один раз. В этой сборке RAGE:MP они не работают
// (нативы камеры выключены — mp.game.invoke на них ругается), поэтому используем
// направление взгляда по heading персонажа, который поворачивается за камерой.
let camChecked = false;
let camWorks = false;
const tryCam = () => {
    if (camChecked) return camWorks;
    camChecked = true;
    try {
        const p = mp.game.cam.getGameplayCamCoord();
        const r = mp.game.cam.getGameplayCamRot(2);
        camWorks = !!(p && p.x != null && r && r.x != null);
    } catch (e) { camWorks = false; }
    return camWorks;
};

// Игрок, на которого мы смотрим. Без mp.game.invoke (нативы камеры в этой сборке
// отключены). Схема:
// 1) луч из камеры, если она жива (точное прицеливание);
// 2) иначе луч по heading (персонаж поворачивается за камерой) + скрин-проекция;
// 3) кандидаты — те, кто в пределах 2.2 м от луча или вплотную (до 2 м);
// 4) если никто не прошёл — ближайший игрок вплотную (до 1.5 м).
const getAimedPlayer = () => {
    const mePos = me.position;

    let dir = null;
    let origin = null;
    if (tryCam()) {
        try {
            const p = mp.game.cam.getGameplayCamCoord();
            const r = mp.game.cam.getGameplayCamRot(2);
            const cz = r.z * (Math.PI / 180);
            const cx = r.x * (Math.PI / 180);
            const c = Math.cos(cx);
            dir = { x: -Math.sin(cz) * c, y: Math.cos(cz) * c, z: Math.sin(cx) };
            origin = p;
        } catch (e) { dir = null; origin = null; }
    }
    if (!dir || !origin) {
        const hd = me.getHeading() * (Math.PI / 180);
        dir = { x: Math.sin(hd), y: Math.cos(hd), z: 0 };
        origin = new mp.Vector3(mePos.x, mePos.y, mePos.z + 0.9);
    }

    let best = null;
    let bestScore = 1e9;

    mp.players.forEach((p) => {
        if (p === me || !p.position) return;
        try {
            const dx = p.position.x - mePos.x;
            const dy = p.position.y - mePos.y;
            const distH = Math.sqrt(dx * dx + dy * dy);
            const dz = (p.position.z + 0.7) - origin.z; // голова vs глаза
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > 25) return;

            const along = dx * dir.x + dy * dir.y + dz * dir.z;
            if (along <= 0) return; // позади

            const tx = origin.x + dir.x * along;
            const ty = origin.y + dir.y * along;
            const tz = origin.z + dir.z * along;
            const perp = Math.sqrt(
                (p.position.x - tx) * (p.position.x - tx) +
                (p.position.y - ty) * (p.position.y - ty) +
                ((p.position.z + 0.7) - tz) * ((p.position.z + 0.7) - tz)
            );

            // Вплотную (до 2 м) — кандидат при любом отклонении луча;
            // иначе цель должна быть почти на линии взгляда
            const pointBlank = distH <= 2;
            if (!pointBlank && perp > 2.2) return;

            // Скрин-проекция головы: 0 = центр экрана, помогаем выбору при двух целях
            const sc = projectToScreen(p.position.x, p.position.y, p.position.z + 0.7);
            let screenScore = 0.35;
            if (sc) screenScore = Math.sqrt((sc.x - 0.5) * (sc.x - 0.5) + (sc.y - 0.5) * (sc.y - 0.5));

            const score = perp * 3 + screenScore * 10 + distH * 0.1;
            if (score < bestScore) { bestScore = score; best = p; }
        } catch (e) { /* игрок мог отстримиться — пропускаем */ }
    });

    if (!best) {
        // Последний шанс: ближайший игрок вплотную (до 1.5 м)
        let nearest = null;
        let nd = 1.5;
        mp.players.forEach((p) => {
            if (p === me || !p.position) return;
            try {
                const d = dist3(p.position, mePos);
                if (d < nd) { nd = d; nearest = p; }
            } catch (e) { /* ignore */ }
        });
        return nearest;
    }
    return best;
};

// Клавиши 6/7 по прицелу: 6 — наручники (надеть/снять), 7 — вести/отпустить
const callAimAction = (remoteEvent) => {
    try {
        if (mp.gui.chat.active === true) return; // печатаем в чате
    } catch (e) { /* ignore */ }
    const t = getAimedPlayer();
    if (!t) {
        mp.gui.chat.push('!{FF4444}Никто не в прицеле (до 25 м).');
        return;
    }
    const cid = t.getVariable && t.getVariable('citizenId');
    if (cid == null) return;
    const tp = t.position;
    const lp = me.position;
    // Позиции (цели и наши) передаём серверу — у него они устаревшие
    // при телепортах/магните/полёте, поэтому проверять надо по тому, что видим мы
    mp.events.callRemote(remoteEvent, cid, tp.x, tp.y, tp.z, lp.x, lp.y, lp.z);
};

mp.keys.bind(0x36, true, () => callAimAction('admin:aimCuff')); // 6 — надеть/снять наручники
mp.keys.bind(0x37, true, () => callAimAction('admin:aimLead')); // 7 — взять под руку / отпустить

// Каждый кадр:
// 1) держим блокировку управления, флаг 52 и анимацию «руки за спиной» (игра сбрасывает);
// 2) магнит ведения — задержанный стоит ПЕРЕД офицером (у его груди) и сам двигаться не может.
mp.events.add('render', () => {
    if (cuffed) {
        try {
            if (typeof me.setControl === 'function') me.setControl(false);
            if (typeof me.setConfigFlag === 'function') me.setConfigFlag(52, true);
            mp.game.invoke('0x9A77DFD295E29B09', me.handle, 52, true);
            if (Date.now() - lastCuffAnimAt > 2000) {
                lastCuffAnimAt = Date.now();
                // TASK_PLAY_ANIM: mp_arresting/idle — руки за спиной, loop
                mp.game.invoke('0xEA47FE3719165B94', me.handle, 'mp_arresting', 'idle', 8.0, 8.0, -1, 1, 0, true, true, true);
            }
        } catch (e) { /* ignore */ }
    }

    // Магнит: держим задержанного впереди офицера. Работает и без полёта;
    // если задержанный посажен в машину (/put) — из машины не вытаскиваем.
    if (leadLeaderId != null && cuffed && !me.vehicle) {
        try {
            const leader = mp.players.atRemoteId(leadLeaderId);
            if (leader) {
                const lp = leader.position;
                const hd = typeof leader.getHeading === 'function' ? leader.getHeading() : 0;
                const rad = hd * (Math.PI / 180);
                // Впереди офицера на 0.9 м (его «живот»)
                const tx = lp.x + Math.sin(rad) * 0.9;
                const ty = lp.y + Math.cos(rad) * 0.9;
                const cur = me.position;
                if (Math.hypot(tx - cur.x, ty - cur.y) > 0.04) {
                    me.position = new mp.Vector3(tx, ty, lp.z);
                    lastCuffAnimAt = 0; // после рывка перезапустили позу
                }
                if (Math.abs(me.heading - hd) > 1) me.heading = hd;
            } else {
                leadLeaderId = null; // офицер пропал из стрима — стоим
            }
        } catch (e) { /* ignore */ }
    }
});
