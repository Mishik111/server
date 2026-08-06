// Поиск игрока по гражданскому ID (из packages/freeroam)
const getPlayerById = (id) => {
    if (!Number.isInteger(id)) return null;
    return mp.players.toArray().find((p) => p.citizenId === id);
};

const fs = require('fs');
const path = require('path');
const POSITIONS_FILE = path.join(process.cwd(), 'positions.txt');

// ---------- Тюрьма (карта игроков объявляется ниже, но гейт команд нужен раньше) ----------
const jailMap = new Map(); // игрок -> { release (ms), reason }
// Тюремные записи из БД: citizenId -> { release, reason, comment }. Возвращают игрока
// в тюрьму после рестарта сервера / перезахода.
const persistedJails = new Map();
// Розыск из БД: citizenId -> { stars, reason }.
const persistedWanted = new Map();
// Метки выхода игроков (кто когда вышел): { x, y, z, name, citizenId, time }
const quitMarkers = [];
const QUIT_MARKER_TTL = 15 * 60 * 1000; // живут 15 минут
const QUIT_MARKER_RADIUS = 350.0; // показываем игрокам в радиусе 350 м

// Маркер у входа в тюрьму: админ подводит задержанного (наручники + розыск),
// жмёт U (или /pjj) и заполняет форму посадки. Блин виден админам с правом ajail.
const PRISON_MARKER_POS = new mp.Vector3(1690.693, 2591.579, 45.901);
const PRISON_MARKER_RADIUS = 20.0;
const PRISON_TARGET_DIST = 30.0; // задержанный должен быть рядом с админом при посадке
const ARREST_MIN_MINUTES = 51; // время должно быть БОЛЬШЕ 50 минут

// В тюрьме (Demorgan) работают только /gun, /dunjail (для главного админа)
// и клавиша R — все остальные чат-команды блокируем. В наручниках — все запрещены.
const JAIL_ALLOWED_CMD = 'gun';
const _addCommandOrig = mp.events.addCommand;
// Реестр всех команд (для /bind: клиент шлёт имя команды, сервер вызывает обработчик)
const commandHandlers = new Map(); // cmd (нижний регистр) -> handler
mp.events.addCommand = function (cmdName, handler) {
    commandHandlers.set(String(cmdName).toLowerCase(), handler);
    _addCommandOrig.call(mp.events, cmdName, function (player, ...args) {
        if (jailMap.has(player)) {
            const isDunjailByHead = cmdName.toLowerCase() === 'dunjail' && player.citizenId === HEAD_ADMIN_ID;
            if (cmdName.toLowerCase() !== JAIL_ALLOWED_CMD && !isDunjailByHead) {
                player.outputChatBox('!{FF4444}В тюрьме доступны только /gun, /dunjail (гл. админ) и клавиша R!');
                return;
            }
        } else if (player.cuffed) {
            const isAuncuffByHead = cmdName.toLowerCase() === 'auncuff' && player.citizenId === HEAD_ADMIN_ID;
            if (!isAuncuffByHead) {
                player.outputChatBox('!{FF4444}Вы в наручниках — команды недоступны!');
                return;
            }
        }
        return handler(player, ...args);
    });
};

// ---------- Полномочия ----------
const charDb = require('../freeroam/char-db.js');
const HEAD_ADMIN_ID = 1; // главный админ (гражданский id из БД)
const perms = new Map(); // citizenId -> { cmd: true }
const CMD_LABELS = [
    ['veh', 'Спавн авто'],
    ['gun', 'Выдать оружие'],
    ['kill', 'Убить'],
    ['kick', 'Кикнуть (/kick)'],
    ['freeze', 'Заморозить'],
    ['invis', 'Невидимость'],
    ['respawn', 'Возрождение (R)'],
    ['copypos', 'Скопировать позицию'],
    ['spec', 'Спектатор (камера)'],
    ['skin', 'Скины GTA (модели)'],
    ['cuff', 'Наручники (6)'],
    ['lead', 'Вести задержанного (7)'],
    ['uncuff', 'Снять наручники'],
    ['unlead', 'Отпустить задержанного'],
    ['put', 'Посадить в машину'],
    ['vfly', 'Полёт на машине'],
    ['rescue', 'Воскресить'],
    ['tp', 'Телепорт к игроку'],
    ['gh', 'Притянуть игрока'],
    ['eject', 'Выкинуть из транспорта'],
    ['esp', 'ESP'],
    ['delveh', 'Удалить машину'],
    ['excar', 'Взорвать машину'],
    ['fuel', 'Топливо'],
    ['repair', 'Починить'],
    ['god', 'Бессмертие'],
    ['noclip', 'Полёт (F5)'],
    ['hp', 'Здоровье (/hp)'],
    ['ar', 'Броня (/ar)'],
    ['sbiv', 'Сбить анимацию (/sbiv)'],
    ['ajail', 'Посадить в тюрьму'],
    ['unjail', 'Освободить'],
    ['star', 'Объявить в розыск (/star)'],
    ['orm', 'Маркер преступника (/orm)'],
    ['livery', 'Раскраска машины (/livery)'],
    ['color', 'Цвет машины (/color)'],
    ['cid', 'ID машины (/cid)'],
    ['inc', 'Сесть в машину (/inc)'],
    ['mtp', 'Телепорт к метке (/mtp)'],
    ['money', 'Деньги и фишки (/givemoney, /givechips)']
];
const hasPerm = (player, cmd) => {
    if (player.citizenId === HEAD_ADMIN_ID) return true;
    const p = perms.get(player.citizenId);
    return !!(p && p[cmd]);
};
const noPermMsg = (player) => {
    player.outputChatBox('!{FF4444}У вас нет прав на эту команду!');
};

// Отправляем игроку его собственный список прав (для F5 и т.п.)
const syncPerms = (player) => {
    try {
        const own = {};
        if (player.citizenId === HEAD_ADMIN_ID) {
            CMD_LABELS.forEach(([cmd]) => { own[cmd] = true; });
        } else {
            const p = perms.get(player.citizenId);
            if (p) Object.keys(p).forEach((cmd) => { own[cmd] = true; });
        }
        player.call('perm:sync', [JSON.stringify(own)]);
    } catch (e) { /* ignore */ }
};
mp.events.add('playerReady', (player) => {
    syncPerms(player);
    // Админам с правом посадки — блин тюрьмы на радаре (+ маркер рисует клиент)
    if (hasPerm(player, 'ajail')) {
        try {
            player.call('prison:blip', [PRISON_MARKER_POS.x, PRISON_MARKER_POS.y, PRISON_MARKER_POS.z]);
        } catch (e) { /* ignore */ }
    }
    // Вернуть игрока в тюрьму после рестарта/перезахода (запись из БД)
    if (player.citizenId != null) {
        const rec = persistedJails.get(player.citizenId);
        if (rec) {
            persistedJails.delete(player.citizenId);
            if (rec.release > Date.now()) {
                applyJailState(player, rec.release, rec.reason, rec.comment, rec.type);
                player.outputChatBox('!{FF4444}Вы возвращены в тюрьму: срок наказания ещё не истёк.');
            } else {
                charDb.removeJail(player.citizenId); // срок истёк во время рестарта
            }
        }
        // Вернуть розыск после рестарта/перезахода
        const w = persistedWanted.get(player.citizenId);
        if (w) {
            persistedWanted.delete(player.citizenId);
            if (w.stars > 0) {
                player.wantedStars = w.stars;
                player.wantedReason = w.reason || '';
                try { player.setVariable('wantedStars', w.stars); } catch (e) { /* ignore */ }
                try { player.call('star:apply', [w.stars]); } catch (e) { /* ignore */ }
                player.outputChatBox(`!{FF4444}Вы всё ещё в розыске (${w.stars} зв.)${w.reason ? `: ${w.reason}` : ''}!`);
            }
        }
    }
});

// Помощь
mp.events.addCommand('help', (player) => {
    player.outputChatBox('!{FFD700}=== Админ Команды ===');
    player.outputChatBox('!{FFFF00}/kill [id] !{FFFFFF}- убить игрока по ID');
    player.outputChatBox('!{FFFF00}/freeze [id] !{FFFFFF}- заморозить/разморозить игрока по ID');
    player.outputChatBox('!{FFFF00}/rescue [id] !{FFFFFF}- воскресить и исцелить (себя или игрока по ID)');
    player.outputChatBox('!{FFFF00}/hp [количество] [id] !{FFFFFF}- установить здоровье (гл. админ себе — до 1000)');
    player.outputChatBox('!{FFFF00}/ar [количество] [id] !{FFFFFF}- установить броню (до 100)');
    player.outputChatBox('!{FFFF00}/sbiv [id] !{FFFFFF}- сбить анимацию игроку (дефолтное положение, сброс скорости)');
    player.outputChatBox('!{FFFF00}/bind [клавиша] [команды] !{FFFFFF}- привязать команды к клавише, напр.: /bind a /fly;/givemoney 100 (снять: /bind a, список: /binds)');
    player.outputChatBox('!{FFFF00}/tp [id] !{FFFFFF}- телепортироваться к игроку по ID');
    player.outputChatBox('!{FFFF00}/gh [id] !{FFFFFF}- телепортировать игрока по ID к себе');
    player.outputChatBox('!{FFFF00}/eject [id] !{FFFFFF}- выбросить игрока (или себя) из транспорта (цель рядом, до 10 м)');
    player.outputChatBox('!{FFFF00}/aeject [id] !{FFFFFF}- админ: выбросить игрока из транспорта в любой точке карты');
    player.outputChatBox('!{FFFF00}/esp !{FFFFFF}- показать всех игроков и машины');
    player.outputChatBox('!{FFFF00}/delveh [id] !{FFFFFF}- удалить машину по ID (или ближайшую)');
    player.outputChatBox('!{FFFF00}/excar [id] !{FFFFFF}- взорвать машину по ID (или ближайшую)');
    player.outputChatBox('!{FFFF00}/fuel [литры] [id] !{FFFFFF}- установить топливо машине (или ближайшей)');
    player.outputChatBox('!{FFFF00}/cid [id игрока] !{FFFFFF}- ID машины, в которой сидит игрок (/cid — ближайшая)');
    player.outputChatBox('!{FFFF00}/inc [vid] [место] !{FFFFFF}- сесть в машину на место (0 = водитель)');
    player.outputChatBox('!{FFFF00}/veh [название] [номер] !{FFFFFF}- заспавнить авто с кастомным номером');
    player.outputChatBox('!{FFFF00}/gun [название] !{FFFFFF}- выдать оружие (/gun — список)');
    player.outputChatBox('!{FFFF00}/repair !{FFFFFF}- починить авто');
    player.outputChatBox('!{FFFF00}/god !{FFFFFF}- бессмертие');
    player.outputChatBox('!{FFFF00}R !{FFFFFF}- возродиться (если вы мертвы)');
    player.outputChatBox('!{FFFF00}/noclip !{FFFFFF}(или /fly) - полёт');
    player.outputChatBox('!{FFFF00}/invis !{FFFFFF}- невидимость');
    player.outputChatBox('!{FFFF00}/copypos !{FFFFFF}- скопировать позицию (в positions.txt + чат)');
    player.outputChatBox('!{FFFF00}/spec [id] / /unspec !{FFFFFF}- наблюдать за игроком через камеру');
    player.outputChatBox('!{FFFF00}/mtp !{FFFFFF}- телепорт к метке на карте (в машине — вместе с машиной)');
    player.outputChatBox('!{FFFF00}/skin [id] !{FFFFFF}- сменить скин (/skin reset - вернуть свой)');
    player.outputChatBox('!{FFFF00}/6 [id] !{FFFFFF}(/cuff) - надеть/снять наручники (команды запрещены, скорость 50%)');
    player.outputChatBox('!{FFFF00}/7 [id] !{FFFFFF}(/lead) - взять задержанного под руку, /7 - отпустить');
    player.outputChatBox('!{FFFF00}/uncuff [id] !{FFFFFF}- снять наручники (без id - с себя)');
    player.outputChatBox('!{FFFF00}/unlead !{FFFFFF}- отпустить задержанного');
    player.outputChatBox('!{FFFF00}/put [id] !{FFFFFF}- посадить задержанного в свою машину, а вне машины - в ближайшую');
    player.outputChatBox('!{FFFF00}/vfly !{FFFFFF}- полёт на машине (машина летает)');
    player.outputChatBox('!{FFFF00}Навёл прицел на игрока + 6/7 !{FFFFFF}- наручники / взять под руку (до 8 м)');
    player.outputChatBox('!{FFFF00}/ajail [id] [минуты] [причина] !{FFFFFF}- посадить игрока в федеральную тюрьму');
    player.outputChatBox('!{FFFF00}Клавиша E у маркера тюрьмы !{FFFFFF}- интерфейс посадки (наручники + розыск)');
    player.outputChatBox('!{FFFF00}/unjail [id] !{FFFFFF}- досрочно освободить игрока');
    player.outputChatBox('!{FFFF00}/dunjail [id] !{FFFFFF}- гл. админ, в Деморгане: выпустить себя (без id) или игрока из тюрьмы');
    player.outputChatBox('!{FFFF00}/auncuff [id] !{FFFFFF}- гл. админ: снять наручники с игрока в любом месте');
    player.outputChatBox('!{FFFF00}/kick [id] [причина] !{FFFFFF}- кикнуть игрока с сервера');
    player.outputChatBox('!{FFFF00}/traffic [0-100] !{FFFFFF}- гл. админ: NPC-трафик и пешеходы, плотность (0 - выключить; видят все игроки)');
    player.outputChatBox('!{FFFF00}/star [id] [звёзды 0-5] [причина] !{FFFFFF}- объявить в розыск (/star [id] 0 - снять)');
    player.outputChatBox('!{FFFF00}/orm [id] !{FFFFFF}- показать маркер преступника на карте (бессрочно, убрать — /unorm)');
    player.outputChatBox('!{FFFF00}/unorm !{FFFFFF}- убрать маркер преступника (/orm)');
    player.outputChatBox('!{FFFF00}/livery [номер] !{FFFFFF}- раскраска (ливрея) вашей машины; без номера — следующая');
    player.outputChatBox('!{FFFF00}/color [R] [G] [B] !{FFFFFF}- покрасить машину в RGB-цвет (0-255)');
    player.outputChatBox('!{FFFF00}/reset !{FFFFFF}- изменить внешность и имя персонажа');
    player.outputChatBox('!{FFFF00}/perm !{FFFFFF}- меню полномочий (для главного админа, id=1)');
    player.outputChatBox('!{FFFF00}/money !{FFFFFF}- баланс ($ и фишки)');
    player.outputChatBox('!{FFFF00}/fpv !{FFFFFF}- запустить FPV дрон (управление: WASD, Шифт/Ctrl, выход: /fpv или Backspace)');
    player.outputChatBox('!{FFFF00}/pay [id] [сумма] !{FFFFFF}- перевести деньги игроку');
    player.outputChatBox('!{FFFF00}/bet [id] [сумма] !{FFFFFF}- вызвать игрока на дуэль костей (принять: /yes)');
    player.outputChatBox('!{FFFF00}/casino !{FFFFFF}- казино: маркер на карте, клавиша E у маркера');
    player.outputChatBox('!{FFFF00}/me, /do, /try, /roll !{FFFFFF}- рп-действия (видно в радиусе 30 м)');
    player.outputChatBox('!{FFFF00}/buy [n] /sell [n] !{FFFFFF}- обмен $ на фишки и обратно (в зоне казино)');
    player.outputChatBox('!{FFFF00}/givemoney [id] [сумма] !{FFFFFF}- админ: выдать/снять деньги');
    player.outputChatBox('!{FFFF00}/givechips [id] [кол-во] !{FFFFFF}- админ: выдать/снять фишки');
});

