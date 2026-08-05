// ---------- Создание персонажа при первом входе ----------
let charBrowser = null;
let charCamera = null;
let charActive = false;
let appliedGender = 0;
let previewSeq = 0;
let editorPrefill = null;

function scheduleOnce(fn, ms) {
    try { setTimeout(fn, ms); } catch (e) { /* таймер недоступен */ }
}

// Камера ставится перед лицом. Направление берём из текущей игровой камеры:
// она всегда сидит за спиной персонажа и смотрит туда же, куда он повёрнут,
// поэтому камера на +forward всегда видит лицо — без всяких конвенций «севера»
function placeCharCamera() {
    try {
        if (charCamera) { try { charCamera.destroy(); } catch (e) { /* ignore */ } charCamera = null; }
        const pos = mp.players.local.position;
        const rot = mp.game.cam.getGameplayCamRot(2);
        const cz = (rot && typeof rot.z === 'number' ? rot.z : 0) * (Math.PI / 180);
        const dx = -Math.sin(cz);
        const dy = Math.cos(cz);
        charCamera = mp.cameras.new('default', new mp.Vector3(pos.x + dx * 2.3, pos.y + dy * 2.3, pos.z + 0.8), new mp.Vector3(0, 0, 0), 50);
        charCamera.pointAt(new mp.Vector3(pos.x, pos.y, pos.z + 0.6));
        charCamera.setActive(true);
        mp.game.cam.renderScriptCams(true, false, 0, true, false);
    } catch (e) { /* камера не критична */ }
}

function setLocalModel(gender) {
    const model = gender === 1 ? 'mp_f_freemode_01' : 'mp_m_freemode_01';
    try {
        mp.players.local.model = mp.joaat(model);
        return;
    } catch (e) { /* fallback ниже */ }
    try {
        mp.game.invoke('0x00A1CADD00108836', mp.players.local.handle, mp.joaat(model));
    } catch (e) { /* ignore */ }
}

let appliedTattoo = null;

function applyLocalTattoo(t) {
    try {
        if (appliedTattoo) {
            try { mp.players.local.removeTattoo(appliedTattoo.collection, appliedTattoo.overlay); } catch (e) { /* ignore */ }
            appliedTattoo = null;
        }
    } catch (e) { /* ignore */ }
    if (t && t.collection && t.overlay) {
        try {
            mp.players.local.setTattoo(t.collection, t.overlay, 0);
            appliedTattoo = { collection: t.collection, overlay: t.overlay };
        } catch (e) { /* ignore */ }
    }
}

function applyLocalAppearance(state) {
    const local = mp.players.local;
    const ped = local.handle;
    const hb = state.headBlend;
    local.setHeadBlendData(hb.shapeFirst, hb.shapeSecond, hb.shapeThird, hb.skinFirst, hb.skinSecond, hb.skinThird, hb.shapeMix, hb.skinMix, hb.thirdMix, false);
    // Причёска в GTA V — это компонент 2 (freemode) + её цвет
    mp.game.ped.setComponentVariation(ped, 2, state.hair.style || 0, 0, 0);
    local.setHairColor(state.hair.colorId, state.hair.highlight);
    local.setEyeColor(state.eyes);

    // Одежда: все слоты + текстура (цвет/вариант). v может быть числом (старый формат) или {d,t}
    const c = state.clothes || {};
    const setClothesSlot = (slot, v) => {
        const d = (v && typeof v === 'object') ? (Number(v.d) || 0) : (Number(v) || 0);
        const t = (v && typeof v === 'object') ? (Number(v.t) || 0) : 0;
        try { mp.game.ped.setComponentVariation(ped, slot, d, t, 0); } catch (e) { /* ignore */ }
    };
    setClothesSlot(3, c.arms);       // руки / торс
    setClothesSlot(4, c.pants);      // штаны
    setClothesSlot(6, c.shoes);      // обувь
    setClothesSlot(7, c.accessory);  // аксессуары
    setClothesSlot(8, c.undershirt); // майка / подклад
    setClothesSlot(11, c.top);       // верх

    // Черты лица
    const face = state.face;
    for (let i = 0; i < face.length; i++) {
        const v = Number(face[i]) || 0;
        if (v !== 0) local.setFaceFeature(i, v);
    }

    // Оверлеи головы (борода, брови, макияж, родинки и т.п.); стиль 0 = выкл
    const ov = state.overlays || [];
    for (let i = 0; i < 10; i++) {
        const o = ov[i] || { s: 0, o: 0 };
        try {
            mp.game.ped.setPedHeadOverlay(ped, i, Number(o.s) || 0, Math.max(0, Math.min(1, Number(o.o) || 0)));
        } catch (e) { /* ignore */ }
    }

    // Тату
    applyLocalTattoo(state.tattoo || null);
}

