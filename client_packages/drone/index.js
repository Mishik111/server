let fpvActive = false;
let droneCam = null;
let currentPos = null;
let droneVelocity = { x: 0, y: 0, z: 0 };
let droneYaw = 0;
let dronePitch = 10;
let droneRoll = 0;
let battery = 100;
let batteryInterval = null;
let lastSyncTime = 0;
let droneBrowser = null;

const player = mp.players.local;

function closeDroneBrowser() {
    if (droneBrowser) {
        try { droneBrowser.destroy(); } catch (e) { /* ignore */ }
        droneBrowser = null;
    }
}

mp.events.add('drone:start', (droneId) => {
    fpvActive = true;
    battery = 100;
    droneVelocity = { x: 0, y: 0, z: 0 };

    try {
        const head = player.getHeading();
        droneYaw = head;
    } catch (e) {
        droneYaw = 0;
    }
    dronePitch = 10;
    droneRoll = 0;

    try {
        player.setVisible(false, true);
        player.freezePosition(true);
    } catch (e) { /* ignore */ }

    const pPos = player.position;
    currentPos = new mp.Vector3(pPos.x, pPos.y, pPos.z + 1.2);

    try {
        if (droneCam) {
            droneCam.destroy();
            droneCam = null;
        }
        droneCam = mp.cameras.new('default', currentPos, new mp.Vector3(dronePitch, droneRoll, droneYaw), 75);
        droneCam.setActive(true);
        mp.game.cam.renderScriptCams(true, false, 0, false, false);
    } catch (e) { /* ignore */ }

    closeDroneBrowser();
    try {
        droneBrowser = mp.browsers.new('package://drone/hud.html');
    } catch (e) {
        droneBrowser = null;
    }

    if (batteryInterval) clearInterval(batteryInterval);
    batteryInterval = setInterval(() => {
        if (!fpvActive) {
            clearInterval(batteryInterval);
            return;
        }
        battery -= 2;
        if (battery <= 0) {
            battery = 0;
            explodeDrone();
            try { chatPush('!{FF4444}[FPV] Батарея разряжена — авария!'); } catch (e) { /* ignore */ }
        }
    }, 2000);
});

function explodeDrone() {
    if (!fpvActive) return;
    fpvActive = false;

    if (batteryInterval) {
        clearInterval(batteryInterval);
        batteryInterval = null;
    }

    if (droneBrowser) {
        try { droneBrowser.execute('window.__triggerGlitch && window.__triggerGlitch()'); } catch (e) { /* ignore */ }
        setTimeout(closeDroneBrowser, 400);
    }

    try {
        if (droneCam) {
            droneCam.destroy();
            droneCam = null;
        }
        mp.game.cam.renderScriptCams(false, false, 0, false, false);
    } catch (e) { /* ignore */ }

    try {
        player.setVisible(true, true);
        player.freezePosition(false);
    } catch (e) { /* ignore */ }

    try {
        if (currentPos) {
            mp.events.callRemote('drone:serverExplode', currentPos.x, currentPos.y, currentPos.z);
        }
    } catch (e) { /* ignore */ }
}

function stopDroneFpv() {
    if (!fpvActive) return;
    fpvActive = false;

    if (batteryInterval) {
        clearInterval(batteryInterval);
        batteryInterval = null;
    }

    closeDroneBrowser();

    try {
        if (droneCam) {
            droneCam.destroy();
            droneCam = null;
        }
        mp.game.cam.renderScriptCams(false, false, 0, false, false);
    } catch (e) { /* ignore */ }

    try {
        player.setVisible(true, true);
        player.freezePosition(false);
    } catch (e) { /* ignore */ }

    try {
        mp.events.callRemote('drone:exit');
    } catch (e) { /* ignore */ }
}

mp.events.add('drone:stop', () => {
    if (fpvActive) {
        fpvActive = false;
        if (batteryInterval) {
            clearInterval(batteryInterval);
            batteryInterval = null;
        }
        closeDroneBrowser();
        try {
            if (droneCam) {
                droneCam.destroy();
                droneCam = null;
            }
            mp.game.cam.renderScriptCams(false, false, 0, false, false);
        } catch (e) { /* ignore */ }
        try {
            player.setVisible(true, true);
            player.freezePosition(false);
        } catch (e) { /* ignore */ }
    }
});

mp.events.add('drone:clientExplode', (x, y, z) => {
    try {
        mp.game.fire.addExplosion(x, y, z, 2, 12.0, true, false, 2.0);
        mp.game.fire.addExplosion(x, y, z, 8, 8.0, true, false, 1.0);
    } catch (e) { /* ignore */ }
});

mp.keys.bind(0x08, true, () => { // Backspace
    if (fpvActive) stopDroneFpv();
});

mp.keys.bind(0x45, true, () => { // E key
    if (fpvActive) {
        explodeDrone();
        try { chatPush('!{FF4444}[FPV] Дрон подорван по команде [E]!'); } catch (e) { /* ignore */ }
    }
});