// /veh [имя] [номер] — заспавнить машину с произвольным номером и посадить игрока за руль
mp.events.addCommand('veh', (player, fullText, name, plate) => {
    if (!hasPerm(player, 'veh')) { noPermMsg(player); return; }
    if (!name) {
        player.outputChatBox('!{FF4444}Использование: /veh [название] [номер]');
        return;
    }

    name = String(name).trim();
    const hash = mp.joaat(name);

    // Переводим угол поворота игрока (heading) в радианы
    const headingRad = (player.heading * Math.PI) / 180;
    const distance = 3; // Расстояние спавна перед игроком (в метрах)

    // Вычисляем точку перед игроком на сервере
    const spawnPos = new mp.Vector3(
        player.position.x - Math.sin(headingRad) * distance,
        player.position.y + Math.cos(headingRad) * distance,
        player.position.z
    );

    const plateText = plate ? plate.toUpperCase() : 'ADMIN';

    try {
        const veh = mp.vehicles.new(hash, spawnPos, {
            numberPlate: plateText,
            heading: player.heading,
            dimension: player.dimension
        });

        if (veh) {
            // Сажаем игрока на водительское сиденье (0) — по API нельзя сразу
            // после создания, нужен таймаут ~200 мс
            setTimeout(() => {
                try { player.putIntoVehicle(veh, 0); } catch (e) { /* ignore */ }
            }, 200);
            player.outputChatBox(`!{44FF44}Заспавнено: ${name} [Номер: ${plateText}] — вы за рулём.`);
            // Проверка: смонтирована ли модель на клиенте (важно для DLC-машин)
            try { player.call('veh:verify', [name, hash]); } catch (e) { /* ignore */ }
        } else {
            player.outputChatBox(`!{FF4444}Не удалось создать машину: ${name}`);
        }
    } catch (e) {
        player.outputChatBox(`!{FF4444}Ошибка создания машины: проверьте правильность имени ${name}`);
        console.error(e);
    }
});

// /livery [номер] — сменить раскраску (ливрею) своей машины; без номера — следующая
mp.events.addCommand('livery', (player, _, argNum) => {
    if (!hasPerm(player, 'livery') && !hasPerm(player, 'veh')) { noPermMsg(player); return; }
    const veh = player.vehicle;
    if (!veh) {
        player.outputChatBox('!{FF4444}Вы не в машине.');
        return;
    }
    if (player.seat !== 0) {
        player.outputChatBox('!{FF4444}Сядьте на место водителя.');
        return;
    }
    let livery;
    if (argNum !== undefined && argNum !== null && String(argNum).trim() !== '') {
        livery = parseInt(argNum, 10);
        if (!Number.isInteger(livery) || livery < 0) {
            player.outputChatBox('!{FF4444}Использование: /livery [номер] (или /livery без номера — следующая раскраска)');
            return;
        }
    } else {
        try {
            const current = typeof veh.getMod === 'function' ? veh.getMod(48) : -1; // 48 = Livery
            livery = (current === -1 ? -1 : current) + 1;
            if (livery > 30) livery = 0;
        } catch (e) {
            livery = 0;
        }
    }
    try {
        veh.livery = livery;
        player.outputChatBox(`!{44FF44}Раскраска установлена: ${livery}${livery === -1 ? ' (стандарт)' : ''}`);
    } catch (e) {
        player.outputChatBox(`!{FF4444}Не удалось установить раскраску ${livery}`);
    }
});

// /color [R] [G] [B] — покрасить свою машину (основной и вторичный цвет)
mp.events.addCommand('color', (player, _, r, g, b) => {
    if (!hasPerm(player, 'color') && !hasPerm(player, 'veh')) { noPermMsg(player); return; }
    const veh = player.vehicle;
    if (!veh) {
        player.outputChatBox('!{FF4444}Вы не в машине.');
        return;
    }
    if (player.seat !== 0) {
        player.outputChatBox('!{FF4444}Сядьте на место водителя.');
        return;
    }
    const rr = parseInt(r, 10), gg = parseInt(g, 10), bb = parseInt(b, 10);
    if (!Number.isInteger(rr) || !Number.isInteger(gg) || !Number.isInteger(bb) ||
        rr < 0 || rr > 255 || gg < 0 || gg > 255 || bb < 0 || bb > 255) {
        player.outputChatBox('!{FF4444}Использование: /color [R] [G] [B] — числа от 0 до 255. Пример: /color 255 0 0');
        return;
    }
    try {
        veh.setColorRGB(rr, gg, bb, rr, gg, bb);
        player.outputChatBox(`!{44FF44}Цвет машины: RGB(${rr}, ${gg}, ${bb})`);
    } catch (e) {
        player.outputChatBox('!{FF4444}Не удалось покрасить машину');
    }
});

// Полный список оружия (имена с вики RAGE:MP). Ключ — часть имени без префикса weapon_
const WEAPON_LIST = {
    dagger: 'Кинжал', bat: 'Бита', bottle: 'Бутылка', crowbar: 'Монтировка', flashlight: 'Фонарик',
    golfclub: 'Клюшка', hammer: 'Молоток', hatchet: 'Топорик', knuckle: 'Кастет', knife: 'Нож',
    machete: 'Мачете', switchblade: 'Выкидной нож', nightstick: 'Дубинка', wrench: 'Разводной ключ',
    battleaxe: 'Боевой топор', poolcue: 'Бильярдный кий', stone_hatchet: 'Каменный топорик',
    candycane: 'Карамельная трость', stunrod: 'Шокер',
    pistol: 'Пистолет', pistol_mk2: 'Пистолет MK II', combatpistol: 'Боевой пистолет',
    appistol: 'AP-пистолет', stungun: 'Электрошокер', pistol50: 'Пистолет .50',
    snspistol: 'SNS-пистолет', snspistol_mk2: 'SNS MK II', heavypistol: 'Тяжёлый пистолет',
    vintagepistol: 'Винтажный пистолет', flaregun: 'Сигнальный пистолет',
    marksmanpistol: 'Пистолет-марксман', revolver: 'Револьвер', revolver_mk2: 'Револьвер MK II',
    doubleaction: 'Револьвер двойного действия', raypistol: 'Атомайзер',
    ceramicpistol: 'Керамический пистолет', navyrevolver: 'Морской револьвер',
    gadgetpistol: 'Перикский пистолет', stungun_mp: 'Электрошокер (MP)', pistolxm3: 'WM 29',
    microsmg: 'Микро-ПП', smg: 'ПП', smg_mk2: 'ПП MK II', assaultsmg: 'Штурмовой ПП',
    combatpdw: 'Боевой ПДП', machinepistol: 'Автоматический пистолет', minismg: 'Мини-ПП',
    raycarbine: 'Адская пушка', tecpistol: 'Тактический ПП',
    pumpshotgun: 'Помповое ружьё', pumpshotgun_mk2: 'Помповое MK II',
    sawnoffshotgun: 'Обрез', assaultshotgun: 'Штурмовой дробовик', bullpupshotgun: 'Бульпап-дробовик',
    heavyshotgun: 'Тяжёлый дробовик', dbshotgun: 'Двустволка', autoshotgun: 'Sweeper',
    combatshotgun: 'Боевой дробовик',
    assaultrifle: 'Автомат', assaultrifle_mk2: 'Автомат MK II', carbinerifle: 'Карабин',
    carbinerifle_mk2: 'Карабин MK II', advancedrifle: 'Продвинутая винтовка',
    specialcarbine: 'Спецкарабин', specialcarbine_mk2: 'Спецкарабин MK II',
    bullpuprifle: 'Бульпап-винтовка', bullpuprifle_mk2: 'Бульпап MK II',
    compactrifle: 'Компактная винтовка', militaryrifle: 'Армейская винтовка',
    heavyrifle: 'Тяжёлая винтовка', tacticalrifle: 'Тактическая винтовка',
    mg: 'Пулемёт', combatmg: 'Боевой пулемёт', combatmg_mk2: 'Боевой пулемёт MK II',
    gusenberg: 'Gusenberg',
    sniperrifle: 'Снайперская винтовка', heavysniper: 'Тяжёлая снайперская',
    heavysniper_mk2: 'Тяжёлая снайперская MK II', marksmanrifle: 'Марксман-винтовка',
    marksmanrifle_mk2: 'Марксман MK II', precisionrifle: 'Точная винтовка', musket: 'Мушкет',
    rpg: 'РПГ', grenadelauncher: 'Гранатомёт', grenadelauncher_smoke: 'Гранатомёт (дым)',
    minigun: 'Миниган', firework: 'Фейерверк', railgun: 'Рельсотрон',
    hominglauncher: 'Самонаводящийся', compactlauncher: 'Компактный гранатомёт',
    rayminigun: 'Widowmaker', emplauncher: 'ЭМП-пусковая', railgunxm3: 'Рельсотрон XM3',
    grenade: 'Граната', bzgas: 'Газ BZ', molotov: 'Коктейль Молотова', stickybomb: 'Липкая бомба',
    proxmine: 'Мины', snowball: 'Снежки', pipebomb: 'Труба-бомба', ball: 'Бейсбольный мяч',
    smokegrenade: 'Слезоточивый газ', flare: 'Сигнальная ракета', acidpackage: 'Кислотный пакет',
    petrolcan: 'Канистра', fireextinguisher: 'Огнетушитель', hazardcan: 'Канистра (опасная)',
    fertilizercan: 'Канистра (удобрение)', parachute: 'Парашют'
};

