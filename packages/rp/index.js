// ---------- РП-команды: /me /do /try /roll ----------
// Показываются в чат игрокам в радиусе RP_RANGE метров (включая самого игрока).
module.exports = function initRp() {
    const RP_RANGE = 30.0;

    const charName = (p) => {
        try { if (p.char && p.char.name) return p.char.name; } catch (e) { /* ignore */ }
        return p.name || 'Игрок';
    };

    const broadcastRp = (player, text) => {
        try {
            const v = player.position;
            player.outputChatBox(text);
            mp.players.forEach((p) => {
                try {
                    if (p === player || !p.position) return;
                    const dx = p.position.x - v.x;
                    const dy = p.position.y - v.y;
                    const dz = p.position.z - v.z;
                    if (dx * dx + dy * dy + dz * dz <= RP_RANGE * RP_RANGE) p.outputChatBox(text);
                } catch (e) { /* ignore */ }
            });
        } catch (e) { /* ignore */ }
    };

    mp.events.addCommand('me', (player, _, ...rest) => {
        const text = (rest.join(' ') || '').trim();
        if (!text) { player.outputChatBox('!{FF4444}Использование: /me [действие]'); return; }
        broadcastRp(player, `!{F5A742}* ${charName(player)} ${text}`);
    });

    mp.events.addCommand('do', (player, _, ...rest) => {
        const text = (rest.join(' ') || '').trim();
        if (!text) { player.outputChatBox('!{FF4444}Использование: /do [описание]'); return; }
        broadcastRp(player, `!{9FB8E8}(${charName(player)}) ${text}`);
    });

    mp.events.addCommand('try', (player, _, ...rest) => {
        const text = (rest.join(' ') || '').trim();
        if (!text) { player.outputChatBox('!{FF4444}Использование: /try [действие]'); return; }
        const ok = Math.random() < 0.5;
        broadcastRp(player, `!{F5A742}* ${charName(player)} ${text} — ${ok ? '!{62FF62}успешно' : '!{FF6262}неудачно'}`);
    });

    mp.events.addCommand('roll', (player, _, argMax) => {
        let max = parseInt(argMax, 10);
        if (isNaN(max) || max < 2 || max > 1000) max = 100;
        const r = 1 + Math.floor(Math.random() * max);
        broadcastRp(player, `!{F5A742}* ${charName(player)} бросает кость (1-${max}): !{FFFFFF}${r}`);
    });
};