function freezeLocalPlayer(freeze) {
    try {
        mp.game.invoke('0x428BDCB9DA58DA53', mp.players.local.handle, freeze);
    } catch (e) { /* ignore */ }
}

mp.events.add('char:openCreator', (prefillJson) => {
    if (charActive) return;
    charActive = true;
    appliedGender = 0;
    editorPrefill = null;
    if (prefillJson) {
        try { editorPrefill = JSON.parse(prefillJson); } catch (e) { editorPrefill = null; }
    }

    freezeLocalPlayer(true);
    try { mp.game.ui.displayHud(false); } catch (e) { /* ignore */ }
    mp.gui.cursor.show(true, true);

    try {
        if (charBrowser && typeof charBrowser.destroy === 'function') { try { charBrowser.destroy(); } catch (e) { /* ignore */ } }
        charBrowser = null;
        charBrowser = mp.browsers.new('package://charcreator/index.html');
    } catch (e) {
        chatPush('!{ff0000}Ошибка открытия редактора персонажа');
        charActive = false;
        try { mp.gui.cursor.show(false, false); } catch (e) { /* ignore */ }
        freezeLocalPlayer(false);
        try { mp.game.ui.displayHud(true); } catch (e) { /* ignore */ }
    }
});

// CEF сообщил, что страница загружена: камера (после того как игрок уже телепортирован) + предзаполнение
mp.events.add('char:ready', () => {
    if (!charCamera) {
        placeCharCamera();
    }
    if (editorPrefill && charBrowser) {
        charBrowser.execute(`prefill(${JSON.stringify(editorPrefill)})`);
    }
});

mp.events.add('char:preview', (json) => {
    if (!charActive) return;
    let s;
    try { s = JSON.parse(json); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;

    if (s.gender !== appliedGender) {
        appliedGender = s.gender;
        setLocalModel(s.gender);
        previewSeq++;
        const mySeq = previewSeq;
        scheduleOnce(() => {
            if (mySeq !== previewSeq) return;
            try { applyLocalAppearance(s); } catch (e) { /* ignore */ }
            placeCharCamera(); // модель сменилась — персонаж мог развернуться, переснимаем камеру
        }, 700);
    } else {
        try { applyLocalAppearance(s); } catch (e) { /* ignore */ }
    }
});

mp.events.add('char:create', (json) => {
    if (!charActive) return;
    let s;
    try { s = JSON.parse(json); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;

    const name = String(s.name || '').trim();
    if (name.length < 3 || name.length > 20) {
        if (charBrowser) charBrowser.execute("showError('Имя: от 3 до 20 символов')");
        return;
    }
    mp.events.callRemote('char:create', name, s.gender === 1 ? 1 : 0,
        JSON.stringify({ headBlend: s.headBlend, face: s.face, hair: s.hair, eyes: s.eyes, clothes: s.clothes }));
});

mp.events.add('char:error', (msg) => {
    if (charBrowser) charBrowser.execute(`showError(${JSON.stringify(String(msg))})`);
});

mp.events.add('char:done', () => {
    previewSeq++;
    if (charBrowser) { try { charBrowser.destroy(); } catch (e) { /* ignore */ } charBrowser = null; }
    if (charCamera) { try { charCamera.destroy(); } catch (e) { /* ignore */ } charCamera = null; }
    try { mp.game.cam.renderScriptCams(false, true, 0, true, false); } catch (e) { /* ignore */ }
    freezeLocalPlayer(false);
    try { mp.game.ui.displayHud(true); } catch (e) { /* ignore */ }
    try { mp.gui.cursor.show(false, false); } catch (e) { /* ignore */ }
    charActive = false;
});

// Возвращающийся игрок: применяем внешность на своей модели локально
mp.events.add('char:applyAppearance', (json) => {
    let s;
    try { s = JSON.parse(json); } catch (e) { return; }
    if (!s || typeof s !== 'object') return;
    const app = s.appearance && typeof s.appearance === 'object' ? s.appearance : s;
    appliedGender = s.gender;
    if (s.gender === 1) setLocalModel(1);
    previewSeq++;
    const mySeq = previewSeq;
    scheduleOnce(() => {
        if (mySeq !== previewSeq) return;
        try { applyLocalAppearance(app); } catch (e) { /* ignore */ }
    }, 900);
});