// /gun [название] — выдача оружия.
// Мост giveWeapon принимает int32: unsigned-хэш (> 0x7FFFFFFF) может быть отвергнут.
// Поэтому пробуем по порядку: 1) строковое имя (точнее всего), 2) знаковый joaat, 3) unsigned.
// /gun [название] — выдача оружия.
mp.events.addCommand('gun', (player, _, weaponName) => {
    if (!hasPerm(player, 'gun')) { noPermMsg(player); return; }
    if (!weaponName) {
        const names = Object.keys(WEAPON_LIST);
        player.outputChatBox('!{FFFF00}/gun [название] — доступное оружие:');
        for (let i = 0; i < names.length; i += 5) {
            player.outputChatBox('!{FFFFFF}' + names.slice(i, i + 5).map((n) => `${n} (${WEAPON_LIST[n]})`).join('   '));
        }
        return;
    }
    let name = weaponName.toLowerCase().trim();
    if (name.startsWith('weapon_')) name = name.slice(7);
    if (name.startsWith('gadget_')) name = name.slice(7);
    if (!WEAPON_LIST[name]) {
        player.outputChatBox(`!{FF4444}Оружие не найдено: ${name}. Введите /gun — список всех названий.`);
        return;
    }

    const fullName = name === 'parachute' ? 'gadget_parachute' : 'weapon_' + name;
    const hash = mp.joaat(fullName); // Без >>> 0 ! RAGE:MP ждет signed int32

    let giveErr = null;
    try {
        // В RAGE:MP можно передавать как строковое имя, так и знаковый joaat-хэш
        player.giveWeapon(fullName, 999, true); 
    } catch (e) {
        giveErr = 'throw: ' + String(e);
    }
    
    player.call('admin:giveWeaponName', [fullName, 999]);

    // Запоминаем выданное оружие
    if (!Array.isArray(player._ownedWeapons)) player._ownedWeapons = [];
    const idx = player._ownedWeapons.findIndex((w) => w[0] === hash);
    if (idx >= 0) player._ownedWeapons[idx] = [hash, 999];
    else player._ownedWeapons.push([hash, 999]);

    player.outputChatBox(`!{44FF44}Выдано оружие: ${WEAPON_LIST[name]} (${fullName})`);
    if (giveErr) console.log(`[gun] ${player.socialClub} ${fullName}: ${giveErr}`);
});

// Подтверждение от клиента: появилось ли оружие фактически в руках игрока
mp.events.add('gun:confirm', (player, weaponName, present, dumpJson) => {
    const ok = Number(present) === 1;
    try {
        const p = player.position;
        const inJail = jailMap.has(player);
        const dx = p ? p.x - JAIL_EXIT_POS.x : 0;
        const dy = p ? p.y - JAIL_EXIT_POS.y : 0;
        const dExit = p ? Math.round(Math.hypot(dx, dy)) : -1;
        console.log(`[gun:confirm] ${player.socialClub} ${weaponName} в_руках=${ok ? 'ДА' : 'НЕТ'} тюрьма=${inJail ? 'ДА' : 'НЕТ'} до_выхода=${dExit}м данн=${String(dumpJson || '')}`);
        player.outputChatBox(ok
            ? `!{44FF44}Оружие подтверждено клиентом (${weaponName}).`
            : `!{FF4444}Оружие ${weaponName} НЕ появилось у игрока — проверьте версию игры/DLC.`);
    } catch (e) { /* ignore */ }
});

// /kill [id] — убить игрока по ID
mp.events.addCommand('kill', (player, _, argId) => {
    if (!hasPerm(player, 'kill')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /kill [id] — игрок с таким ID не найден');
        return;
    }

    target.health = 0;
    target.outputChatBox(`!{FF4444}Вы убиты администратором!`);
    player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} убит!`);
});

// /kick [id] [причина] — кикнуть игрока по ID
mp.events.addCommand('kick', (player, fullText, argId, ...reasonArgs) => {
    if (!hasPerm(player, 'kick')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /kick [id] [причина] — игрок с таким ID не найден');
        return;
    }
    const reason = (reasonArgs || []).join(' ').trim() || 'Кик администратором';
    mp.players.forEach((p) => {
        if (p !== player) p.outputChatBox(`!{FF9900}/kick: администратор ${player.name} кикнул игрока ${target.citizenId}${reason ? ` (${reason})` : ''}`);
    });
    console.log(`[kick] ${player.name} кикнул ${target.name} (id ${target.citizenId})${reason ? `: ${reason}` : ''}`);
    try { target.kick(reason); } catch (e) { /* ignore */ }
});

// /freeze [id] — заморозить/разморозить игрока по ID
mp.events.addCommand('freeze', (player, _, argId) => {
    if (!hasPerm(player, 'freeze')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /freeze [id] — игрок с таким ID не найден');
        return;
    }

    target.isFrozen = !target.isFrozen;
    target.call('admin:freeze', [target.isFrozen]);
    if (target.isFrozen) {
        target.outputChatBox('!{FF4444}Вы заморожены администратором!');
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} заморожен!`);
    } else {
        target.outputChatBox('!{44FF44}Вы разморожены администратором!');
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} разморожен!`);
    }
});

// /invis — невидимость (убираем у себя коллизию и плашку с именем)
mp.events.addCommand('invis', (player) => {
    if (!hasPerm(player, 'invis')) { noPermMsg(player); return; }
    player.isInvis = !player.isInvis;
    player.alpha = player.isInvis ? 0 : 255;
    try { player.setVariable('invis', player.isInvis); } catch (e) { /* ignore */ }
    try { player.call('admin:invis', [player.isInvis]); } catch (e) { /* ignore */ }
    player.outputChatBox(player.isInvis ? '!{44FF44}Невидимость ВКЛ' : '!{FF4444}Невидимость ВЫКЛ');
});

// /copypos — скопировать позицию в файл positions.txt и показать в чат
mp.events.addCommand('copypos', (player) => {
    if (!hasPerm(player, 'copypos')) { noPermMsg(player); return; }
    try {
        const p = player.position;
        const h = player.heading;
        const x = p.x.toFixed(3);
        const y = p.y.toFixed(3);
        const z = p.z.toFixed(3);
        const hd = h.toFixed(2);
        const line = `name: ${player.name}  id: ${player.citizenId}  pos: [${x}, ${y}, ${z}]  heading: ${hd}`;
        fs.appendFileSync(POSITIONS_FILE, line + '\n');
        player.outputChatBox(`!{44FF44}Позиция скопирована: X=${x} Y=${y} Z=${z} (heading=${hd})`);
        player.outputChatBox(`!{44FF44}Сохранено в positions.txt`);
    } catch (e) {
        player.outputChatBox('!{FF4444}Ошибка сохранения позиции');
    }
});

// /spec [id] — закрепить камеру за игроком (наблюдение).
// Позицию цели каждые 0.5с шлёт СЕРВЕР (spec:tick) — камера работает и для
// целей вне стрим-зоны клиента.
const specRequests = new Map(); // requester.citizenId -> { target, timer }

const specStop = (player) => {
    const rec = specRequests.get(player.citizenId);
    if (!rec) return;
    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
    specRequests.delete(player.citizenId);
    try { player.call('spec:stop', []); } catch (e) { /* ignore */ }
};

mp.events.addCommand('spec', (player, _, argId) => {
    if (!hasPerm(player, 'spec')) { noPermMsg(player); return; }
    if (argId && argId.toLowerCase() === 'off') {
        specStop(player);
        player.outputChatBox('!{FF4444}Наблюдение выключено');
        return;
    }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target || target === player) {
        player.outputChatBox('!{FF4444}Использование: /spec [id] — игрок с таким ID не найден');
        return;
    }
    specStop(player); // новый спектатор заменяет старый
    const timer = setInterval(() => {
        try {
            if (!target || !target.position) { specStop(player); return; }
            player.call('spec:tick', [target.position.x, target.position.y, target.position.z]);
        } catch (e) { specStop(player); }
    }, 500);
    specRequests.set(player.citizenId, { target, timer });
    player.call('spec:start', [target.id]);
    player.outputChatBox(`!{44FF44}Наблюдаете за игроком #${target.citizenId} (${target.name})`);
});

// /unspec — отключить наблюдение
mp.events.addCommand('unspec', (player) => {
    if (!hasPerm(player, 'spec')) { noPermMsg(player); return; }
    specStop(player);
    player.outputChatBox('!{FF4444}Наблюдение выключено');
});

// /mtp — телепорт к метке на карте. Сама команда обрабатывается КЛИЕНТОМ
// (координаты метки знает только клиент); сервер выполняет телепорт.
// Клиент шлёт точку ВЫШЕ цели, гравитация уронит на поверхность — это надёжнее,
// чем точное прижатие к земле (иначе слегка «уходим под карту»).
mp.events.add('mtp:teleport', (player, x, y, z) => {
    if (!hasPerm(player, 'mtp') && !hasPerm(player, 'tp')) { noPermMsg(player); return; }
    const px = parseFloat(x), py = parseFloat(y), pz = parseFloat(z);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    if (Math.abs(px) > 20000 || Math.abs(py) > 20000) return;
    const pos = new mp.Vector3(px, py, pz);
    try {
        // Сидим в машине — телепортируем её, затем пересаживаемся (после приземления)
        const veh = player.vehicle;
        if (veh) {
            veh.position = pos;
            const seat = (typeof player.seat === 'number') ? player.seat : 0;
            setTimeout(() => { try { player.putIntoVehicle(veh, seat); } catch (e) { /* ignore */ } }, 700);
            player.outputChatBox('!{44FF44}Телепорт к метке (вместе с машиной).');
            return;
        }
        // В машине не сидим: если рядом стоит машина (до 8 м) — берём её с собой
        // и садимся за руль на новом месте (человек в своей машине телепортируется вместе).
        const near = getNearestVehicle(player);
        if (near) {
            near.position = pos;
            player.position = pos;
            setTimeout(() => { try { player.putIntoVehicle(near, 0); } catch (e) { /* ignore */ } }, 700);
            player.outputChatBox('!{44FF44}Телепорт к метке (вместе с ближайшей машиной).');
            return;
        }
        player.position = pos;
        player.outputChatBox('!{44FF44}Телепорт к метке.');
    } catch (e) {
        player.outputChatBox('!{FF4444}Не удалось телепортироваться к метке');
    }
});

