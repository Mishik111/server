// ---------- Казино: деньги ($), фишки и игры (рулетка / слоты / кости) ----------
// Подключается из packages/admin/index.js в конце файла:
//     require('../casino/index.js')({ hasPerm, noPermMsg });
// Балансы хранятся в БД (characters.money / characters.chips).
const charDb = require('../freeroam/char-db.js');

module.exports = function initCasino(deps) {
    const { hasPerm, noPermMsg } = deps;

    // Зона казино (площадь у Diamond Casino). Вход — маркер на карте.
    const CASINO_POS = new mp.Vector3(936.0, 44.0, 80.0);
    const CASINO_RADIUS = 25.0;
    const DEFAULT_MONEY = 5000;
    const MAX_AMOUNT = 1000000;

    const inCasino = (p) => {
        try {
            const v = p.position;
            const dx = v.x - CASINO_POS.x, dy = v.y - CASINO_POS.y, dz = v.z - CASINO_POS.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz) <= CASINO_RADIUS;
        } catch (e) { return false; }
    };

    const getMoney = (p) => (typeof p.money === 'number' && isFinite(p.money)) ? p.money : DEFAULT_MONEY;
    const getChips = (p) => (typeof p.chips === 'number' && isFinite(p.chips)) ? p.chips : 0;

    // Синхронизация баланса: переменные для других плагинов, событие клиенту, запись в БД
    const pushBalance = (player) => {
        try {
            player.money = Math.max(0, Math.round(getMoney(player)));
            player.chips = Math.max(0, Math.round(getChips(player)));
            player.setVariable('money', player.money);
            player.setVariable('chips', player.chips);
            player.call('casino:update', [player.money, player.chips]);
            if (player.citizenId != null) charDb.saveBalance(player.citizenId, player.money, player.chips);
        } catch (e) { /* ignore */ }
    };

    // Загрузка баланса при входе
    mp.events.add('playerReady', (player) => {
        if (player.char && typeof player.char.money === 'number') player.money = player.char.money;
        if (player.char && typeof player.char.chips === 'number') player.chips = player.char.chips;
        pushBalance(player);
    });

    // Сохранение при выходе
    mp.events.add('playerQuit', (player) => {
        if (player.citizenId != null) {
            try { charDb.saveBalance(player.citizenId, getMoney(player), getChips(player)); } catch (e) { /* ignore */ }
        }
    });

    // Запрос текущего баланса (при открытии интерфейса)
    mp.events.add('casino:sync', (player) => pushBalance(player));

    const clampAmt = (v) => {
        v = parseInt(v, 10);
        if (isNaN(v) || v < 1) return 0;
        return Math.min(v, MAX_AMOUNT);
    };

    const resultToClient = (player, payload) => {
        try { player.call('casino:result', [JSON.stringify(payload)]); } catch (e) { /* ignore */ }
    };

    // Снять ставку и выдать результат. mult — множитель выигрыша (0 = проигрыш).
    const resolveBet = (player, bet, mult, game, details) => {
        player.chips = getChips(player) - bet;
        const winAmt = mult > 0 ? bet * mult : 0;
        player.chips += mult > 0 ? bet + winAmt : 0;
        pushBalance(player);
        resultToClient(player, { game, won: mult > 0, bet, win: mult > 0 ? bet + winAmt : 0, mult, details });
        if (mult > 0) {
            player.outputChatBox(`!{44FF44}Казино: выигрыш +${winAmt} фишек (ставка ${bet} x${mult})!`);
        } else {
            player.outputChatBox(`!{FF4444}Казино: ставка ${bet} проиграна.`);
        }
    };

    // ---------- Рулетка (европейская, 0-36) ----------
    const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

    const rouletteBet = (player, payload) => {
        const amount = clampAmt(payload.amount);
        if (amount < 1 || getChips(player) < amount) {
            player.outputChatBox('!{FF4444}Недостаточно фишек.');
            return;
        }
        const type = String(payload.type || '');
        const value = parseInt(payload.value, 10);
        const r = Math.floor(Math.random() * 37);
        let mult = 0;
        switch (type) {
            case 'straight':
                if (r === value) mult = 35;
                break;
            case 'color':
                if (r > 0 && value === 1 && RED.has(r)) mult = 1;
                if (r > 0 && value === 0 && !RED.has(r)) mult = 1;
                break;
            case 'oddEven':
                if (r > 0 && value === 1 && r % 2 === 1) mult = 1;
                if (r > 0 && value === 0 && r % 2 === 0) mult = 1;
                break;
            case 'half':
                if (r > 0 && value === 0 && r <= 18) mult = 1;
                if (r > 0 && value === 1 && r >= 19) mult = 1;
                break;
            case 'dozen':
                if (r > 0 && value >= 0 && value <= 2 && Math.floor((r - 1) / 12) === value) mult = 2;
                break;
            case 'column':
                if (r > 0 && value >= 0 && value <= 2 && r % 3 === value) mult = 2;
                break;
        }
        resolveBet(player, amount, mult, 'roulette', { number: r, type, value });
    };

    // ---------- Слоты (3 барабана) ----------
    const SLOT_SYMBOLS = ['SEVEN', 'DIAMOND', 'BELL', 'CHERRY', 'LEMON', 'ORANGE'];
    const SLOT_PAY = [50, 25, 15, 10, 8, 6];

    const slotsBet = (player, payload) => {
        const amount = clampAmt(payload.amount);
        if (amount < 1 || getChips(player) < amount) {
            player.outputChatBox('!{FF4444}Недостаточно фишек.');
            return;
        }
        const r1 = Math.floor(Math.random() * 6);
        const r2 = Math.floor(Math.random() * 6);
        const r3 = Math.floor(Math.random() * 6);
        let mult = 0;
        if (r1 === r2 && r2 === r3) mult = SLOT_PAY[r1];
        else if (r1 === r2 || r1 === r3 || r2 === r3) mult = 2;
        resolveBet(player, amount, mult, 'slots', { reels: [SLOT_SYMBOLS[r1], SLOT_SYMBOLS[r2], SLOT_SYMBOLS[r3]] });
    };

    // ---------- Кости (2 кубика) ----------
    const DICE_EXACT = { 2: 35, 3: 17, 4: 11, 5: 8, 6: 6, 7: 5, 8: 6, 9: 8, 10: 11, 11: 17, 12: 35 };

    const diceBet = (player, payload) => {
        const amount = clampAmt(payload.amount);
        if (amount < 1 || getChips(player) < amount) {
            player.outputChatBox('!{FF4444}Недостаточно фишек.');
            return;
        }
        const type = String(payload.type || '');
        const value = parseInt(payload.value, 10);
        const d1 = 1 + Math.floor(Math.random() * 6);
        const d2 = 1 + Math.floor(Math.random() * 6);
        const sum = d1 + d2;
        let mult = 0;
        if (type === 'over' && sum >= 8) mult = 1;
        if (type === 'under' && sum <= 6) mult = 1;
        if (type === 'seven' && sum === 7) mult = 5;
        if (type === 'exact' && value >= 2 && value <= 12 && sum === value) mult = DICE_EXACT[value] || 0;
        resolveBet(player, amount, mult, 'dice', { dice: [d1, d2], sum, type, value });
    };

    // ---------- Приём ставок из интерфейса ----------
    mp.events.add('casino:bet', (player, game, payloadJson) => {
        if (!player.citizenId) return;
        if (!inCasino(player)) {
            player.outputChatBox('!{FF4444}Казино: вы находитесь вне зоны казино.');
            return;
        }
        if (player.cuffed) {
            player.outputChatBox('!{FF4444}В наручниках казино недоступно.');
            return;
        }
        let payload = null;
        try { payload = JSON.parse(String(payloadJson)); } catch (e) { return; }
        if (!payload || typeof payload !== 'object') return;
        game = String(game || '');
        if (game === 'roulette') rouletteBet(player, payload);
        else if (game === 'slots') slotsBet(player, payload);
        else if (game === 'dice') diceBet(player, payload);
    });

    // ---------- Обмен денег на фишки и обратно (только в зоне казино) ----------
    mp.events.add('casino:exchange', (player, type, amount) => {
        if (!player.citizenId) return;
        if (!inCasino(player)) {
            player.outputChatBox('!{FF4444}Казино: вы находитесь вне зоны казино.');
            return;
        }
        const n = clampAmt(amount);
        if (n < 1) return;
        if (type === 'buy') {
            if (getMoney(player) < n) {
                player.outputChatBox('!{FF4444}Недостаточно денег.');
                return;
            }
            player.money = getMoney(player) - n;
            player.chips = getChips(player) + n;
            pushBalance(player);
            player.outputChatBox(`!{44FF44}Куплено фишек: ${n} за $${n}.`);
        } else if (type === 'sell') {
            if (getChips(player) < n) {
                player.outputChatBox('!{FF4444}Недостаточно фишек.');
                return;
            }
            player.money = getMoney(player) + n;
            player.chips = getChips(player) - n;
            pushBalance(player);
            player.outputChatBox(`!{44FF44}Продано фишек: ${n} за $${n}.`);
        }
    });

    // ---------- Команды ----------
    mp.events.addCommand('money', (player) => {
        player.outputChatBox(`!{44FF44}Баланс: $${getMoney(player)} | Фишки: ${getChips(player)}`);
    });

    // /buy [n] — купить фишки за деньги (в зоне казино)
    mp.events.addCommand('buy', (player, _, argN) => {
        if (!inCasino(player)) {
            player.outputChatBox('!{FF4444}Использование: /buy [количество] — нужно находиться в зоне казино.');
            return;
        }
        mp.events.call('casino:exchange', player, 'buy', parseInt(argN, 10));
    });

    // /sell [n] — продать фишки за деньги (в зоне казино)
    mp.events.addCommand('sell', (player, _, argN) => {
        if (!inCasino(player)) {
            player.outputChatBox('!{FF4444}Использование: /sell [количество] — нужно находиться в зоне казино.');
            return;
        }
        mp.events.call('casino:exchange', player, 'sell', parseInt(argN, 10));
    });

    // /givemoney [id] [сумма] — выдать/снять деньги (админ). Без id — себе
    mp.events.addCommand('givemoney', (player, _, argId, argSum) => {
        if (!hasPerm(player, 'money')) { noPermMsg(player); return; }
        // Одно число = /givemoney [сумма] — самому себе (как в справке команды)
        if (argSum === undefined || argSum === null || String(argSum).trim() === '') {
            const sum = parseInt(argId, 10);
            if (isNaN(sum) || sum === 0) {
                player.outputChatBox('!{FF4444}Укажите сумму (можно отрицательную).');
                return;
            }
            player.money = Math.max(0, getMoney(player) + sum);
            pushBalance(player);
            player.outputChatBox(`!{44FF44}Вам ${sum > 0 ? 'выдано' : 'снято'} $${Math.abs(sum)}.`);
            return;
        }
        const sum = parseInt(argSum, 10);
        if (isNaN(sum) || sum === 0) {
            player.outputChatBox('!{FF4444}Укажите сумму (можно отрицательную).');
            return;
        }
        if (!argId) {
            // /givemoney [сумма] — самому себе
            player.money = Math.max(0, getMoney(player) + sum);
            pushBalance(player);
            player.outputChatBox(`!{44FF44}Вам ${sum > 0 ? 'выдано' : 'снято'} $${Math.abs(sum)}.`);
            return;
        }
        const target = mp.players.toArray().find((p) => p && p.citizenId === parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /givemoney [id] [сумма] — игрок с таким ID не найден');
            return;
        }
        target.money = Math.max(0, getMoney(target) + sum);
        pushBalance(target);
        target.outputChatBox(`!{44FF44}Администратор ${sum > 0 ? 'выдал' : 'снял'} $${Math.abs(sum)}.`);
        player.outputChatBox(`!{44FF44}Игроку ${target.citizenId} ${sum > 0 ? 'выдано' : 'снято'} $${Math.abs(sum)}.`);
    });

    // /givechips [id] [количество] — выдать/снять фишки (админ)
    mp.events.addCommand('givechips', (player, _, argId, argSum) => {
        if (!hasPerm(player, 'money')) { noPermMsg(player); return; }
        const target = mp.players.toArray().find((p) => p && p.citizenId === parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /givechips [id] [количество] — игрок с таким ID не найден');
            return;
        }
        const sum = parseInt(argSum, 10);
        if (isNaN(sum) || sum === 0) {
            player.outputChatBox('!{FF4444}Укажите количество (можно отрицательное).');
            return;
        }
        target.chips = Math.max(0, getChips(target) + sum);
        pushBalance(target);
        target.outputChatBox(`!{44FF44}Администратор ${sum > 0 ? 'выдал' : 'снял'} ${Math.abs(sum)} фишек.`);
        player.outputChatBox(`!{44FF44}Игроку ${target.citizenId} ${sum > 0 ? 'выдано' : 'снято'} ${Math.abs(sum)} фишек.`);
    });

    // /pay [id] [сумма] — перевести деньги игроку
    mp.events.addCommand('pay', (player, _, argId, argSum) => {
        if (player.citizenId == null) return;
        const target = mp.players.toArray().find((p) => p && p.citizenId === parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /pay [id] [сумма] — игрок с таким ID не найден');
            return;
        }
        if (target === player) {
            player.outputChatBox('!{FF4444}Нельзя перевести деньги самому себе.');
            return;
        }
        const sum = parseInt(argSum, 10);
        if (isNaN(sum) || sum < 1) {
            player.outputChatBox('!{FF4444}Укажите сумму (больше 0).');
            return;
        }
        if (getMoney(player) < sum) {
            player.outputChatBox(`!{FF4444}Недостаточно денег (у вас $${getMoney(player)}).`);
            return;
        }
        player.money = getMoney(player) - sum;
        target.money = getMoney(target) + sum;
        pushBalance(player);
        pushBalance(target);
        player.outputChatBox(`!{44FF44}Переведено $${sum} игроку ${target.citizenId}.`);
        target.outputChatBox(`!{44FF44}Игрок ${player.citizenId} перевёл вам $${sum}.`);
    });

    // ---------- Дуэль на костях (/bet [id] [сумма] -> /yes) ----------
    // Оба игрока ставят по sum, бросают кубик; у кого больше — забирает оба фонда.
    const betChallenges = new Map(); // to.citizenId -> { from, to, sum, expire }

    const charName = (p) => {
        try { if (p.char && p.char.name) return p.char.name; } catch (e) { /* ignore */ }
        return p.name || 'Игрок';
    };

    // Очистка истёкших вызовов
    setInterval(() => {
        const now = Date.now();
        betChallenges.forEach((ch, key) => {
            if (now > ch.expire) {
                try {
                    ch.from.outputChatBox(`!{FFFF00}Вызов игроку ${ch.to.citizenId} на кости истёк.`);
                    ch.to.outputChatBox('!{FFFF00}Вызов на кости истёк.');
                } catch (e) { /* ignore */ }
                betChallenges.delete(key);
            }
        });
    }, 10000);

    mp.events.addCommand('bet', (player, _, argId, argSum) => {
        if (player.citizenId == null) return;
        const target = mp.players.toArray().find((p) => p && p.citizenId === parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /bet [id] [сумма] — игрок с таким ID не найден');
            return;
        }
        if (target === player) {
            player.outputChatBox('!{FF4444}Нельзя играть с самим собой.');
            return;
        }
        const sum = parseInt(argSum, 10);
        if (isNaN(sum) || sum < 1) {
            player.outputChatBox('!{FF4444}Укажите ставку (больше 0).');
            return;
        }
        if (getMoney(player) < sum) {
            player.outputChatBox(`!{FF4444}Недостаточно денег (у вас $${getMoney(player)}).`);
            return;
        }
        if (getMoney(target) < sum) {
            player.outputChatBox(`!{FF4444}У игрока ${target.citizenId} недостаточно денег для такой ставки.`);
            return;
        }
        if (betChallenges.has(player.citizenId) || betChallenges.has(target.citizenId)) {
            player.outputChatBox('!{FF4444}У вас или у соперника уже есть активный вызов.');
            return;
        }
        betChallenges.set(target.citizenId, { from: player, to: target, sum, expire: Date.now() + 60000 });
        player.outputChatBox(`!{44FF44}Вызов отправлен игроку ${target.citizenId} (кости на $${sum}).`);
        target.outputChatBox(`!{FFFF00}Игрок ${player.citizenId} бросает вызов: кости на $${sum}! Введите /yes, чтобы принять.`);
    });

    mp.events.addCommand('yes', (player) => {
        const ch = betChallenges.get(player.citizenId);
        if (!ch) {
            player.outputChatBox('!{FF4444}У вас нет активного вызова (/bet).');
            return;
        }
        betChallenges.delete(player.citizenId);
        if (Date.now() > ch.expire) {
            player.outputChatBox('!{FF4444}Вызов истёк.');
            return;
        }
        // Соперник мог выйти
        try { if (!ch.from || !ch.from.position) throw 0; } catch (e) {
            player.outputChatBox('!{FF4444}Игрок, бросивший вызов, вышел из игры.');
            return;
        }
        if (getMoney(ch.from) < ch.sum || getMoney(player) < ch.sum) {
            ch.from.outputChatBox('!{FF4444}Недостаточно денег — дуэль отменена.');
            player.outputChatBox('!{FF4444}Недостаточно денег — дуэль отменена.');
            return;
        }
        // Бросок: переброс при ничьей (до 5 раз)
        let a = 1 + Math.floor(Math.random() * 6);
        let b = 1 + Math.floor(Math.random() * 6);
        let tries = 0;
        while (a === b && tries < 5) {
            a = 1 + Math.floor(Math.random() * 6);
            b = 1 + Math.floor(Math.random() * 6);
            tries++;
        }
        if (a === b) {
            ch.from.outputChatBox('!{FFFF00}Дуэль: 5 раз ничья — деньги возвращены.');
            player.outputChatBox('!{FFFF00}Дуэль: 5 раз ничья — деньги возвращены.');
            return;
        }
        const winner = a > b ? ch.from : player;
        ch.from.money = getMoney(ch.from) - ch.sum;
        player.money = getMoney(player) - ch.sum;
        winner.money = getMoney(winner) + ch.sum * 2;
        pushBalance(ch.from);
        pushBalance(player);
        const line = `!{F5A742}* Кости: ${charName(ch.from)} [${a}] против ${charName(player)} [${b}] — победил ${charName(winner)} (+$${ch.sum * 2})`;
        ch.from.outputChatBox(line);
        player.outputChatBox(line);
    });

    // /casino — адрес казино
    mp.events.addCommand('casino', (player) => {
        player.outputChatBox('!{FFFF00}Казино: маркер у Diamond Casino (Vinewood, площадь у входа). Нажмите E у маркера.');
        player.outputChatBox('!{FFFF00}Обмен: /buy [кол-во] (фишки за $) и /sell [кол-во] ($ за фишки).');
    });

    console.log('[casino] модуль загружен. Зона: 936.0, 44.0, 80.0 (радиус 25 м)');
};
