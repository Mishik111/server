// ---------- Казино (клиент): маркер, HUD баланса, интерфейс по клавише E ----------
const CASINO_POS = new mp.Vector3(936.0, 44.0, 80.0);
const CASINO_RADIUS = 25.0;

let casinoBrowser = null;
let casinoMoney = 0;
let casinoChips = 0;

try {
    mp.blips.new(439, CASINO_POS, { name: 'Казино', color: 67, scale: 0.9 });
} catch (e) { /* ignore */ }

const casinoClose = () => {
    if (casinoBrowser) {
        try { casinoBrowser.destroy(); } catch (e) { /* ignore */ }
        casinoBrowser = null;
    }
    try { mp.gui.cursor.show(false, false); } catch (e) { /* ignore */ }
};

mp.events.add('casino:update', (money, chips) => {
    casinoMoney = money;
    casinoChips = chips;
    if (casinoBrowser) {
        try {
            casinoBrowser.execute('window.__casinoUpdate(' + JSON.stringify({ money: money, chips: chips }) + ')');
        } catch (e) { /* ignore */ }
    }
});

mp.events.add('casino:result', (payloadJson) => {
    if (casinoBrowser) {
        try { casinoBrowser.execute('window.__casinoResult(' + payloadJson + ')'); } catch (e) { /* ignore */ }
    }
});

// Клавиша E — открыть/закрыть интерфейс казино у маркера
mp.keys.bind(0x45, true, () => { // 0x45 = E
    try {
        let typing = false;
        try { typing = !!mp.players.local.isTypingInChat; } catch (e) { typing = false; }
        if (!typing) { try { typing = mp.gui.chat.active === true; } catch (e2) { typing = false; } }
        if (typing) return;
        const p = mp.players.local.position;
        if (Math.hypot(p.x - CASINO_POS.x, p.y - CASINO_POS.y) > CASINO_RADIUS) return;
        if (casinoBrowser) { casinoClose(); return; }
        try {
            casinoBrowser = mp.browsers.new('package://casino/index.html');
        } catch (e) { casinoClose(); return; }
        try { mp.gui.cursor.show(true, true); } catch (e) { /* ignore */ }
        mp.events.callRemote('casino:sync');
        setTimeout(() => {
            try {
                if (casinoBrowser) {
                    casinoBrowser.execute('window.__casinoUpdate(' + JSON.stringify({ money: casinoMoney, chips: casinoChips }) + ')');
                }
            } catch (e) { /* ignore */ }
        }, 300);
    } catch (e) { /* ignore */ }
});

// ESC — закрыть интерфейс
mp.keys.bind(0x1B, true, () => {
    if (casinoBrowser) casinoClose();
});

mp.events.add('casino:close', casinoClose);

// Запросы из CEF
mp.events.add('casino:exchange', (type, amount) => {
    mp.events.callRemote('casino:exchange', type, parseInt(amount, 10) || 0);
});
mp.events.add('casino:bet', (game, payloadJson) => {
    mp.events.callRemote('casino:bet', game, payloadJson);
});

// ---------- Рендер: маркер зоны и HUD баланса ----------
const drawTextRow = (x, y, text, color, scale) => {
    try {
        const ui = mp.game.ui;
        if (typeof ui.setTextEntry === 'function') ui.setTextEntry('STRING');
        if (typeof ui.addTextComponentSubstringPlayerName === 'function') ui.addTextComponentSubstringPlayerName(String(text));
        if (typeof ui.setTextScale === 'function') ui.setTextScale(scale, scale);
        if (typeof ui.setTextColour === 'function') ui.setTextColour(color[0], color[1], color[2], color[3]);
        if (typeof ui.setTextFont === 'function') ui.setTextFont(0);
        if (typeof ui.setTextEdge === 'function') ui.setTextEdge(1, 0, 0, 0, 255);
        if (typeof ui.setTextCentre === 'function') ui.setTextCentre(true);
        else if (typeof ui.setTextJustification === 'function') ui.setTextJustification(0);
        if (typeof ui.drawText === 'function') ui.drawText(x, y);
    } catch (e) { /* ignore */ }
};

mp.events.add('render', () => {
    try {
        const me = mp.players.local;
        const p = me.position;
        const dx = p.x - CASINO_POS.x, dy = p.y - CASINO_POS.y, dz = p.z - CASINO_POS.z;
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 <= 80 * 80) {
            mp.game.graphics.drawMarker(4, CASINO_POS.x, CASINO_POS.y, CASINO_POS.z + 0.02, 0, 0, 0, 0, 0, 0, 12, 12, 0.4, 120, 255, 80, 120, false, false, 2, false, null, null, false);
            if (dist2 <= CASINO_RADIUS * CASINO_RADIUS) {
                mp.game.graphics.drawMarker(4, CASINO_POS.x, CASINO_POS.y, CASINO_POS.z + 0.05, 0, 0, 0, 0, 0, 0, 2.2, 2.2, 0.3, 120, 255, 80, 220, false, false, 2, false, null, null, false);
            }
        }
        // HUD баланса теперь через CEF (hud/index.html)
    } catch (e) { /* ignore */ }
});