// /fly и /spec автоматически включают невидимость на сервере (видно это всем игрокам).
// Запоминаем, был ли зритель невидим до старта — чтобы вернуть прежнее состояние.
mp.events.add('admin:setInvis', (player, state) => {
    if (!hasPerm(player, 'invis') && !hasPerm(player, 'noclip') && !hasPerm(player, 'spec')) { noPermMsg(player); return; }
    if (state) {
        player._wasInvisBefore = player.isInvis === true;
        player.isInvis = true;
        player.alpha = 0;
    } else {
        if (player._wasInvisBefore) {
            player.isInvis = true;
            player.alpha = 0;
        } else {
            player.isInvis = false;
            player.alpha = 255;
        }
        player._wasInvisBefore = false;
    }
    try { player.setVariable('invis', player.isInvis); } catch (e) { /* ignore */ }
    // Убрать у клиента коллизию и плашку с именем
    try { player.call('admin:invis', [player.isInvis]); } catch (e) { /* ignore */ }
});

// ---------- Скины оригинальной GTA V (персонажи и животные) ----------
const SKIN_MODELS = [
    ['mp_m_freemode_01', 'Стандартный мужской'],
    ['mp_f_freemode_01', 'Стандартный женский'],
    // Персонажи
    ['ig_michael', 'Майкл'],
    ['ig_franklin', 'Франклин'],
    ['ig_trevorphilips', 'Тревор'],
    ['ig_lamardavis', 'Ламар'],
    ['u_m_m_lestercrest', 'Лестер'],
    ['cs_brad', 'Брэд'],
    ['cs_tracydisanto', 'Трейси'],
    ['cs_mrs_thornhill', 'Миссис Торнхилл'],
    ['cs_bankman', 'Банкир'],
    ['a_m_m_business_01', 'Бизнесмен'],
    ['a_f_m_business_02', 'Бизнес-леди'],
    ['a_m_m_eastsa_01', 'Мужик в худи'],
    ['a_m_m_country_01', 'Деревенский мужик'],
    ['a_m_m_latino_01', 'Латинос'],
    ['a_m_y_stbla_02', 'Уличный парень'],
    ['s_m_y_cop_01', 'Полицейский'],
    ['s_f_y_cop_01', 'Полицейская'],
    ['s_m_m_paramedic_01', 'Медик'],
    ['s_m_m_firefighter_01', 'Пожарный'],
    ['s_m_m_doctor_01', 'Врач'],
    ['u_m_m_prolsec_01', 'Охранник'],
    ['g_m_m_chiboss_01', 'Триадский босс'],
    ['g_f_y_families_01', 'Девушка из Families'],
    ['u_m_y_abner', 'Эбнер (культист)'],
    ['ig_rashcosvki', 'Заключённый (тюрьма)'],
    // Животные
    ['a_c_chop', 'Чоп (собака)'],
    ['a_c_pug', 'Мопс'],
    ['a_c_rottweiler', 'Ротвейлер'],
    ['a_c_shepherd', 'Овчарка'],
    ['a_c_retriever', 'Ретривер'],
    ['a_c_husky', 'Хаски'],
    ['a_c_poodle', 'Пудель'],
    ['a_c_cat_01', 'Кошка'],
    ['a_c_chimp', 'Шимпанзе'],
    ['a_c_cow', 'Корова'],
    ['a_c_pig', 'Свинья'],
    ['a_c_hen', 'Курица'],
    ['a_c_chickenhawk', 'Ястреб'],
    ['a_c_horse', 'Лошадь'],
    ['a_c_deer', 'Олень'],
    ['a_c_boar', 'Кабан'],
    ['a_c_coyote', 'Койот'],
    ['a_c_mtlion', 'Горный лев'],
    ['a_c_rabbit_01', 'Кролик'],
    ['a_c_rat', 'Крыса'],
    ['a_c_rhesus', 'Макака-резус'],
    ['a_c_sharkhammer', 'Акула-молот'],
    ['a_c_sharktiger', 'Тигровая акула'],
    ['a_c_dolphin', 'Дельфин'],
    ['a_c_stingray', 'Скат'],
    ['a_c_fish', 'Рыба']
];

// /skin [id] или [название модели] [id игрока] — сменить модель педа (персонажи/животные из GTA V).
// Без id игрока — себе. /skin reset — вернуть свою внешность.
mp.events.addCommand('skin', (player, _, arg, argId) => {
    if (!hasPerm(player, 'skin')) { noPermMsg(player); return; }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (argId && !target) {
        player.outputChatBox('!{FF4444}Использование: /skin [id/название] [id игрока] — игрок не найден');
        return;
    }

    const a = String(arg || '').trim().toLowerCase();
    if (!a) {
        player.outputChatBox('!{FFFF00}/skin [id] !{FFFFFF}- скин по номеру, /skin reset - вернуть свой внешность.');
        player.outputChatBox(`!{FFFF00}Скины: 0-${SKIN_MODELS.length - 1} !{FFFFFF}(${SKIN_MODELS.slice(2).length} персонажей/животных), или введите название модели напрямую.`);
        return;
    }
    if (a === 'reset') {
        target.customSkinModel = null;
        const c = target.char;
        try {
            if (c) {
                const model = c.gender === 1 ? 'mp_f_freemode_01' : 'mp_m_freemode_01';
                target.model = mp.joaat(model);
                target.call('char:applyAppearance', [JSON.stringify({ gender: c.gender, appearance: c.appearance })]);
            } else {
                target.model = mp.joaat('mp_m_freemode_01');
            }
            if (target === player) player.outputChatBox('!{44FF44}Скин сброшен — внешность персонажа восстановлена.');
            else player.outputChatBox(`!{44FF44}Скин игрока ${target.citizenId} сброшен.`);
        } catch (e) {
            player.outputChatBox('!{FF4444}Не удалось сбросить скин: ' + e);
        }
        return;
    }

    let model = '';
    let label = '';
    const idx = parseInt(a, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < SKIN_MODELS.length) {
        model = SKIN_MODELS[idx][0];
        label = SKIN_MODELS[idx][1];
    } else {
        model = a;
        label = a;
    }
    const hash = mp.joaat(model);
    try {
        target.customSkinModel = hash; // не перезаписывается при следующем респавне
        target.model = hash;
        if (target === player) {
            player.outputChatBox(`!{44FF44}Скин установлен: ${label}`);
        } else {
            target.outputChatBox(`!{44FF44}Администратор сменил ваш скин: ${label}`);
            player.outputChatBox(`!{44FF44}Игроку ${target.citizenId} установлен скин: ${label}`);
        }
    } catch (e) {
        player.outputChatBox('!{FF4444}Не удалось сменить скин: ' + e);
    }
});

// ---------- Наручники / ведение / /put — вынесены в отдельный модуль cuff.js ----------
// Подключение в конце этого файла: require('./cuff.js')({ getPlayerById, hasPerm, noPermMsg });

// /vfly — полёт на машине (машина летит за камерой, как ноклип)
mp.events.addCommand('vfly', (player) => {
    if (jailMap.has(player)) {
        player.outputChatBox('!{FF4444}В тюрьме полёт запрещён!');
        return;
    }
    if (player.cuffed) {
        player.outputChatBox('!{FF4444}В наручниках полёт недоступен!');
        return;
    }
    if (!hasPerm(player, 'vfly') && !hasPerm(player, 'noclip')) { noPermMsg(player); return; }
    try { player.call('admin:vflyToggle'); } catch (e) { /* ignore */ }
});

// Респавн на R
mp.events.add('admin:respawnSelf', (player) => {
    // В тюрьме клавиша R разрешена (возрождение внутри Деморгана)
    if (!hasPerm(player, 'respawn') && !jailMap.has(player)) { noPermMsg(player); return; }
    const pos = player.position;
    player.spawn(pos);
    applySkinAfterRespawn(player);
    restoreSavedWeapons(player);
    player.health = 100;
    player.armour = 100;
    player.outputChatBox('!{44FF44}Вы успешно возродились!');
});

// При принудительном респавне (/rescue, R) игра пересоздаёт педа с дефолтной
// моделью, а «та же самая» серверная модель повторно не применяется — поэтому
// скин «пропадает». Дополнительно переустанавливаем модель с задержкой
// (клиент может сбросить модель чуть позже спавна) и переприменяем внешность.
const applySkinAfterRespawn = (player) => {
    try {
        if (player.customSkinModel) {
            player.model = player.customSkinModel;
            setTimeout(() => { try { if (player.customSkinModel) player.model = player.customSkinModel; } catch (e) { /* ignore */ } }, 500);
            setTimeout(() => { try { if (player.customSkinModel) player.model = player.customSkinModel; } catch (e) { /* ignore */ } }, 1800);
        } else if (player.char) {
            const c = player.char;
            const base = c.gender === 1 ? 'mp_f_freemode_01' : 'mp_m_freemode_01';
            player.model = mp.joaat(base);
            const app = JSON.stringify({ gender: c.gender, appearance: c.appearance });
            try { player.call('char:applyAppearance', [app]); } catch (e) { /* ignore */ }
            setTimeout(() => {
                try {
                    player.model = mp.joaat(base);
                    player.call('char:applyAppearance', [app]);
                } catch (e) { /* ignore */ }
            }, 1800);
        } else {
            player.model = mp.joaat('mp_m_freemode_01');
        }
    } catch (e) { /* ignore */ }
};

// Вернуть оружие, сохранённое при смерти (см. playerDeath в admin/cuff.js).
// Если снапшот пуст/недоступен — возвращаем выданное через /gun за сессию.
// Порядок попыток: строковое имя -> знаковый int32 -> unsigned (как в /gun).
const restoreSavedWeapons = (player) => {
    let arr = player._savedWeapons;
    delete player._savedWeapons;
    if (!Array.isArray(arr) || arr.length === 0) arr = player._ownedWeapons || null;
    if (!Array.isArray(arr) || arr.length === 0) return;
    try {
        arr.forEach((w) => {
            const entry = Array.isArray(w) ? { name: null, hash: w[0], ammo: w[1] } : w;
            const ammo = entry.ammo || 999;
            // Три пути безопасно пробуем подряд: любой bitcast даёт тот же хэш оружия
            if (entry.name) {
                try { player.giveWeapon(entry.name, ammo, true); } catch (e) { /* ignore */ }
            }
            if (entry.hash) {
                try { player.giveWeapon(entry.hash, ammo, true); } catch (e) { /* ignore */ }
                try { player.giveWeapon(entry.hash >>> 0, ammo, true); } catch (e2) { /* ignore */ }
            }
        });
    } catch (e) { /* ignore */ }
};

// Ближайшая машина к игроку (в радиусе 8 м)
const getNearestVehicle = (player) => {
    let nearest = null;
    let nearestDist = 8;
    mp.vehicles.forEachInRange(player.position, 8, (veh) => {
        const d = veh.dist(player.position);
        if (d < nearestDist) {
            nearestDist = d;
            nearest = veh;
        }
    });
    return nearest;
};

// Поиск машины по транспортному ID (из packages/freeroam)
const getVehicleById = (id) => {
    if (!Number.isInteger(id)) return null;
    return mp.vehicles.toArray().find((v) => v.vehicleId === id);
};

// /delveh [id] — удалить машину по ID (или ближайшую, если ID не указан)
mp.events.addCommand('delveh', (player, _, argId) => {
    if (!hasPerm(player, 'delveh')) { noPermMsg(player); return; }
    let veh;
    if (argId) {
        veh = getVehicleById(parseInt(argId, 10));
        if (!veh) {
            player.outputChatBox('!{FF4444}Использование: /delveh [id] — машина с таким ID не найдена');
            return;
        }
    } else {
        veh = getNearestVehicle(player);
        if (!veh) {
            player.outputChatBox('!{FF4444}Использование: /delveh [id] — рядом нет машин');
            return;
        }
    }

    const vid = veh.vehicleId;
    veh.destroy();
    player.outputChatBox(`!{44FF44}Машина ${vid} удалена!`);
});

// /excar [id] — взорвать машину по ID (или ближайшую, если ID не указан)
mp.events.addCommand('excar', (player, _, argId) => {
    if (!hasPerm(player, 'excar')) { noPermMsg(player); return; }
    let veh;
    if (argId) {
        veh = getVehicleById(parseInt(argId, 10));
        if (!veh) {
            player.outputChatBox('!{FF4444}Использование: /excar [id] — машина с таким ID не найдена');
            return;
        }
    } else {
        veh = getNearestVehicle(player);
        if (!veh) {
            player.outputChatBox('!{FF4444}Использование: /excar [id] — рядом нет машин');
            return;
        }
    }

    const vid = veh.vehicleId;
    const pos = veh.position;
    veh.health = 0;
    mp.players.forEach((p) => p.call('admin:explodeVehicle', [veh.id, pos.x, pos.y, pos.z]));
    player.outputChatBox(`!{FF4444}Машина ${vid} взорвана!`);
});

