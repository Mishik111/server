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
            // Оружие НЕ снимаем: в наручниках его использование блокирует клиент
            // (флаг 52 + блокировка управления), но из инвентаря оно не пропадает.
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

    // Экспортируем наружу (посадка в тюрьму снимает наручники через cuffApi)
    if (deps.api) deps.api.setCuffedState = setCuffedState;

    // Проверка дистанции для чат-команд: цель должна быть рядом (до 30 м),
    // как и при наведении прицелом (клавиши 6/7)
    const CMD_CUFF_DIST = 30.0;
    const distOk = (a, b) => {
        try {
            if (!a || !b || typeof a.x !== 'number' || typeof b.x !== 'number') return false;
            const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz) <= CMD_CUFF_DIST;
        } catch (e) { return false; }
    };
    const distFailMsg = (player) => player.outputChatBox(`!{FF4444}Цель слишком далеко (до ${CMD_CUFF_DIST} м).`);

    const cuffHandler = (player, _, argId) => {
        if (!hasPerm(player, 'cuff')) { noPermMsg(player); return; }
        const target = getPlayerById(parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /6 [id] — игрок с таким ID не найден');
            return;
        }
        if (!distOk(target.position, player.position)) { distFailMsg(player); return; }
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
        if (target !== player && !distOk(target.position, player.position)) { distFailMsg(player); return; }
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
        if (player.cuffed) {
            player.outputChatBox('!{FF4444}Вы в наручниках — надевать наручники нельзя!');
            return;
        }
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
        if (player.cuffed) {
            player.outputChatBox('!{FF4444}Вы в наручниках — вести задержанного нельзя!');
            return;
        }
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
    // Если офицер в машине — в неё, иначе в ближайшие машины (до 15 м).
    // Ведение выключается ДО посадки, чтобы клиентский магнит не выдернул его обратно.
    // Садим серверным putIntoVehicle (setIntoVehicle — клиентский метод, на сервере его нет).
    mp.events.addCommand('put', (player, _, argId) => {
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
        if (target !== player && !distOk(target.position, player.position)) { distFailMsg(player); return; }

        // Ведение отключаем сразу (магнит иначе мешает посадке)
        if (target.cuffLeader === player.id) {
            target.cuffLeader = null;
            if (player.leadTarget === target.citizenId) player.leadTarget = null;
            try { target.call('lead:stop', []); } catch (e) { /* ignore */ }
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

        // Только пассажирские места. Место водителя (0) исключено НАВСЕГДА:
        // иначе задержанный садился на руль. Приоритет — задние места, затем
        // переднее пассажирское. Сажаем одним вызовом putIntoVehicle (посадка
        // асинхронная, синхронно подтвердить нельзя) — поэтому занятость мест
        // проверяем заранее по getOccupant, а «Нет места» выводим, лишь когда
        // свободных пассажирских мест нет вовсе.
        let placed = false;
        outer:
        for (const veh of vehicles) {
            let maxSeats = 9;
            try { maxSeats = typeof veh.getMaxSeats === 'function' ? veh.getMaxSeats() : 9; } catch (e) { maxSeats = 9; }
            if (!maxSeats || maxSeats < 2) maxSeats = 9;
            const seats = [];
            for (let s = 2; s < maxSeats; s++) seats.push(s); // задние
            seats.push(1); // переднее пассажирское — в конце
            for (const s of seats) {
                try {
                    const occ = typeof veh.getOccupant === 'function' ? veh.getOccupant(s) : null;
                    if (occ && occ !== target) continue; // занято другим
                    if (typeof target.putIntoVehicle === 'function') {
                        target.putIntoVehicle(veh, s);
                    }
                    placed = true;
                    break outer;
                } catch (e) { /* место занято/битое — пробуем следующее */ }
            }
        }

        if (!placed) {
            player.outputChatBox('!{FF4444}Нет свободного места в машине.');
            return;
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

    // Смерть задержанного: ведение прекращаем (офицер больше не «привязан»),
    // а наручники НЕ снимаются — после респавна игрок остаётся задержанным
    mp.events.add('playerDeath', (player) => {
        // Сохраняем инвентарь, чтобы вернуть оружие после респавна (смерть сбрасывает его)
        try {
            const list = typeof player.getWeapons === 'function' ? player.getWeapons() : null;
            if (Array.isArray(list)) {
                player._savedWeapons = list
                    .filter((w) => w && w.hash)
                    .map((w) => [w.hash >>> 0, w.ammo || 999]);
            }
        } catch (e) { /* ignore */ }
        if (!player.cuffed) return;
        const officer = player.cuffLeader != null
            ? mp.players.toArray().find((p) => p && p.id === player.cuffLeader)
            : null;
        if (officer && officer.leadTarget === player.citizenId) officer.leadTarget = null;
        player.cuffLeader = null;
        try { player.call('lead:stop', []); } catch (e) { /* ignore */ }
    });

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
