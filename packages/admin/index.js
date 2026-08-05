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

// В тюрьме (Demorgan) работают только /gun и клавиша R — все остальные чат-команды блокируем.
// В наручниках — все команды запрещены.
const JAIL_ALLOWED_CMD = 'gun';
const _addCommandOrig = mp.events.addCommand;
mp.events.addCommand = function (cmdName, handler) {
    _addCommandOrig.call(mp.events, cmdName, function (player, ...args) {
        if (jailMap.has(player)) {
            if (cmdName.toLowerCase() !== JAIL_ALLOWED_CMD) {
                player.outputChatBox('!{FF4444}В тюрьме доступны только /gun и клавиша R!');
                return;
            }
        } else if (player.cuffed) {
            player.outputChatBox('!{FF4444}Вы в наручниках — команды недоступны!');
            return;
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
    ['ajail', 'Посадить в тюрьму'],
    ['unjail', 'Освободить'],
    ['star', 'Объявить в розыск (/star)'],
    ['orm', 'Маркер преступника (/orm)'],
    ['livery', 'Раскраска машины (/livery)'],
    ['color', 'Цвет машины (/color)']
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
mp.events.add('playerReady', (player) => syncPerms(player));

// Помощь
mp.events.addCommand('help', (player) => {
    player.outputChatBox('!{FFD700}=== Админ Команды ===');
    player.outputChatBox('!{FFFF00}/kill [id] !{FFFFFF}- убить игрока по ID');
    player.outputChatBox('!{FFFF00}/freeze [id] !{FFFFFF}- заморозить/разморозить игрока по ID');
    player.outputChatBox('!{FFFF00}/rescue [id] !{FFFFFF}- воскресить и исцелить (себя или игрока по ID)');
    player.outputChatBox('!{FFFF00}/tp [id] !{FFFFFF}- телепортироваться к игроку по ID');
    player.outputChatBox('!{FFFF00}/gh [id] !{FFFFFF}- телепортировать игрока по ID к себе');
    player.outputChatBox('!{FFFF00}/eject [id] !{FFFFFF}- выкинуть игрока (или себя) из транспорта');
    player.outputChatBox('!{FFFF00}/esp !{FFFFFF}- показать всех игроков и машины');
    player.outputChatBox('!{FFFF00}/delveh [id] !{FFFFFF}- удалить машину по ID (или ближайшую)');
    player.outputChatBox('!{FFFF00}/excar [id] !{FFFFFF}- взорвать машину по ID (или ближайшую)');
    player.outputChatBox('!{FFFF00}/fuel [литры] [id] !{FFFFFF}- установить топливо машине (или ближайшей)');
    player.outputChatBox('!{FFFF00}/veh [название] [номер] !{FFFFFF}- заспавнить авто с кастомным номером');
    player.outputChatBox('!{FFFF00}/gun [название] !{FFFFFF}- выдать оружие в руки');
    player.outputChatBox('!{FFFF00}/repair !{FFFFFF}- починить авто');
    player.outputChatBox('!{FFFF00}/god !{FFFFFF}- бессмертие');
    player.outputChatBox('!{FFFF00}R !{FFFFFF}- возродиться (если вы мертвы)');
    player.outputChatBox('!{FFFF00}/noclip !{FFFFFF}(или /fly) - полёт');
    player.outputChatBox('!{FFFF00}/invis !{FFFFFF}- невидимость');
    player.outputChatBox('!{FFFF00}/copypos !{FFFFFF}- скопировать позицию (в positions.txt + чат)');
    player.outputChatBox('!{FFFF00}/spec [id] / /unspec !{FFFFFF}- наблюдать за игроком через камеру');
    player.outputChatBox('!{FFFF00}/skin [id] !{FFFFFF}- сменить скин (/skin reset - вернуть свой)');
    player.outputChatBox('!{FFFF00}/6 [id] !{FFFFFF}(/cuff) - надеть/снять наручники (команды запрещены, скорость 50%)');
    player.outputChatBox('!{FFFF00}/7 [id] !{FFFFFF}(/lead) - взять задержанного под руку, /7 - отпустить');
    player.outputChatBox('!{FFFF00}/uncuff [id] !{FFFFFF}- снять наручники (без id - с себя)');
    player.outputChatBox('!{FFFF00}/unlead !{FFFFFF}- отпустить задержанного');
    player.outputChatBox('!{FFFF00}/put [id] !{FFFFFF}- посадить задержанного в свою машину, а вне машины - в ближайшую');
    player.outputChatBox('!{FFFF00}/vfly !{FFFFFF}- полёт на машине (машина летает)');
    player.outputChatBox('!{FFFF00}Навёл прицел на игрока + 6/7 !{FFFFFF}- наручники / взять под руку (до 8 м)');
    player.outputChatBox('!{FFFF00}/ajail [id] [минуты] [причина] !{FFFFFF}- посадить игрока в федеральную тюрьму');
    player.outputChatBox('!{FFFF00}/unjail [id] !{FFFFFF}- досрочно освободить игрока');
    player.outputChatBox('!{FFFF00}/star [id] [звёзды 0-5] [причина] !{FFFFFF}- объявить в розыск (/star [id] 0 - снять)');
    player.outputChatBox('!{FFFF00}/orm [id] !{FFFFFF}- показать маркер преступника на карте (если у него есть звёзды)');
    player.outputChatBox('!{FFFF00}/livery [номер] !{FFFFFF}- раскраска (ливрея) вашей машины; без номера — следующая');
    player.outputChatBox('!{FFFF00}/color [R] [G] [B] !{FFFFFF}- покрасить машину в RGB-цвет (0-255)');
    player.outputChatBox('!{FFFF00}/reset !{FFFFFF}- изменить внешность и имя персонажа');
    player.outputChatBox('!{FFFF00}/perm !{FFFFFF}- меню полномочий (для главного админа, id=1)');
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

// /gun [название] — надежная выдача оружия
mp.events.addCommand('gun', (player, _, weaponName) => {
    if (!hasPerm(player, 'gun')) { noPermMsg(player); return; }
    let name = weaponName ? weaponName.toLowerCase() : 'weapon_specialrifle';
    if (!name.startsWith('weapon_')) {
        name = 'weapon_' + name;
    }
    const hash = mp.joaat(name);

    player.giveWeapon(hash, 999, true);
    player.call('admin:giveWeapon', [hash, 999]); // Дублируем натив на клиент

    player.outputChatBox(`!{44FF44}Выдано оружие: ${name}`);
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

// /spec [id] — закрепить камеру за игроком (наблюдение)
mp.events.addCommand('spec', (player, _, argId) => {
    if (!hasPerm(player, 'spec')) { noPermMsg(player); return; }
    if (argId && argId.toLowerCase() === 'off') {
        player.call('spec:stop', []);
        player.outputChatBox('!{FF4444}Наблюдение выключено');
        return;
    }
    const target = getPlayerById(parseInt(argId, 10));
    if (!target || target === player) {
        player.outputChatBox('!{FF4444}Использование: /spec [id] — игрок с таким ID не найден');
        return;
    }
    player.call('spec:start', [target.id]);
    player.outputChatBox(`!{44FF44}Наблюдаете за игроком #${target.citizenId} (${target.name})`);
});

// /unspec — отключить наблюдение
mp.events.addCommand('unspec', (player) => {
    if (!hasPerm(player, 'spec')) { noPermMsg(player); return; }
    player.call('spec:stop', []);
    player.outputChatBox('!{FF4444}Наблюдение выключено');
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
    player.health = 100;
    player.armour = 100;
    player.outputChatBox('!{44FF44}Вы успешно возродились!');
});

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
    target.health = 100;
    target.armour = 100;

    if (target === player) {
        player.outputChatBox('!{44FF44}Вы успешно воскрешены и исцелены!');
    } else {
        target.outputChatBox('!{44FF44}Вы воскрешены и исцелены администратором!');
        player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} воскрешён и исцелён!`);
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

// /eject [id] — выкинуть игрока (или себя) из транспорта
mp.events.addCommand('eject', (player, _, argId) => {
    if (!hasPerm(player, 'eject')) { noPermMsg(player); return; }
    const target = argId ? getPlayerById(parseInt(argId, 10)) : player;
    if (!target) {
        player.outputChatBox('!{FF4444}Использование: /eject [id] — игрок с таким ID не найден');
        return;
    }
    if (!target.vehicle) {
        player.outputChatBox(`!{FF4444}Игрок ${target.citizenId} не находится в транспорте`);
        return;
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

const jailPlayer = (player, minutes, reason) => {
    const release = Date.now() + minutes * 60 * 1000;
    jailMap.set(player, { release, reason });
    try {
        player.removeAllWeapons();
        player.position = JAIL_POS;
        player.heading = 0;
        player.dimension = 0;
        player.health = 100;
        player.armour = 100;
        // Одеваем скин заключённого (запоминаем прежний скин, чтобы вернуть при выходе)
        player._prevSkinModel = player.customSkinModel || null;
        try {
            player.customSkinModel = mp.joaat('ig_rashcosvki');
            player.model = player.customSkinModel;
        } catch (e) { /* ignore */ }
        player.call('jail:start', [minutes * 60, reason]);
    } catch (e) { /* ignore */ }
    const rText = reason ? ` Причина: ${reason}` : '';
    player.outputChatBox(`!{FF4444}Вы заключены в федеральную тюрьму (Demorgan) на ${minutes} мин!${rText}`);
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
                        player.removeAllWeapons();
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

// Очистка при выходе игрока
mp.events.add('playerQuit', (player) => {
    jailMap.delete(player);
});

// /ajail [id] [минуты] [причина] — посадить игрока в тюрьму
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
    jailPlayer(target, minutes, reason);
    player.outputChatBox(`!{44FF44}Игрок ${target.citizenId} посажен на ${minutes} мин${reason ? ` (${reason})` : ''}. Освобождение в ${new Date(Date.now() + minutes * 60000).toLocaleTimeString()}`);
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

// /orm [id] — показать на карте маркер преступника, если у игрока есть звёзды
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
    try {
        player.call('orm:showMarker', [target.id, target.name, target.wantedStars, target.wantedReason || '']);
    } catch (e) { /* ignore */ }
    player.outputChatBox(`!{44FF44}Маркер преступника ${target.citizenId} показан на карте (30 сек).`);
});

// ---------- Наручники / ведение / /put (отдельный модуль) ----------
require('./cuff.js')({ getPlayerById, hasPerm, noPermMsg });