// /fuel [литры] [id] — установить топливо машины по ID (или ближайшей, если ID не указан)
mp.events.addCommand('fuel', (player, _, liters, argId) => {
    if (!hasPerm(player, 'fuel')) { noPermMsg(player); return; }
    const amount = parseFloat(liters);
    if (isNaN(amount) || amount < 0) {
        player.outputChatBox('!{FF4444}Использование: /fuel [литры] [id] — укажите количество топлива');
        return;
    }

    let veh;
    if (argId) {
        veh = getVehicleById(parseInt(argId, 10));
        if (!veh) {
            player.outputChatBox('!{FF4444}Использование: /fuel [литры] [id] — машина с таким ID не найдена');
            return;
        }
    } else {
        veh = getNearestVehicle(player);
        if (!veh) {
            player.outputChatBox('!{FF4444}Использование: /fuel [литры] [id] — рядом нет машин');
            return;
        }
    }

    veh.fuel = Math.min(100, amount);
    veh.setVariable('fuel', veh.fuel);
    player.outputChatBox(`!{44FF44}Машина ${veh.vehicleId}: топливо установлено на ${veh.fuel} л`);
});

// /cid [id игрока] — показать ID машины, в которой сидит игрок.
// Без id — ID ближайшей машины.
mp.events.addCommand('cid', (player, _, argId) => {
    if (!hasPerm(player, 'cid') && !hasPerm(player, 'veh') && !hasPerm(player, 'delveh')) { noPermMsg(player); return; }
    let target = player;
    if (argId) {
        target = getPlayerById(parseInt(argId, 10));
        if (!target) {
            player.outputChatBox('!{FF4444}Использование: /cid [id игрока] — игрок с таким ID не найден');
            return;
        }
    }
    const veh = target.vehicle;
    if (veh) {
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} сидит в машине: ID машины = ${veh.vehicleId}`);
        return;
    }
    if (target !== player) {
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} не находится в машине.`);
        return;
    }
    const nearest = getNearestVehicle(player);
    if (!nearest) {
        player.outputChatBox('!{FF4444}Вы не в машине, и рядом машин нет.');
        return;
    }
    player.outputChatBox(`!{44FF44}Ближайшая машина: ID = ${nearest.vehicleId}`);
});

// /inc [vid] [место] — посадить себя в машину по ID на указанное место (0 = водитель).
mp.events.addCommand('inc', (player, _, argVid, argSeat) => {
    if (!hasPerm(player, 'inc') && !hasPerm(player, 'veh')) { noPermMsg(player); return; }
    const vid = parseInt(argVid, 10);
    const seat = parseInt(argSeat, 10);
    if (!Number.isInteger(vid) || !Number.isInteger(seat) || seat < 0) {
        player.outputChatBox('!{FFFF00}/inc [vid] [место] !{FFFFFF}- ID машины и номер места (0 = водитель).');
        player.outputChatBox('!{FFFF00}Чтобы узнать ID машины — !{FFFFFF}/cid');
        return;
    }
    const veh = getVehicleById(vid);
    if (!veh) {
        player.outputChatBox(`!{FF4444}Машина с ID ${vid} не найдена.`);
        return;
    }
    setTimeout(() => {
        try { player.putIntoVehicle(veh, seat); } catch (e) { /* ignore */ }
    }, 100);
    player.outputChatBox(`!{44FF44}Сажаем вас в машину ${vid} на место ${seat}...`);
});

// /esp — переключить отображение игроков и машин
mp.events.addCommand('esp', (player) => {
    if (!hasPerm(player, 'esp')) { noPermMsg(player); return; }
    player.call('admin:toggleEsp');
    player.outputChatBox('!{44FF44}ESP переключён!');
});

// /tp [id] — телепортироваться к игроку по ID
mp.events.addCommand('tp', (player, _, argId) => {
    if (!hasPerm(player, 'tp')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /tp [id] — игрок с таким ID не найден');
        return;
    }

    const pos = target.position;
    // Если игрок в машине — телепортируем и её (вместе с водителем)
    if (player.vehicle) player.vehicle.position = pos;
    else player.position = pos;
    player.outputChatBox(`!{44FF44}Вы телепортированы к игроку ${target.citizenId}!`);
});

// /gh [id] — телепортировать игрока по ID к себе
mp.events.addCommand('gh', (player, _, argId) => {
    if (!hasPerm(player, 'gh')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /gh [id] — игрок с таким ID не найден');
        return;
    }

    const pos = player.position;
    // Если цель в машине — телепортируем и её (вместе с пассажиром)
    if (target.vehicle) target.vehicle.position = pos;
    else target.position = pos;
    target.outputChatBox(`!{44FF44}Администратор телепортировал вас к себе!`);
    player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} телепортирован к вам!`);
});

// /rescue [id] — воскресить и исцелить себя или игрока по ID
mp.events.addCommand('rescue', (player, _, argId) => {
    if (!hasPerm(player, 'rescue')) { noPermMsg(player); return; }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (argId && !target) {
        player.outputChatBox('!{FF4444}Использование: /rescue [id] — игрок с таким ID не найден');
        return;
    }

    const pos = target.position;
    target.spawn(pos);
    applySkinAfterRespawn(target);
    restoreSavedWeapons(target);
    target.health = 100;
    target.armour = 100;

    if (target === player) {
        player.outputChatBox('!{44FF44}Вы успешно воскрешены и исцелены!');
    } else {
        target.outputChatBox('!{44FF44}Вы воскрешены и исцелены администратором!');
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} воскрешён и исцелён!`);
    }
});

// /hp [количество] [id] — установить здоровье (себе или игроку по ID).
// Лимит: гл. админ может себе выдать до 1000 HP, во всех остальных случаях — до 100.
mp.events.addCommand('hp', (player, _, argAmount, argId) => {
    if (!hasPerm(player, 'hp')) { noPermMsg(player); return; }
    let amount = parseInt(argAmount, 10);
    if (isNaN(amount) || amount < 0) {
        player.outputChatBox('!{FF4444}Использование: /hp [количество] [id]');
        return;
    }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (argId && !target) {
        player.outputChatBox('!{FF4444}Использование: /hp [количество] [id] — игрок с таким ID не найден');
        return;
    }
    const max = (target === player && player.citizenId === HEAD_ADMIN_ID) ? 1000 : 100;
    amount = Math.min(amount, max);
    if (target.health <= 0 && amount > 0) {
        // Мёртвого нужно сначала возродить, иначе здоровье не установится
        try { target.spawn(target.position); } catch (e) { /* ignore */ }
        applySkinAfterRespawn(target);
        restoreSavedWeapons(target);
    }
    target.health = amount;
    if (target === player) {
        player.outputChatBox(`!{44FF44}Здоровье установлено: ${amount}`);
    } else {
        target.outputChatBox(`!{44FF44}Администратор установил вам здоровье: ${amount}`);
        player.outputChatBox(`!{44FF44}Игроку ${target.citizenId} установлено здоровье: ${amount}`);
    }
});

// /ar [количество] [id] — установить броню (себе или игроку по ID). Максимум в GTA — 100.
mp.events.addCommand('ar', (player, _, argAmount, argId) => {
    if (!hasPerm(player, 'ar')) { noPermMsg(player); return; }
    let amount = parseInt(argAmount, 10);
    if (isNaN(amount) || amount < 0) {
        player.outputChatBox('!{FF4444}Использование: /ar [количество] [id]');
        return;
    }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (argId && !target) {
        player.outputChatBox('!{FF4444}Использование: /ar [количество] [id] — игрок с таким ID не найден');
        return;
    }
    amount = Math.min(amount, 100);
    target.armour = amount;
    if (target === player) {
        player.outputChatBox(`!{44FF44}Броня установлена: ${amount}`);
    } else {
        target.outputChatBox(`!{44FF44}Администратор установил вам броню: ${amount}`);
        player.outputChatBox(`!{44FF44}Игроку ${target.citizenId} установлена броня: ${amount}`);
    }
});

// /traffic [0-100] — NPC-трафик и пешеходы (гл. админ), плотность в процентах.
// Спавним НА СЕРВЕРЕ (mp.peds/mp.vehicles) — такие сущности стримятся ВСЕМ игрокам,
// а не только админу (клиентский mp.peds/mp.vehicles локальны). Движение педов/машин
// навешивает сам клиент в entityStreamIn (TASK_WANDER_IN_AREA / TASK_VEHICLE_DRIVE_WANDER).
// Пока плотность > 0, трафик живёт ВСЕГДА и следует за админом: сущности удаляются
// только если сломались или админ уехал от них дальше 350 м.
// /trafic — старый псевдоним.
const TRAFFIC_CAR_MODELS = ['adder', 'buffalo', 'blista', 'felon', 'oracle', 'sultan', 'sentinel', 'surano', 'kuruma', 'comet2'];
const TRAFFIC_PED_MODELS = ['a_m_y_hipster_01', 'a_m_m_skater_01', 'a_f_m_fat_old_01', 'a_m_y_stwhi_01', 'a_m_m_bevhills_02', 'a_f_y_business_02', 'a_m_y_beach_01'];

const trafficData = { density: 0, owner: null, timer: null };
const trafficSpawned = new Set(); 

const trafficDestroy = (e) => { 
    try { if (e && typeof e.destroy === 'function') e.destroy(); } catch (err) {} 
};

const trafficCleanupAll = () => {
    trafficSpawned.forEach(trafficDestroy);
    trafficSpawned.clear();
};

const isTrafficAlive = (e) => {
    if (!e) return false;
    try {
        // Проверяем через пулы (методы .exists в этой сборке ненадёжны)
        if (e.type === 'ped') return mp.peds.toArray().indexOf(e) !== -1;
        if (e.type === 'vehicle') return mp.vehicles.toArray().indexOf(e) !== -1;
    } catch (err) {}
    return false;
};

// Спавн пешехода
const trafficSpawnPed = (pos, dim) => {
    const model = TRAFFIC_PED_MODELS[Math.floor(Math.random() * TRAFFIC_PED_MODELS.length)];
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 45; // Спавним ближе (15-60 м)
    const p = new mp.Vector3(pos.x + Math.cos(a) * r, pos.y + Math.sin(a) * r, pos.z);
    
    try {
        const ped = mp.peds.new(mp.joaat(model), p, { heading: Math.random() * 360, dimension: dim });
        ped.setVariable('trafficType', 'ped'); // Передаём тип на клиент
        trafficSpawned.add(ped);
    } catch (e) {}
};

// Спавн машины с водителем
const trafficSpawnVehicle = (pos, dim) => {
    const model = TRAFFIC_CAR_MODELS[Math.floor(Math.random() * TRAFFIC_CAR_MODELS.length)];
    const a = Math.random() * Math.PI * 2;
    const r = 35 + Math.random() * 55; // Спавним ближе к игроку (35-90 м)
    const p = new mp.Vector3(pos.x + Math.cos(a) * r, pos.y + Math.sin(a) * r, pos.z);

    try {
        const veh = mp.vehicles.new(mp.joaat(model), p, { heading: Math.random() * 360, dimension: dim });
        veh.engine = true;
        trafficSpawned.add(veh);

        const driver = mp.peds.new(mp.joaat('a_m_y_hipster_01'), p, { heading: 0, dimension: dim });
        
        // Синхронизируем связь водителя и авто с клиентом
        driver.setVariable('trafficType', 'driver');
        driver.setVariable('trafficVehId', veh.id); 

        trafficSpawned.add(driver);

        // Садим водителя в авто С ЗАДЕРЖКОЙ — сразу после создания не работает.
        // Без exists-проверок: некоторые методы exists в этой сборке отсутствуют
        // и просто обрушат колбэк. Если сущность уже удалена — putIntoVehicle упадёт.
        setTimeout(() => {
            try { veh.engine = true; } catch (e) {}
            try { driver.putIntoVehicle(veh, 0); } catch (e) {}
        }, 250);
    } catch (e) {}
};