mp.events.add('render', () => {
    if (!fpvActive || !currentPos || !droneCam) return;

    // 1. Mouse rotation handling (Yaw & Pitch)
    try {
        if (typeof mp.game.controls.disableControlAction === 'function') {
            mp.game.controls.disableControlAction(0, 1, true); // LOOK_LR
            mp.game.controls.disableControlAction(0, 2, true); // LOOK_UD
            
            let mouseX = 0;
            let mouseY = 0;
            if (typeof mp.game.controls.getDisabledControlValue === 'function') {
                mouseX = mp.game.controls.getDisabledControlValue(0, 1);
                mouseY = mp.game.controls.getDisabledControlValue(0, 2);
            } else if (typeof mp.game.controls.getDisabledControlNormal === 'function') {
                mouseX = mp.game.controls.getDisabledControlNormal(0, 1) * 15.0;
                mouseY = mp.game.controls.getDisabledControlNormal(0, 2) * 15.0;
            }

            const sensitivity = 0.15;
            droneYaw -= mouseX * sensitivity;
            dronePitch -= mouseY * sensitivity;
            dronePitch = Math.max(-85, Math.min(85, dronePitch));
        }
    } catch (e) { /* ignore */ }

    // 2. FPV Movement vectors
    const radYaw = droneYaw * (Math.PI / 180);
    const radPitch = dronePitch * (Math.PI / 180);
    const cosPitch = Math.cos(radPitch);

    const forward = {
        x: -Math.sin(radYaw) * cosPitch,
        y: Math.cos(radYaw) * cosPitch,
        z: Math.sin(radPitch)
    };
    const right = {
        x: Math.cos(radYaw),
        y: Math.sin(radYaw),
        z: 0
    };

    let targetVx = 0, targetVy = 0, targetVz = 0;
    let targetRoll = 0;

    let maxSpeed = 0.18;
    if (mp.game.controls.isControlPressed(0, 21)) maxSpeed = 0.42; // Shift
    if (mp.game.controls.isControlPressed(0, 19)) maxSpeed = 0.08; // Alt

    if (mp.game.controls.isControlPressed(0, 32)) { // W
        targetVx += forward.x * maxSpeed;
        targetVy += forward.y * maxSpeed;
        targetVz += forward.z * maxSpeed;
    }
    if (mp.game.controls.isControlPressed(0, 33)) { // S
        targetVx -= forward.x * maxSpeed;
        targetVy -= forward.y * maxSpeed;
        targetVz -= forward.z * maxSpeed;
    }
    if (mp.game.controls.isControlPressed(0, 34)) { // A
        targetVx -= right.x * maxSpeed;
        targetVy -= right.y * maxSpeed;
        targetRoll = -8.0;
    }
    if (mp.game.controls.isControlPressed(0, 35)) { // D
        targetVx += right.x * maxSpeed;
        targetVy += right.y * maxSpeed;
        targetRoll = 8.0;
    }
    if (mp.game.controls.isControlPressed(0, 22)) { // Space
        targetVz += maxSpeed * 0.8;
    }
    if (mp.game.controls.isControlPressed(0, 36)) { // Ctrl
        targetVz -= maxSpeed * 0.8;
    }

    // Smooth inertia
    droneVelocity.x += (targetVx - droneVelocity.x) * 0.08;
    droneVelocity.y += (targetVy - droneVelocity.y) * 0.08;
    droneVelocity.z += (targetVz - droneVelocity.z) * 0.08;
    droneRoll += (targetRoll - droneRoll) * 0.1;

    currentPos.x += droneVelocity.x;
    currentPos.y += droneVelocity.y;
    currentPos.z += droneVelocity.z;

    // Ground collision
    try {
        const groundZ = mp.game.gameplay.getGroundZFor3dCoord(currentPos.x, currentPos.y, currentPos.z + 2.0, 0, false);
        if (groundZ && currentPos.z <= groundZ + 0.3) {
            explodeDrone();
            return;
        }
    } catch (e) { /* ignore */ }

    // Update Camera & Telemetry
    try {
        droneCam.setCoord(currentPos.x, currentPos.y, currentPos.z);
        droneCam.setRot(dronePitch, droneRoll, droneYaw, 2);

        const now = Date.now();
        if (now - lastSyncTime > 120) {
            lastSyncTime = now;
            mp.events.callRemote('drone:updatePos', currentPos.x, currentPos.y, currentPos.z, dronePitch, droneRoll, droneYaw);
        }

        const vMagnitude = Math.sqrt(droneVelocity.x * droneVelocity.x + droneVelocity.y * droneVelocity.y + droneVelocity.z * droneVelocity.z);
        const currentSpeedKmh = Math.round(vMagnitude * 160);
        const alt = Math.round(currentPos.z);

        if (droneBrowser) {
            droneBrowser.execute(`window.__updateDrone(${currentSpeedKmh}, ${alt}, ${battery}, ${dronePitch.toFixed(1)}, ${droneRoll.toFixed(1)})`);
        }
    } catch (e) { /* ignore */ }
});
