const localPlayer = mp.players.local;

// Отключаем встроенную отрисовку неймтегов RAGE MP
mp.nametags.enabled = false;

// В событие 'render' RAGE MP автоматически прокидывает массив `nametags`
mp.events.add('render', (nametags) => {
    // 1. Отображение собственного ID в правом верхнем углу
    const ownId = localPlayer.getVariable('citizenId');
    if (ownId != null) {
        mp.game.ui.setTextEntry('STRING');
        mp.game.ui.addTextComponentSubstringPlayerName(`Ваш id: ${ownId}`);
        mp.game.ui.setTextScale(0.4, 0.4);
        mp.game.ui.setTextColour(255, 255, 255, 255);
        mp.game.ui.setTextFont(0);
        mp.game.ui.setTextEdge(1, 0, 0, 0, 255);
        mp.game.ui.setTextRightJustify(true);
        mp.game.ui.drawText(0.98, 0.06);
    }

    // 2. Отрисовка над головами игроков через штатный массив nametags
    // Элемент nametag содержит: [playerEntity, screenX, screenY, distance]
    if (Array.isArray(nametags)) {
        nametags.forEach((nametag) => {
            const [plyr, x, y, distance] = nametag;

            // Пропускаем себя и тех, кто дальше 50 метров
            if (!plyr || plyr === localPlayer || distance > 50) return;

            // Невидимые (/invis, /fly, /spec): ник не показываем
            try {
                if (plyr.getVariable && plyr.getVariable('invis') === true) return;
            } catch (e) { /* ignore */ }

            // Получаем citizenId и имя персонажа игрока
            const id = plyr.getVariable('citizenId');
            if (id == null) return;
            const charName = plyr.getVariable('charName');
            const label = charName ? `${charName} [${id}]` : `Гражданин ${id}`;

            // Рисуем текст по готовым 2D-координатам (x, y) от RAGE MP
            mp.game.ui.setTextFont(0);
            mp.game.ui.setTextScale(0.35, 0.35);
            mp.game.ui.setTextColour(255, 255, 255, 255);
            mp.game.ui.setTextOutline();
            mp.game.ui.setTextCentre(true);
            mp.game.ui.setTextEntry("STRING");
            mp.game.ui.addTextComponentSubstringPlayerName(label);
            mp.game.ui.drawText(x, y);
        });
    }
});