const trafficTick = () => {
    const t = trafficData;
    if (t.density <= 0 || !t.owner || !mp.players.exists(t.owner)) return;

    // Очистка: сломавшиеся сущности либо те, что дальше 250 м от ВСЕХ игроков
    // (их никто не видит — пересоздадим возле активных игроков).
    const toRemove = [];
    trafficSpawned.forEach((e) => {
        try {
            if (!isTrafficAlive(e)) { toRemove.push(e); return; }
            const ep = e.position;
            if (!ep) { toRemove.push(e); return; }
            let nearAnyone = false;
            mp.players.forEach((p) => {
                if (!p || !p.position) return;
                const dx = ep.x - p.position.x, dy = ep.y - p.position.y;
                if (dx * dx + dy * dy < 250 * 250) nearAnyone = true;
            });
            if (!nearAnyone) toRemove.push(e);
        } catch (err) { toRemove.push(e); }
    });
    toRemove.forEach((e) => { trafficSpawned.delete(e); trafficDestroy(e); });

    // Поддержание трафика: возле КАЖДОГО игрока своя порция машин и пешеходов,
    // чтобы трафик был не только у админа, но и у его друзей/прохожих.
    mp.players.forEach((p) => {
        try {
            if (!p || !p.position) return;
            const pos = p.position;
            const dim = p.dimension;

            let peds = 0, vehs = 0;
            trafficSpawned.forEach((e) => {
                if (!e.position) return;
                const dx = e.position.x - pos.x, dy = e.position.y - pos.y;
                if (dx * dx + dy * dy > 70 * 70) return; // считаем только близких к этому игроку
                if (e.type === 'ped' && e.getVariable && e.getVariable('trafficType') === 'ped') peds++;
                else if (e.type === 'vehicle') vehs++;
            });

            const needVehs = Math.round(8 * t.density / 100) - vehs;
            for (let i = 0; i < needVehs; i++) trafficSpawnVehicle(pos, dim);

            const needPeds = Math.round(5 * t.density / 100) - peds;
            for (let i = 0; i < needPeds; i++) trafficSpawnPed(pos, dim);
        } catch (err) { /* ignore */ }
    });
};

const setTraffic = (player, argDensity, def) => {
    if (player.citizenId !== HEAD_ADMIN_ID) { noPermMsg(player); return; }
    let density = parseInt(argDensity, 10);
    if (isNaN(density)) density = def;
    density = Math.max(0, Math.min(100, density));

    if (trafficData.timer) { clearInterval(trafficData.timer); trafficData.timer = null; }
    trafficCleanupAll();
    
    trafficData.owner = density > 0 ? player : null;
    trafficData.density = density;

    mp.players.call('c:setTrafficDensity', [density]);

    if (density <= 0) {
        player.outputChatBox('!{FF4444}NPC-трафик выключен.');
        return;
    }

    trafficTick();
    trafficData.timer = setInterval(trafficTick, 3000); // Обновление каждые 3 секунды
    player.outputChatBox(`!{44FF44}NPC-трафик включён (плотность ${density}%).`);
};

mp.events.add('playerReady', (player) => {
    player.call('c:setTrafficDensity', [trafficData.density]);
});

mp.events.addCommand('traffic', (player, _, arg) => setTraffic(player, arg, 100));
mp.events.addCommand('trafic', (player, _, arg) => setTraffic(player, arg, 100));

// /sbiv [id] — сбить анимацию: вернуть игрока в дефолтное положение и обнулить
// скорость/ускорение (очистка всех задач педа на клиенте). Без id — себя.
mp.events.addCommand('sbiv', (player, _, argId) => {
    if (!hasPerm(player, 'sbiv')) { noPermMsg(player); return; }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (argId && !target) {
        player.outputChatBox('!{FF4444}Использование: /sbiv [id] — игрок с таким ID не найден');
        return;
    }
    try { target.call('admin:sbiv', []); } catch (e) { /* ignore */ }
    if (target === player) {
        player.outputChatBox('!{44FF44}Анимация сбита (дефолтное положение, скорость сброшена).');
    } else {
        target.outputChatBox('!{44FF44}Администратор сбил вашу анимацию.');
        player.outputChatBox(`!{44FF44}Игроку ${target.citizenId} сбита анимация!`);
    }
});

// Выполнение привязанных команд (/bind) — клиент шлёт строку команды, здесь она
// запускается через тот же обработчик, что и обычный ввод из чата.
mp.events.add('bind:execute', (player, cmdText) => {
    if (!player || !cmdText) return;
    const text = String(cmdText).trim();
    if (!text) return;
    const name = text.split(/\s+/)[0].toLowerCase();
    // Те же ограничения, что в обёртке addCommand (тюрьма / наручники)
    if (jailMap.has(player)) {
        const isDunjailByHead = name === 'dunjail' && player.citizenId === HEAD_ADMIN_ID;
        if (name !== JAIL_ALLOWED_CMD && !isDunjailByHead) {
            player.outputChatBox('!{FF4444}В тюрьме доступны только /gun, /dunjail (гл. админ) и клавиша R!');
            return;
        }
    } else if (player.cuffed) {
        const isAuncuffByHead = name === 'auncuff' && player.citizenId === HEAD_ADMIN_ID;
        if (!isAuncuffByHead) {
            player.outputChatBox('!{FF4444}Вы в наручниках — команды недоступны!');
            return;
        }
    }
    const handler = commandHandlers.get(name);
    if (!handler) {
        player.outputChatBox(`!{FF4444}Команда не найдена: /${name}`);
        return;
    }
    const parts = text.split(/\s+/);
    try {
        handler(player, text, ...parts.slice(1));
    } catch (e) {
        player.outputChatBox(`!{FF4444}Ошибка выполнения команды /${name}`);
    }
});

// /repair
mp.events.addCommand('repair', (player) => {
    if (!hasPerm(player, 'repair')) { noPermMsg(player); return; }
    if (!player.vehicle) {
        player.outputChatBox('!{FF4444}Вы должны находиться в машине!');
        return;
    }
    player.vehicle.repair();
    player.outputChatBox('!{44FF44}Транспорт починен');
});

// /eject [id] — выбросить игрока (или себя) из транспорта.
// Доступна ВСЕМ игрокам, но цель должна быть рядом (до 10 м).
mp.events.addCommand('eject', (player, _, argId) => {
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /eject [id] — игрок с таким ID не найден');
        return;
    }
    if (!target.vehicle) {
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} не находится в транспорте`);
        return;
    }
    if (target !== player) {
        try {
            const dx = target.position.x - player.position.x;
            const dy = target.position.y - player.position.y;
            const dz = target.position.z - player.position.z;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 10) {
                player.outputChatBox('!{FF4444}Игрок слишком далеко (до 10 м).');
                return;
            }
        } catch (e) { /* ignore */ }
    }
    // server.removeFromVehicle нестабилен — выбрасываем на клиенте.
    // Клиент дополнительно «расстёгивает» флаг педа (CAN_BE_KNOCKED_OFF), если пристёгнут.
    target.call('admin:forceEject', []);
    if (target === player) {
        player.outputChatBox('!{44FF44}Вы выброшены из транспорта');
    } else {
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} выброшен из транспорта!`);
    }
});

// /aeject [id] — админская версия /eject: выбросить игрока из транспорта
// в ЛЮБОЙ точке карты (без проверки дистанции).
mp.events.addCommand('aeject', (player, _, argId) => {
    if (!hasPerm(player, 'eject')) { noPermMsg(player); return; }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /aeject [id] — игрок с таким ID не найден');
        return;
    }
    if (!target.vehicle) {
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} не находится в транспорте`);
        return;
    }
    target.call('admin:forceEject', []);
    player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} выброшен из транспорта (по всей карте)!`);
});

// /god
mp.events.addCommand('god', (player) => {
    if (!hasPerm(player, 'god')) { noPermMsg(player); return; }
    player.godmode = !player.godmode;
    if (player.godmode) {
        player.health = 100;
        player.armour = 100;
    }
    player.call('admin:godmode', [player.godmode]);
    player.outputChatBox(player.godmode ? '!{44FF44}Godmode включён' : '!{FF4444}Godmode выключён');
});

// /noclip и /fly
const toggleNoclip = (player) => {
    if (!hasPerm(player, 'noclip')) { noPermMsg(player); return; }
    if (jailMap.has(player)) {
        player.outputChatBox('!{FF4444}В тюрьме полёт запрещён!');
        return;
    }
    player.call('admin:toggleNoclip');
};
mp.events.addCommand('noclip', toggleNoclip);
mp.events.addCommand('fly', toggleNoclip);

// ---------- Тюрьма (Demorgan = федеральная тюрьма) ----------
const JAIL_POS = new mp.Vector3(1685.0, 2511.0, 50.0); // Деморган (вход)
const JAIL_RELEASE_HEADING = 77.58;
const JAIL_RELEASE_POS = new mp.Vector3(1846.642, 2585.909, 56.468); // парковка у тюрьмы

const formatJailTime = (release) => {
    const left = Math.max(0, Math.ceil((release - Date.now()) / 1000));
    const m = Math.floor(left / 60);
    const s = left % 60;
    return `${m} мин ${s} сек`;
};

const releasePlayer = (player) => {
    if (!jailMap.has(player)) return;
    jailMap.delete(player);
    if (player.citizenId != null) charDb.removeJail(player.citizenId);
    try {
        player.call('jail:stop', []);
        player.position = JAIL_RELEASE_POS;
        player.heading = JAIL_RELEASE_HEADING;
        player.dimension = 0;
        player.removeAllWeapons();
        restoreAfterJail(player);
        player.outputChatBox('!{44FF44}Срок наказания истёк! Вы освобождены из тюрьмы.');
    } catch (e) { /* ignore */ }
};

// Применяет тюремное состояние: камера, скин, таймер. Используется и при посадке,
// и при возврате в тюрьму после перезахода (запись из БД).
const applyJailState = (player, release, reason, comment, type) => {
    const jailType = type === JAIL_TYPE_PRISON ? JAIL_TYPE_PRISON : JAIL_TYPE_DEMORGAN;
    jailMap.set(player, { release, reason, comment: comment || '', type: jailType });
    try {
        player.removeAllWeapons();
        player.position = JAIL_POS;
        player.heading = 0;
        player.dimension = 0;
        player.health = 100;
        player.armour = 100;
        // Одеваем скин заключённого (запоминаем прежний скин, чтобы вернуть при выходе)
        const skinModel = jailType === JAIL_TYPE_PRISON ? JAIL_SKIN_PRISON : JAIL_SKIN_DEMORGAN;
        player._prevSkinModel = player.customSkinModel || null;
        try {
            player.customSkinModel = mp.joaat(skinModel);
            player.model = player.customSkinModel;
        } catch (e) { /* ignore */ }
        player.call('jail:start', [Math.max(1, Math.ceil((release - Date.now()) / 1000)), reason, comment || '', jailType]);
    } catch (e) { /* ignore */ }
};

const jailPlayer = (player, minutes, reason, comment, type) => {
    const release = Date.now() + minutes * 60 * 1000;
    applyJailState(player, release, reason, comment, type);
    charDb.saveJail(player.citizenId, release, reason, comment, type || JAIL_TYPE_DEMORGAN); // сохраняем — переживёт рестарт
    const rText = reason ? ` Причина: ${reason}` : '';
    const cText = comment ? ` Комментарий: ${comment}` : '';
    const place = type === JAIL_TYPE_PRISON ? 'тюрьму' : 'федеральную тюрьму (Demorgan)';
    player.outputChatBox(`!{FF4444}Вы заключены в ${place} на ${minutes} мин!${rText}${cText}`);
};

