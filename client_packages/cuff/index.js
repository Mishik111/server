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

// Направление камеры (локальная копия, чтобы не зависеть от admin/index.js)
const cuffCamDir = () => {
    const rot = mp.game.cam.getGameplayCamRot(2);
    const cz = rot.z * (Math.PI / 180);
    const cx = rot.x * (Math.PI / 180);
    const multX = Math.abs(Math.cos(cx));
    return {
        x: -Math.sin(cz) * multX,
        y: Math.cos(cz) * multX,
        z: Math.sin(cx)
    };
};

// Игрок, на которого мы смотрим: пускаем луч из камеры и берём того, чья позиция
// (голова) ближе всего к лучу (перпендикулярно до 1.5 м), в радиусе 25 м.
// Экранная проекция вплотную врёт — луч работает и вплотную, и издалека.
const getAimedPlayer = () => {
    try {
        const camPos = mp.game.cam.getGameplayCamCoord();
        const dir = cuffCamDir();
        let best = null;
        let bestDist = 1.5;
        mp.players.forEachInStreamRange((p) => {
            if (p === me) return;
            if (!p.position || p.dist(me.position) > 25) return;
            const tp = new mp.Vector3(p.position.x, p.position.y, p.position.z + 0.7);
            const to = new mp.Vector3(tp.x - camPos.x, tp.y - camPos.y, tp.z - camPos.z);
            const t = to.x * dir.x + to.y * dir.y + to.z * dir.z;
            if (t <= 0) return; // за спиной
            const px = camPos.x + dir.x * t;
            const py = camPos.y + dir.y * t;
            const pz = camPos.z + dir.z * t;
            const d = Math.hypot(tp.x - px, tp.y - py, tp.z - pz);
            if (d < bestDist) { bestDist = d; best = p; }
        });
        return best;
    } catch (e) { return null; }
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
    mp.events.callRemote(remoteEvent, cid);
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
