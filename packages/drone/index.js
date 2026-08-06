// ---------- FPV Drone Package (Server) ----------
mp.events.addCommand('fpv', (player) => {
    if (player.inFpv) {
        stopFpv(player);
        return;
    }

    if (player.getHealth && player.getHealth() <= 0) {
        player.outputChatBox('!{FF4444}Нельзя запустить дрон, будучи мертвым.');
        return;
    }

    try {
        const pos = player.position;
        const drone = mp.objects.new(mp.joaat('prop_drone_01'), new mp.Vector3(pos.x, pos.y, pos.z + 1.0), {
            dimension: player.dimension,
            rotation: new mp.Vector3(0, 0, player.heading || 0)
        });

        player.droneObj = drone;
        player.inFpv = true;
        player.fpvReturnPos = new mp.Vector3(pos.x, pos.y, pos.z);

        player.call('drone:start', [drone.id]);
        player.outputChatBox('!{44FF44}FPV Дрон запущен! Управление: WASD, Мышь (360° обзор), Space/Ctrl (высота), [E] Взорвать, [/fpv] Выход.');
    } catch (e) {
        player.outputChatBox('!{FF4444}Ошибка запуска дрона.');
        console.error(e);
    }
});

function stopFpv(player) {
    if (!player.inFpv) return;
    try {
        if (player.droneObj) {
            player.droneObj.destroy();
            player.droneObj = null;
        }
    } catch (e) { /* ignore */ }
    player.inFpv = false;
    player.call('drone:stop', []);
}

mp.events.add('drone:updatePos', (player, x, y, z, rx, ry, rz) => {
    if (!player.inFpv || !player.droneObj) return;
    try {
        player.droneObj.position = new mp.Vector3(x, y, z);
        player.droneObj.rotation = new mp.Vector3(rx, ry, rz);
    } catch (e) { /* ignore */ }
});

mp.events.add('drone:serverExplode', (player, x, y, z) => {
    if (!player.inFpv) return;
    try {
        if (player.droneObj) {
            player.droneObj.destroy();
            player.droneObj = null;
        }
    } catch (e) { /* ignore */ }
    player.inFpv = false;
    player.call('drone:stop', []);

    // 1) Broadcast explosion visuals/sound to ALL players on the server
    mp.players.call('drone:clientExplode', [x, y, z]);

    // 2) Apply server-side health damage to any nearby players (15m radius)
    mp.players.forEach((p) => {
        try {
            if (p && p.position) {
                const dx = p.position.x - x;
                const dy = p.position.y - y;
                const dz = p.position.z - z;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq <= 15 * 15) {
                    const dist = Math.sqrt(distSq);
                    const dmg = Math.round(220 * (1 - dist / 15));
                    const currentHp = p.getHealth ? p.getHealth() : p.health;
                    if (currentHp > 0) {
                        const newHp = Math.max(0, currentHp - dmg);
                        if (typeof p.setHealth === 'function') p.setHealth(newHp);
                        else p.health = newHp;
                    }
                }
            }
        } catch (e) { /* ignore */ }
    });

    player.outputChatBox('!{FF4444}Ваш FPV дрон взорвался!');
});

mp.events.add('drone:exit', (player) => {
    stopFpv(player);
});

mp.events.add('playerQuit', (player) => {
    stopFpv(player);
});

mp.events.add('playerDeath', (player) => {
    stopFpv(player);
});