// Возвращаем обычную внешность после тюрьмы (если скин менял jailPlayer)
const restoreAfterJail = (player) => {
    const prev = player._prevSkinModel;
    delete player._prevSkinModel;
    player.customSkinModel = prev || null;
    try {
        const c = player.char;
        if (c) {
            player.model = mp.joaat(c.gender === 1 ? 'mp_f_freemode_01' : 'mp_m_freemode_01');
            player.call('char:applyAppearance', [JSON.stringify({ gender: c.gender, appearance: c.appearance })]);
        } else {
            player.model = mp.joaat('mp_m_freemode_01');
        }
    } catch (e) { /* ignore */ }
};

// Точка «выхода» из Деморгана: если заключённый подходит к ней ближе 100 м —
// возвращаем обратно в камеру (спавн тюрьмы)
const JAIL_EXIT_POS = new mp.Vector3(1818.200, 2607.677, 45.588);
const JAIL_EXIT_RADIUS = 100.0;

// Тип наказания: 'demorgan' — /ajail (федеральная тюрьма Demorgan),
// 'prison' — тюрьма по розыску/наручникам (посадка у маркера).
// У каждого свой скин заключённого.
const JAIL_TYPE_DEMORGAN = 'demorgan';
const JAIL_TYPE_PRISON = 'prison';
// Скин в Деморгане (/ajail)
const JAIL_SKIN_DEMORGAN = 'ig_rashcosvki';
// Скин в тюрьме по розыску/наручникам
const JAIL_SKIN_PRISON = 's_m_y_marine_01';

// Периодическая проверка сроков + тик таймера для клиента
setInterval(() => {
    const now = Date.now();
    jailMap.forEach((info, player) => {
        try {
            if (now >= info.release) {
                releasePlayer(player);
            } else {
                // Побег: слишком близко к точке выхода (горизонтально), далеко от камеры
                // или перешёл в другой dimension — возвращаем в камеру
                const p = player.position;
                if (p && typeof p.x === 'number') {
                    const dx = p.x - JAIL_EXIT_POS.x;
                    const dy = p.y - JAIL_EXIT_POS.y;
                    const dToExit = Math.hypot(dx, dy);
                    const dcx = p.x - JAIL_POS.x;
                    const dcy = p.y - JAIL_POS.y;
                    const dToCell = Math.hypot(dcx, dcy);
                    if (dToExit < JAIL_EXIT_RADIUS || dToCell > 180 || (player.dimension !== 0)) {
                        player.position = JAIL_POS;
                        player.heading = 0;
                        player.dimension = 0;
                        // Оружие НЕ зачищаем: оно снимается при посадке (applyJailState),
                        // а повторный wiipe здесь ломает /gun для админа в тюрьме
                        player.call('jail:escape', []);
                        player.outputChatBox('!{FF4444}Побег из тюрьмы пресечён! Вы возвращены в камеру.');
                        console.log(`[jail] ${player.name || player.socialClub || '?'} предпринял побег (${Math.round(dToExit)}м до выхода) — возвращён в камеру`);
                    }
                }
                const left = Math.max(0, Math.ceil((info.release - now) / 1000));
                player.call('jail:tick', [left]);
            }
        } catch (e) { /* ignore */ }
    });
}, 1000);

// Рассылка меток выхода игроков: каждые 1.5с шлём локальным игрокам маркеры
// в радиусе QUIT_MARKER_RADIUS; клиент рисует круг + надпись «вышел N мин назад».
setInterval(() => {
    const now = Date.now();
    for (let i = quitMarkers.length - 1; i >= 0; i--) {
        if (now - quitMarkers[i].time > QUIT_MARKER_TTL) quitMarkers.splice(i, 1);
    }
    mp.players.forEach((p) => {
        try {
            if (!p || !p.position) return;
            const px = p.position.x, py = p.position.y;
            const near = [];
            for (let i = 0; i < quitMarkers.length; i++) {
                const m = quitMarkers[i];
                const dx = m.x - px, dy = m.y - py;
                if (dx * dx + dy * dy < QUIT_MARKER_RADIUS * QUIT_MARKER_RADIUS) {
                    near.push([m.x, m.y, m.z, m.name, m.citizenId, m.time]);
                }
            }
            let payload = null;
            try { payload = JSON.stringify(near); } catch (e) { payload = null; }
            if (payload) p.call('quitmarker:list', [payload]);
        } catch (e) { /* ignore */ }
    });
}, 1500);

// Очистка при выходе игрока: тюремная запись остаётся в БД (вернётся при входе);
// за выход В НАРУЧНИКАХ даём Demorgan на 120 минут (LRP); на месте выхода
// оставляем метку «вышел ... назад» для остальных игроков.
mp.events.add('playerQuit', (player) => {
    const info = jailMap.get(player);
    jailMap.delete(player);
    if (player.citizenId != null) {
        if (info) {
            persistedJails.set(player.citizenId, { release: info.release, reason: info.reason, comment: info.comment || '', type: info.type });
        } else if (player.cuffed) {
            // ЛРП: вышел в наручниках — 120 минут Деморгана
            const release = Date.now() + 120 * 60 * 1000;
            const reason = 'LRP';
            const comment = 'Вышел из игры в наручниках';
            charDb.saveJail(player.citizenId, release, reason, comment, JAIL_TYPE_DEMORGAN);
            persistedJails.set(player.citizenId, { release, reason, comment, type: JAIL_TYPE_DEMORGAN });
            console.log(`[jail] ${player.name} (id ${player.citizenId}) вышел в наручниках — Demorgan 120 мин (LRP)`);
        }
    }
    // Метка выхода на месте, где игрок вышел
    try {
        const p = player.position;
        if (p && typeof p.x === 'number' && player.citizenId != null) {
            quitMarkers.push({
                x: p.x, y: p.y, z: p.z,
                name: player.name || '?',
                citizenId: player.citizenId,
                time: Date.now()
            });
        }
    } catch (e) { /* ignore */ }
});// /ajail [id] [минуты] [причина] — посадить игрока в тюрьму
mp.events.addCommand('ajail', (player, fullText, argId, argMin, ...reasonArgs) => {
    if (!hasPerm(player, 'ajail')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /ajail [id] [минуты] [причина] — игрок с таким ID не найден');
        return;
    }
    const minutes = parseInt(argMin, 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        player.outputChatBox('!{FF4444}Использование: /ajail [id] [минуты] [причина] — время в минутах (1-1440)');
        return;
    }
    if (jailMap.has(target)) {
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} уже в тюрьме (${formatJailTime(jailMap.get(target).release)})`);
        return;
    }
    const reason = (reasonArgs || []).join(' ');
    jailPlayer(target, minutes, reason, '', JAIL_TYPE_DEMORGAN);
    player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} посажен в Demorgan на ${minutes} мин${reason ? ` (${reason})` : ''}. Освобождение в ${new Date(Date.now() + minutes * 60000).toLocaleTimeString()}`);
    console.log(`[jail] ${player.name} посадил ${target.name} (id ${target.citizenId}) на ${minutes} мин${reason ? `: ${reason}` : ''}`);
});

// /unjail [id] — досрочно освободить
mp.events.addCommand('unjail', (player, _, argId) => {
    if (!hasPerm(player, 'unjail')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target || !jailMap.has(target)) {
        player.outputChatBox('!{FF4444}Использование: /unjail [id] — игрок с таким ID не в тюрьме');
        return;
    }
    jailMap.delete(target);
    if (target.citizenId != null) charDb.removeJail(target.citizenId); // убрать запись из БД — иначе после рестарта снова в тюрьме
    try {
        target.call('jail:stop', []);
        target.position = JAIL_RELEASE_POS;
        target.heading = JAIL_RELEASE_HEADING;
        target.removeAllWeapons();
        restoreAfterJail(target);
    } catch (e) { /* ignore */ }
    target.outputChatBox('!{44FF44}Вы досрочно освобождены из тюрьмы администратором!');
    player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} освобождён!`);
});

// /dunjail [id] — выпустить из Деморгана. Только для главного админа (id=1)
// и работает ТОЛЬКО пока админ сам находится в тюрьме (в Деморгане).
// Без id — освобождает себя; с id — указанного заключённого.
mp.events.addCommand('dunjail', (player, _, argId) => {
    if (player.citizenId !== HEAD_ADMIN_ID) { noPermMsg(player); return; }
    if (!jailMap.has(player)) {
        player.outputChatBox('!{FF4444}/dunjail работает только внутри Деморгана (примените, находясь в тюрьме).');
        return;
    }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (argId && !target) {
        player.outputChatBox('!{FF4444}Использование: /dunjail [id] — игрок с таким ID не найден');
        return;
    }
    if (!jailMap.has(target)) {
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} сейчас не в Деморгане.`);
        return;
    }
    releasePlayer(target);
    if (target === player) {
        player.outputChatBox('!{44FF44}Вы (главный админ) освободили себя из Деморгана.');
    } else {
        target.outputChatBox('!{44FF44}Вы освобождены из Деморгана главным администратором.');
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} освобождён из Деморгана.`);
    }
    console.log(`[jail] ${player.name} (id ${player.citizenId}) освободил ${target.name} (id ${target.citizenId}) из тюрьмы через /dunjail`);
});

// /auncuff [id] — снять наручники с игрока по ID в любом месте. Только для
// главного админа (id=1), независимо от которых-либо полномочий. Без id — с себя
// (в т.ч. находясь в наручниках: гейт команд выше пропускает эту команду).
mp.events.addCommand('auncuff', (player, _, argId) => {
    if (player.citizenId !== HEAD_ADMIN_ID) { noPermMsg(player); return; }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /auncuff [id] — игрок с таким ID не найден');
        return;
    }
    if (!target.cuffed) {
        player.outputChatBox(`!{FF4444}На игроке ${target.citizenId} нет наручников.`);
        return;
    }
    if (typeof cuffApi.setCuffedState === 'function') cuffApi.setCuffedState(target, false);
    target.outputChatBox('!{44FF44}С вас сняли наручники (главный администратор).');
    player.outputChatBox(`!{44FF44}Сняты наручники с игрока ${target.citizenId} (главный админ).`);
    console.log(`[auncuff] ${player.name} (id ${player.citizenId}) снял наручники с ${target.name} (id ${target.citizenId})`);
});

// ---------- Посадка в тюрьму задержанного (наручники + розыск) ----------
// Как Demorgan, но посадить можно только игрока В НАРУЧНИКАХ и В РОЗЫСКЕ.
// При посадке наручники снимаются и розыск убирается.
const arrestEligible = (p) => !!p && p.citizenId != null && p.cuffed && p.wantedStars >= 1 && !jailMap.has(p);

const arrestEligibleList = () => mp.players.toArray()
    .filter(arrestEligible)
    .map((p) => [p.citizenId, p.name, p.wantedStars || 0]);

// Запрос интерфейса посадки у маркера тюрьмы (клавиша E).
const arrestOpenUi = (player) => {
    if (!hasPerm(player, 'ajail')) { noPermMsg(player); return; }
    try {
        const p = player.position;
        if (p && typeof p.x === 'number') {
            const d = Math.hypot(p.x - PRISON_MARKER_POS.x, p.y - PRISON_MARKER_POS.y);
            if (d > PRISON_MARKER_RADIUS) {
                player.outputChatBox('!{FF4444}Подойдите к маркеру у тюрьмы и нажмите E.');
                return;
            }
        }
    } catch (e) { /* ignore */ }
    let payload = null;
    try { payload = JSON.stringify({ players: arrestEligibleList() }); } catch (e) { /* ignore */ }
    player.call('prison:openUi', [payload || '{}']);
};
mp.events.add('arrest:open', (player) => arrestOpenUi(player));

// Посадка из формы: id, причина, время (>50 мин), комментарий
mp.events.add('arrest:jail', (player, argId, argMin, argReason, argComment) => {
    if (!hasPerm(player, 'ajail')) { noPermMsg(player); return; }
    const id = parseInt(argId, 10);
    if (!Number.isInteger(id)) {
        player.outputChatBox('!{FF4444}Укажите корректный ID игрока.');
        return;
    }
    const target = getPlayerById(id);
    if (!target) {
        player.outputChatBox(`!{FF4444}Игрок с ID ${id} не найден.`);
        return;
    }
    if (target === player) {
        player.outputChatBox('!{FF4444}Себя сажать в тюрьму нельзя.');
        return;
    }
    if (jailMap.has(target)) {
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} уже в тюрьме (${formatJailTime(jailMap.get(target).release)}).`);
        return;
    }
    if (!arrestEligible(target)) {
        player.outputChatBox('!{FF4444}Посадить можно только игрока В НАРУЧНИКАХ и В РОЗЫСКЕ.');
        return;
    }
    // Задержанный должен быть рядом с админом
    try {
        const dx = target.position.x - player.position.x;
        const dy = target.position.y - player.position.y;
        const dz = target.position.z - player.position.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > PRISON_TARGET_DIST) {
            player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} слишком далеко (до ${PRISON_TARGET_DIST} м).`);
            return;
        }
    } catch (e) { /* ignore */ }
    const minutes = parseInt(argMin, 10);
    if (!Number.isInteger(minutes) || minutes < ARREST_MIN_MINUTES) {
        player.outputChatBox(`!{FF4444}Минимальный срок — ${ARREST_MIN_MINUTES} мин (должно быть больше 50).`);
        return;
    }
    if (minutes > 1440) {
        player.outputChatBox('!{FF4444}Максимальный срок — 1440 мин (сутки).');
        return;
    }
    const reason = String(argReason == null ? '' : argReason).trim().slice(0, 100);
    const comment = String(argComment == null ? '' : argComment).trim().slice(0, 200);

    // Снимаем наручники (офицер приведший задержанного освобождается от ведения)
    if (typeof cuffApi.setCuffedState === 'function') cuffApi.setCuffedState(target, false);
    // Снимаем розыск (и из БД, чтобы не вернулся после рестарта)
    target.wantedStars = 0;
    target.wantedReason = '';
    try { target.setVariable('wantedStars', 0); } catch (e) { /* ignore */ }
    try { target.call('star:apply', [0]); } catch (e) { /* ignore */ }
    charDb.removeWanted(target.citizenId);

    jailPlayer(target, minutes, reason || 'Арест', comment, JAIL_TYPE_PRISON);
    console.log(`[arrest] ${player.name} посадил ${target.name} (id ${target.citizenId}) на ${minutes} мин${reason ? ` | ${reason}` : ''}${comment ? ` | ${comment}` : ''}`);
    player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} посажен в тюрьму на ${minutes} мин. Наручники и розыск сняты.`);
});

