// ---------- Редактор персонажа (браузерная часть CEF) ----------
(function () {
    const SLIDERS = [
        { key: 'preset', label: 'Лицо (пресет)', min: 0, max: 9, step: 1 },
        { key: 'skin', label: 'Тон кожи', min: 0, max: 9, step: 1 },
        { key: 'hair', label: 'Причёска', min: 0, max: 30, step: 1 },
        { key: 'hairColor', label: 'Цвет волос', min: 0, max: 63, step: 1 },
        { key: 'top', label: 'Футболка / верх', min: 0, max: 30, step: 1 },
        { key: 'pants', label: 'Штаны', min: 0, max: 30, step: 1 },
        { key: 'shoes', label: 'Обувь', min: 0, max: 30, step: 1 },
        { key: 'feat0', label: 'Нос — ширина', min: -1, max: 1, step: 0.05 },
        { key: 'feat2', label: 'Нос — длина', min: -1, max: 1, step: 0.05 },
        { key: 'feat8', label: 'Скулы — высота', min: -1, max: 1, step: 0.05 },
        { key: 'feat9', label: 'Скулы — ширина', min: -1, max: 1, step: 0.05 },
        { key: 'feat13', label: 'Челюсть', min: -1, max: 1, step: 0.05 },
        { key: 'feat15', label: 'Подбородок', min: -1, max: 1, step: 0.05 }
    ];

    const state = {
        gender: 0,
        name: '',
        headBlend: {
            shapeFirst: 2, shapeSecond: 2, shapeThird: 0,
            skinFirst: 2, skinSecond: 2, skinThird: 0,
            shapeMix: 1, skinMix: 1, thirdMix: 0
        },
        face: new Array(20).fill(0),
        hair: { style: 0, colorId: 0, highlight: 0 },
        eyes: 0,
        clothes: { top: 0, pants: 0, shoes: 0 }
    };

    const faceIdx = {};
    SLIDERS.forEach(function (s) { if (s.key.indexOf('feat') === 0) faceIdx[s.key] = Number(s.key.replace('feat', '')); });

    let errTimer = null;

    function showError(msg) {
        const el = document.getElementById('err');
        el.textContent = msg;
        el.style.display = 'block';
        if (errTimer) clearTimeout(errTimer);
        errTimer = setTimeout(function () { el.style.display = 'none'; }, 4000);
    }
    window.showError = showError;

    function sendPreview() {
        try { mp.trigger('char:preview', JSON.stringify(state)); } catch (e) { /* ignore */ }
    }

    function applyPreset() {
        const p = state.preset;
        const s = state.skin;
        state.headBlend.shapeFirst = p;
        state.headBlend.shapeSecond = p;
        state.headBlend.skinFirst = s;
        state.headBlend.skinSecond = s;
    }

    function build() {
        const wrap = document.getElementById('sliders');
        SLIDERS.forEach(function (spec) {
            const row = document.createElement('div');
            row.className = 'slider-row';

            const label = document.createElement('span');
            label.className = 'slider-label';
            label.textContent = spec.label;

            const val = document.createElement('span');
            val.className = 'slider-val';
            val.id = 'val-' + spec.key;

            const input = document.createElement('input');
            input.type = 'range';
            input.min = String(spec.min);
            input.max = String(spec.max);
            input.step = String(spec.step);
            input.value = String(spec.min === -1 ? 0 : spec.min);
            input.dataset.key = spec.key;

            input.addEventListener('input', function () {
                const v = Number(input.value);
                val.textContent = String(v);
                const key = input.dataset.key;
                if (key === 'preset') { state.preset = v; }
                else if (key === 'skin') { state.skin = v; }
                else if (key === 'hair') { state.hair.style = v; }
                else if (key === 'hairColor') { state.hair.colorId = v; }
                else if (key === 'top') { state.clothes.top = v; }
                else if (key === 'pants') { state.clothes.pants = v; }
                else if (key === 'shoes') { state.clothes.shoes = v; }
                else { state.face[faceIdx[key]] = v; }
                applyPreset();
                sendPreview();
            });

            row.appendChild(label);
            row.appendChild(input);
            row.appendChild(val);
            wrap.appendChild(row);
        });
    }

    function setGender(g) {
        if (state.gender === g) return;
        state.gender = g;
        document.getElementById('btn-male').classList.toggle('active', g === 0);
        document.getElementById('btn-female').classList.toggle('active', g === 1);
        applyPreset();
        sendPreview();
    }

    // Предзаполнение данными персонажа (режим /reset)
    window.prefill = function (data) {
        if (!data) return;
        if (data.name) document.getElementById('inp-name').value = String(data.name);

        const app = data.appearance || {};
        const hb = app.headBlend || state.headBlend;
        const hair = app.hair || state.hair;

        state.gender = data.gender === 1 ? 1 : 0;
        document.getElementById('btn-male').classList.toggle('active', state.gender === 0);
        document.getElementById('btn-female').classList.toggle('active', state.gender === 1);

        state.preset = hb.shapeFirst;
        state.skin = hb.skinFirst;
        state.face = (Array.isArray(app.face) ? app.face : state.face).slice(0, 20);
        while (state.face.length < 20) state.face.push(0);
                state.hair = { style: hair.style || 0, colorId: hair.colorId || 0, highlight: hair.highlight || 0 };
        state.eyes = app.eyes || 0;
        const cl = app.clothes || {};
        state.clothes = { top: cl.top || 0, pants: cl.pants || 0, shoes: cl.shoes || 0 };

        SLIDERS.forEach(function (s) {
            const input = document.querySelector('input[data-key="' + s.key + '"]');
            if (!input) return;
            let v = 0;
            if (s.key === 'preset') v = state.preset;
            else if (s.key === 'skin') v = state.skin;
            else if (s.key === 'hair') v = state.hair.style;
            else if (s.key === 'hairColor') v = state.hair.colorId;
            else if (s.key === 'top') v = state.clothes.top;
            else if (s.key === 'pants') v = state.clothes.pants;
            else if (s.key === 'shoes') v = state.clothes.shoes;
            else v = state.face[faceIdx[s.key]];
            input.value = String(v);
            const val = document.getElementById('val-' + s.key);
            if (val) val.textContent = String(v);
        });

        applyPreset();
        sendPreview();
    };

    function submit() {
        const name = String(document.getElementById('inp-name').value || '').trim();
        if (!/^[A-Za-zА-Яа-яЁё0-9_]{3,20}$/.test(name)) {
            showError('Имя: 3-20 символов, только буквы, цифры и _');
            return;
        }
        state.name = name;
        applyPreset();
        try { mp.trigger('char:create', JSON.stringify(state)); } catch (e) { /* ignore */ }
    }

    document.addEventListener('DOMContentLoaded', function () {
        build();
        document.getElementById('btn-male').addEventListener('click', function () { setGender(0); });
        document.getElementById('btn-female').addEventListener('click', function () { setGender(1); });
        document.getElementById('btn-submit').addEventListener('click', submit);
        document.getElementById('inp-name').addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') submit();
        });
        applyPreset();
        sendPreview();
        try { mp.trigger('char:ready'); } catch (e) { /* ignore */ }
    });
})();