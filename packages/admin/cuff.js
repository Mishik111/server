// ---------- Наручники (6) / ведение задержанного (7) / посадка в машину (/put) ----------
// Отдельный модуль наручников. Подключается из packages/admin/index.js в конце файла:
//     require('./cuff.js')({ getPlayerById, hasPerm, noPermMsg });
module.exports = function initCuff(deps) {
    const { getPlayerById, hasPerm, noPermMsg } = deps;

    // Наручники: команды запрещены (гейт в index.js), руки за спиной +
    // полная блокировка управления и анимация — на клиенте (cuff:set)
    const setCuffedState = (target, state) => {
        target.cuffed = state;
        if (state) {
            try { target.removeAllWeapons(); } catch (e) { /* ignore */ }
        } else {
            // Сняли наручники — ведение прекращаем
            if (target.cuffLeader != null) {
                const officer = mp.players.toArray().find((p) => p && p.id === target.cuffLeader);
                if (officer && officer.leadTarget === target.citizenId) officer.leadTarget = null;
                target.cuffLeader = null;
                try { target.call('lead:stop', []); } catch (e) { /* ignore */ }
            }
        }
        try { target.setVariable('cuffed', state); } catch (e) { /* ignore */ }
        try { target.call('cuff:set', [state]); } catch (e) { /* ignore */ }
    };

    const cuffHandler = (player, _, argId) => {
        if (!hasPerm(player, 'cuff')) { noPermMsg(player); return; }
        const target = getPlayerById(parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /6 [id] — игрок с таким ID не найден');
            return;
        }
        const state = !target.cuffed;
        setCuffedState(target, state);
        if (state) {
            target.outputChatBox('!{FF4444}На вас надели наручники!');
            player.outputChatBox(`!{44FF44}Надеты наручники на игрока ${target.citizenId}.`);
        } else {
            target.outputChatBox('!{44FF44}С вас сняли наручники.');
            player.outputChatBox(`!{44FF44}Сняты наручники с игрока ${target.citizenId}.`);
        }
    };
    mp.events.addCommand('6', cuffHandler);
    mp.events.addCommand('cuff', cuffHandler);

    // /uncuff [id] — снять наручники (без id — с себя)
    mp.events.addCommand('uncuff', (player, _, argId) => {
        if (!hasPerm(player, 'cuff')) { noPermMsg(player); return; }
        const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /uncuff [id] — игрок с таким ID не найден');
            return;
        }
        if (!target.cuffed) {
            player.outputChatBox('!{FF4444}На игроке нет наручников.');
            return;
        }
        setCuffedState(target, false);
        target.outputChatBox('!{44FF44}С вас сняли наручники.');
        player.outputChatBox(`!{44FF44}Сняты наручники с игрока ${target.citizenId}.`);
    });

    // Ведение: задержанный примагничен к офицеру и не управляется сам —
    // «отстать» он не может, поэтому дистанционный контроль НЕ нужен.
    const stopLead = (officer, target) => {
        if (target.cuffLeader === officer.id) {
            target.cuffLeader = null;
            try { target.call('lead:stop', []); } catch (e) { /* ignore */ }
            target.outputChatBox('!{FF4444}Вас больше не ведут.');
        }
        if (officer.leadTarget === target.citizenId) officer.leadTarget = null;
        officer.outputChatBox('!{44FF44}Вы отпустили задержанного.');
    };

    const startLead = (officer, target) => {
        if (target.cuffLeader != null && target.cuffLeader !== officer.id) {
            const oldOfficer = mp.players.toArray().find((p) => p && p.id === target.cuffLeader);
            if (oldOfficer && oldOfficer.leadTarget === target.citizenId) oldOfficer.leadTarget = null;
        }
        target.cuffLeader = officer.id;
        officer.leadTarget = target.citizenId;
        try { target.call('lead:start', [officer.id]); } catch (e) { /* ignore */ }
        target.outputChatBox('!{FF4444}Вас взяли под руку.');
        officer.outputChatBox(`!{44FF44}Вы ведёте игрока ${target.citizenId}.`);
    };

    const leadHandler = (player, _, argId) => {
        if (!hasPerm(player, 'lead')) { noPermMsg(player); return; }
        if (!argId) {
            // /7 без id — отпустить того, кого ведём
            if (player.leadTarget) {
                const t = getPlayerById(player.leadTarget);
                if (t) stopLead(player, t);
            } else {
                player.outputChatBox('!{FF4444}Вы никого не ведёте. Использование: /7 [id]');
            }
            return;
        }
        const target = getPlayerById(parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /7 [id] — игрок с таким ID не найден');
            return;
        }
        if (!target.cuffed) {
            player.outputChatBox('!{FF4444}Игрок должен быть в наручниках (команда /6)!');
            return;
        }
        startLead(player, target);
    };
    mp.events.addCommand('7', leadHandler);
    mp.events.addCommand('lead', leadHandler);

    // /unlead — отпустить задержанного, которого ведём
    mp.events.addCommand('unlead', (player) => {
        if (!hasPerm(player, 'lead')) { noPermMsg(player); return; }
        if (player.leadTarget) {
            const t = getPlayerById(player.leadTarget);
            if (t) stopLead(player, t);
        } else {
            player.outputChatBox('!{FF4444}Вы никого не ведёте.');
        }
    });

    // Наведение на игрока + клавиша 6: надеть/снять наручники (без команды в чате)
    mp.events.add('admin:aimCuff', (player, citizenId, tx, ty, tz, ox, oy, oz) => {
        if (!hasPerm(player, 'cuff')) { noPermMsg(player); return; }
        const target = getPlayerById(parseInt(citizenId, 10));
        if (!target || target === player) return;
        if (tx != null && ox != null) {
            try {
                const dx = tx - ox, dy = ty - oy, dz = tz - oz;
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 30 && !(target.cuffLeader === player.id)) {
                    player.outputChatBox('!{FF4444}Цель слишком далеко (до 30 м).');
                    return;
                }
            } catch (e) { /* ignore */ }
        }
        const state = !target.cuffed;
        setCuffedState(target, state);
        if (state) {
            target.outputChatBox('!{FF4444}На вас надели наручники!');
            player.outputChatBox(`!{44FF44}Надеты наручники на игрока ${target.citizenId}.`);
        } else {
            target.outputChatBox('!{44FF44}С вас сняли наручники.');
            player.outputChatBox(`!{44FF44}Сняты наручники с игрока ${target.citizenId}.`);
        }
    });

    // Наведение на игрока + клавиша 7: взять под руку / отпустить
    mp.events.add('admin:aimLead', (player, citizenId, tx, ty, tz, ox, oy, oz) => {
        if (!hasPerm(player, 'lead')) { noPermMsg(player); return; }
        const target = getPlayerById(parseInt(citizenId, 10));
        if (!target || target === player) return;
        if (tx != null && ox != null) {
            try {
                const dx = tx - ox, dy = ty - oy, dz = tz - oz;
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 30 && !(target.cuffLeader === player.id)) {
                    player.outputChatBox('!{FF4444}Цель слишком далеко (до 30 м).');
                    return;
                }
            } catch (e) { /* ignore */ }
        }
        if (player.leadTarget === target.citizenId || target.cuffLeader === player.id) {
            stopLead(player, target);
            return;
        }
        if (!target.cuffed) {
            player.outputChatBox('!{FF4444}Игрок должен быть в наручниках (6)!');
            return;
        }
        startLead(player, target);
    });

    // 3D-расстояние (не зависящее от API RAGE:MP)
    const dist3 = (a, b) => {
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    // /put [id] — посадить задержанного (в наручниках) в машину.
    // Если офицер в машине — в неё, иначе в ближайшую свободную машину (до 15 м).
    mp.events.addCommand('put', async (player, _, argId) => {
        if (!hasPerm(player, 'lead')) { noPermMsg(player); return; }
        const target = getPlayerById(parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /put [id] — игрок с таким ID не найден');
            return;
        }
        if (!target.cuffed) {
            player.outputChatBox('!{FF4444}Игрок должен быть в наручниках (6)!');
            return;
        }

        // Список машин: своя (если в ней) + до 4 ближайших
        const vehicles = [];
        if (player.vehicle) vehicles.push(player.vehicle);
        try {
            const list = mp.vehicles.toArray().filter((v) => v && !v.destroyed && v.position);
            list.sort((a, b) => dist3(a.position, player.position) - dist3(b.position, player.position));
            for (let i = 0; i < list.length && vehicles.length < 5; i++) {
                if (vehicles.indexOf(list[i]) === -1) vehicles.push(list[i]);
            }
        } catch (e) { /* ignore */ }
        if (vehicles.length === 0) {
            player.outputChatBox('!{FF4444}Вы не в машине, а рядом (до 15 м) машин нет.');
            return;
        }

        let seated = false;
        outer:
        for (const veh of vehicles) {
            let maxSeats = 9;
            try { maxSeats = typeof veh.getMaxSeats === 'function' ? veh.getMaxSeats() : 9; } catch (e) { maxSeats = 9; }
            if (!maxSeats || maxSeats < 1) maxSeats = 9;
            // Сначала пассажирские места, водительское — в последнюю очередь
            const seats = [];
            for (let s = 1; s < maxSeats; s++) seats.push(s);
            seats.push(0);
            for (const s of seats) {
                try {
                    let ok = false;
                    if (typeof target.setIntoVehicle === 'function') {
                        const res = target.setIntoVehicle(veh, s); // Promise<boolean> в новых версиях
                        ok = res && typeof res.then === 'function' ? await res : !!res;
                    }
                    if (!ok && typeof target.putInVehicle === 'function') {
                        try { target.putInVehicle(veh, s); ok = target.vehicle === veh; } catch (e2) { ok = false; }
                    }
                    if (ok) { seated = true; break outer; }
                } catch (e) { /* место занято или невалидно — пробуем дальше */ }
            }
        }

        if (!seated) {
            player.outputChatBox('!{FF4444}Нет свободного места в машине.');
            return;
        }
        // Он сел в машину — ведение прекращаем
        if (target.cuffLeader === player.id) {
            target.cuffLeader = null;
            if (player.leadTarget === target.citizenId) player.leadTarget = null;
            try { target.call('lead:stop', []); } catch (e) { /* ignore */ }
        }
        target.outputChatBox('!{FF4444}Вас посадили в машину.');
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} посажен в машину.`);
    });

    // Очистка: офицер пропал из игры — молча отпускаем ведомых
    setInterval(() => {
        mp.players.forEach((t) => {
            if (!t.cuffed || t.cuffLeader == null) return;
            const officer = mp.players.toArray().find((p) => p && p.id === t.cuffLeader);
            if (!officer) {
                t.cuffLeader = null;
                try { t.call('lead:stop', []); } catch (e) { /* ignore */ }
            }
        });
    }, 2000);

    // Очистка при выходе игрока
    mp.events.add('playerQuit', (player) => {
        // Вышел офицер — отпустить всех, кого вёл
        if (player.leadTarget) {
            const t = getPlayerById(player.leadTarget);
            if (t && t.cuffLeader === player.id) {
                t.cuffLeader = null;
                try { t.call('lead:stop', []); } catch (e) { /* ignore */ }
            }
        }
        // Вышел задержанный — убрать его у офицера
        if (player.cuffed) {
            player.cuffed = false;
            try { player.setVariable('cuffed', false); } catch (e) { /* ignore */ }
        }
        mp.players.toArray().forEach((o) => {
            if (o !== player && o.cuffLeader === player.id) {
                o.cuffLeader = null;
                try { o.call('lead:stop', []); } catch (e) { /* ignore */ }
            }
        });
    });
};
