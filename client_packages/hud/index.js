// ---------- Main HUD Module (CEF) ----------
let hudBrowser = null;
let hudMoney = 0;
let hudChips = 0;
let myId = 1;

const player = mp.players.local;

function initHud() {
    if (!hudBrowser) {
        try {
            hudBrowser = mp.browsers.new('package://hud/index.html');
        } catch (e) {
            hudBrowser = null;
        }
    }
}

mp.events.add('playerReady', () => {
    initHud();
});

mp.events.add('casino:update', (money, chips) => {
    hudMoney = money;
    hudChips = chips;
    syncHud();
});

function syncHud() {
    if (!hudBrowser) initHud();
    if (!hudBrowser) return;

    try {
        const citizenId = player.getVariable('citizenId') || 1;
        const veh = player.vehicle;

        let inVeh = false;
        let speed = 0;
        let gearStr = 'N';
        let fuel = 100;

        if (veh && player.getHealth() > 0) {
            inVeh = true;
            speed = Math.round(Math.abs(veh.getSpeed() * 3.6));
            const g = veh.gear;
            if (g === 0 && Math.abs(veh.getSpeed()) > 0.5) gearStr = 'R';
            else if (g === 0) gearStr = 'N';
            else gearStr = 'D' + g;

            try { fuel = veh.getVariable('fuel'); } catch (e) { fuel = 100; }
            if (fuel == null) fuel = 100;
        }

        const payload = {
            id: citizenId,
            money: hudMoney,
            chips: hudChips,
            inVeh: inVeh,
            speed: speed,
            gear: gearStr,
            fuel: fuel
        };

        hudBrowser.execute('window.__updateHud(' + JSON.stringify(payload) + ')');
    } catch (e) { /* ignore */ }
}

// 100ms update loop for smooth speedometer and balance
setInterval(() => {
    syncHud();
}, 100);