// ---------- Меню полномочий (главный админ) ----------
// /perm — открыть меню полномочий (только для главного админа, id=1)
mp.events.addCommand('perm', (player) => {
    if (player.citizenId !== HEAD_ADMIN_ID) { noPermMsg(player); return; }
    mp.events.call('perm:requestPlayers', player);
});

// Гл. админ жать стрелку вверх — запрос списка игроков/команд
mp.events.add('perm:requestPlayers', (player) => {
    if (player.citizenId !== HEAD_ADMIN_ID) return;
    const playersList = mp.players.toArray()
        .filter((p) => p.citizenId != null)
        .map((p) => [p.citizenId, p.name]);
    const permsList = {};
    perms.forEach((v, id) => { permsList[id] = v; });
    let payload = null;
    try { payload = JSON.stringify({ players: playersList, cmds: CMD_LABELS, perms: permsList }); } catch (e) { /* ignore */ }
    if (payload) player.call('perm:open', [payload]);
});

// Сохранение полномочий игрока
mp.events.add('perm:save', (player, targetId, cmdsJson) => {
    if (player.citizenId !== HEAD_ADMIN_ID) return;
    const id = parseInt(targetId, 10);
    if (!Number.isInteger(id)) return;
    let obj = null;
    try { obj = JSON.parse(cmdsJson); } catch (e) { return; }
    if (!obj || typeof obj !== 'object') return;
    const clean = {};
    CMD_LABELS.forEach(([cmd]) => { if (obj[cmd]) clean[cmd] = true; });
    if (Object.keys(clean).length > 0) perms.set(id, clean);
    else perms.delete(id);
    charDb.savePerms(id, clean); // сохраняем права в SQLite (server.db)
    // Обновляем права онлайн-игроку на клиенте (для F5 и т.п.)
    const target = getPlayerById(id);
    if (target) syncPerms(target);
    console.log(`[perm] id ${id}: ${JSON.stringify(clean)} (изменил ${player.name})`);
    player.outputChatBox(`!{44FF44}Полномочия игрока ${id} обновлены!`);
});

// Загрузка прав из БД при старте сервера
charDb.getPerms((saved) => {
    Object.keys(saved || {}).forEach((id) => {
        const idNum = parseInt(id, 10);
        const cmds = saved[id] || {};
        if (Object.keys(cmds).length > 0) perms.set(idNum, cmds);
    });
    console.log(`[perm] Загружено прав из БД: ${perms.size} игрок(-а)`);
});

// Загрузка активных тюремных записей из БД (посадки переживают рестарт)
charDb.getJails((list) => {
    const now = Date.now();
    (list || []).forEach((j) => {
        if (j.release > now) persistedJails.set(j.citizenId, { release: j.release, reason: j.reason || '', comment: j.comment || '', type: j.jtype || JAIL_TYPE_DEMORGAN });
        else charDb.removeJail(j.citizenId); // срок истёк во время рестарта — чистим
    });
    console.log(`[jail] Активных тюремных записей из БД: ${persistedJails.size}`);
});

// Загрузка розыска из БД (переживает рестарт)
charDb.getWanted((list) => {
    (list || []).forEach((w) => {
        if (w.stars > 0) persistedWanted.set(w.citizenId, { stars: w.stars, reason: w.reason || '' });
    });
    console.log(`[star] Активных розысков из БД: ${persistedWanted.size}`);
});

// ---------- Ремень безопасности (клавиша J) ----------
// Клиент сообщает состояние ремня; сервер режет урон вдвое,
// а «невылетание» из машины делает клиент нативами (флаг педа).
mp.events.add('seatbelt:toggle', (player, state) => {
    player.seatbelt = !!state;
    player.outputChatBox(player.seatbelt
        ? '!{44FF44}Ремень безопасности пристёгнут'
        : '!{FF4444}Ремень безопасности отстёгнут');
});

// Урон игроку: с пристёгнутым ремнём получаем 50% урона
mp.events.add('playerDamage', (player, healthLoss, armourLoss) => {
    if (!player || player.seatbelt !== true) return;
    if (healthLoss > 0) {
        // Возвращаем половину потерянного здоровья — суммарно урон 50%
        player.health = Math.min(100, player.health + healthLoss / 2);
    }
});

// ---------- Чат: обычные сообщения (не команды) видят игроки поблизости ----------
mp.events.add('playerChat', (player, text) => {
    const msg = String(text || '').trim();
    if (!msg) return;
    const fromName = (player.getVariable && player.getVariable('charName')) || player.name || 'Игрок';
    try {
        mp.players.forEachInRange(player.position, 20, (other) => {
            try { other.outputChatBox(`!{B0B0B0}${fromName}: ${msg}`); } catch (e) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
});

// ---------- Розыск (звёзды) ----------
// /star [id] [звёзды 0-5] [причина] — объявить игрока в розыск (0 — снять)
mp.events.addCommand('star', (player, _, argId, argStars, ...reasonArgs) => {
    if (!hasPerm(player, 'star')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /star [id] [звёзды 0-5] [причина] — игрок с таким ID не найден');
        return;
    }
    const stars = parseInt(argStars, 10);
    if (!Number.isInteger(stars) || stars < 0 || stars > 5) {
        player.outputChatBox('!{FF4444}Использование: /star [id] [звёзды 0-5] [причина] — звёзды от 0 до 5');
        return;
    }
    const reason = (reasonArgs || []).join(' ');
    target.wantedStars = stars;
    target.wantedReason = stars > 0 ? reason : '';
    try { target.setVariable('wantedStars', stars); } catch (e) { /* ignore */ }
    try { target.call('star:apply', [stars]); } catch (e) { /* ignore */ }
    charDb.saveWanted(target.citizenId, stars, reason); // розыск переживёт рестарт
    if (stars > 0) {
        const starWord = stars === 1 ? 'звезда' : (stars < 5 ? 'звезды' : 'звёзд');
        target.outputChatBox(`!{FF4444}Вы объявлены в розыск (${stars} ${starWord})${reason ? `: ${reason}` : ''}!`);
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} объявлен в розыск (${stars} зв.)${reason ? ` Причина: ${reason}` : ''}.`);
        console.log(`[star] ${player.name} объявил ${target.name} (id ${target.citizenId}) в розыск: ${stars} зв.${reason ? ` (${reason})` : ''}`);
    } else {
        target.outputChatBox('!{44FF44}С вас снят розыск.');
        player.outputChatBox(`!{44FF44}С игрока ${target.citizenId} снят розыск.`);
        console.log(`[star] ${player.name} снял розыск с ${target.name} (id ${target.citizenId})`);
    }
});

// /orm [id] — показать на карте маркер преступника, если у игрока есть звёзды.
// Позицию цели каждую секунду шлёт СЕРВЕР (клиент не зависит от стрима/дальности).
// Маркер бессрочный — убирается командой /unorm (или при выходе из игры).
const ormRequests = new Map(); // requester.citizenId -> { target, timer }

const ormStop = (player) => {
    const rec = ormRequests.get(player.citizenId);
    if (!rec) return;
    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
    ormRequests.delete(player.citizenId);
    try { player.call('orm:stop', []); } catch (e) { /* ignore */ }
};

// Если запросивший вышел — гасим его маркер и спектатора
mp.events.add('playerQuit', (player) => {
    ormStop(player);
    specStop(player);
});

mp.events.addCommand('orm', (player, _, argId) => {
    if (!hasPerm(player, 'orm') && !hasPerm(player, 'star')) { noPermMsg(player); return; }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /orm [id] — игрок с таким ID не найден');
        return;
    }
    if (!target.wantedStars || target.wantedStars < 1) {
        player.outputChatBox('!{FF4444}У игрока нет звёзд — розыск не объявлен.');
        return;
    }
    ormStop(player); // новый запрос заменяет старый
    const sendTick = () => {
        try {
            if (!target || !target.position) { ormStop(player); return; }
            player.call('orm:tick', [target.position.x, target.position.y, target.position.z]);
        } catch (e) { ormStop(player); }
    };
    const timer = setInterval(sendTick, 1000);
    ormRequests.set(player.citizenId, { target, timer });
    try {
        player.call('orm:showMarker', [target.name, target.wantedStars, target.wantedReason || '']);
    } catch (e) { /* ignore */ }
    sendTick();
    player.outputChatBox(`!{44FF44}Маркер преступника ${target.citizenId} показан на карте (убрать — /unorm).`);
});

// /unorm — убрать маркер преступника (/orm)
mp.events.addCommand('unorm', (player) => {
    if (!hasPerm(player, 'orm') && !hasPerm(player, 'star')) { noPermMsg(player); return; }
    if (!ormRequests.has(player.citizenId)) {
        player.outputChatBox('!{FF4444}У вас нет активного маркера /orm.');
        return;
    }
    ormStop(player);
    player.outputChatBox('!{FFFF00}Маркер преступника убран.');
});

// ---------- Наручники / ведение / /put (отдельный модуль) ----------
// cuffApi.setCuffedState используется блоком «посадки в тюрьму задержанного»
// (снять наручники после посадки). Заполняется модулем при инициализации.
const cuffApi = {};
require('./cuff.js')({ getPlayerById, hasPerm, noPermMsg, api: cuffApi });

// ---------- Казино: деньги, фишки, игровые автоматы ----------
require('../casino/index.js')({ hasPerm, noPermMsg });

// ---------- РП-команды: /me /do /try /roll ----------
require('../rp/index.js')();
