// ---------- Редактор персонажа (браузерная часть CEF) ----------
(function () {
    // Пол-зависимые пределы одежды (freemode)
    const LIMITS = {
        male: { top: 281, pants: 108, shoes: 88, undershirt: 32, arms: 48, accessory: 130, hair: 73 },
        female: { top: 262, pants: 122, shoes: 88, undershirt: 32, arms: 46, accessory: 125, hair: 73 }
    };

    // [key, label, min, max, step, group]
    const SLIDERS = [
        { key: 'preset', label: 'Лицо — пресет', min: 0, max: 9, step: 1, group: 'Лицо' },
        { key: 'skin', label: 'Тон кожи', min: 0, max: 9, step: 1, group: 'Лицо' },
        { key: 'feat0', label: 'Нос — ширина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat1', label: 'Нос — переносица', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat2', label: 'Нос — длина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat3', label: 'Нос — изгиб кости', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat4', label: 'Нос — кончик', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat5', label: 'Нос — искривление', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat6', label: 'Брови — высота', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat7', label: 'Брови — глубина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat8', label: 'Скулы — высота', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat9', label: 'Скулы — ширина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat10', label: 'Щёки — ширина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat11', label: 'Глаза — разрез', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat12', label: 'Губы — полнота', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat13', label: 'Челюсть — ширина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat14', label: 'Челюсть — высота', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat15', label: 'Подбородок — длина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat16', label: 'Подбородок — положение', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat17', label: 'Подбородок — ширина', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat18', label: 'Подбородок — форма', min: -1, max: 1, step: 0.02, group: 'Лицо' },
        { key: 'feat19', label: 'Шея — толщина', min: -1, max: 1, step: 0.02, group: 'Лицо' },

        { key: 'hair', label: 'Причёска', min: 0, max: 73, step: 1, group: 'Причёска' },
        { key: 'hairColor', label: 'Цвет волос', min: 0, max: 63, step: 1, group: 'Причёска' },
        { key: 'hairHighlight', label: 'Мелирование', min: 0, max: 63, step: 1, group: 'Причёска' },
        { key: 'eyes', label: 'Цвет глаз', min: 0, max: 31, step: 1, group: 'Причёска' },

        { key: 'ov0', label: 'Дефекты кожи', min: 0, max: 23, step: 1, group: 'Причёска' },
        { key: 'ov0o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov1', label: 'Борода', min: 0, max: 28, step: 1, group: 'Причёска' },
        { key: 'ov1o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov2', label: 'Брови', min: 0, max: 33, step: 1, group: 'Причёска' },
        { key: 'ov2o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov3', label: 'Старение', min: 0, max: 14, step: 1, group: 'Причёска' },
        { key: 'ov3o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov4', label: 'Макияж', min: 0, max: 74, step: 1, group: 'Причёска' },
        { key: 'ov4o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov5', label: 'Румянец', min: 0, max: 6, step: 1, group: 'Причёска' },
        { key: 'ov5o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov6', label: 'Цвет лица', min: 0, max: 11, step: 1, group: 'Причёска' },
        { key: 'ov6o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov7', label: 'Загар', min: 0, max: 10, step: 1, group: 'Причёска' },
        { key: 'ov7o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov8', label: 'Веснушки / родинки', min: 0, max: 17, step: 1, group: 'Причёска' },
        { key: 'ov8o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },
        { key: 'ov9', label: 'Волосы на груди', min: 0, max: 16, step: 1, group: 'Причёска' },
        { key: 'ov9o', label: '… плотность', min: 0, max: 1, step: 0.05, group: 'Причёска' },

        { key: 'top', label: 'Верх (стиль)', min: 0, max: 281, step: 1, group: 'Одежда' },
        { key: 'topT', label: 'Верх (цвет)', min: 0, max: 9, step: 1, group: 'Одежда' },
        { key: 'undershirt', label: 'Майка / подклад', min: 0, max: 32, step: 1, group: 'Одежда' },
        { key: 'undershirtT', label: 'Майка (цвет)', min: 0, max: 9, step: 1, group: 'Одежда' },
        { key: 'arms', label: 'Торс / руки (15 = голый торс)', min: 0, max: 48, step: 1, group: 'Одежда' },
        { key: 'armsT', label: 'Торс (цвет)', min: 0, max: 9, step: 1, group: 'Одежда' },
        { key: 'pants', label: 'Штаны (стиль)', min: 0, max: 108, step: 1, group: 'Одежда' },
        { key: 'pantsT', label: 'Штаны (цвет)', min: 0, max: 9, step: 1, group: 'Одежда' },
        { key: 'shoes', label: 'Обувь', min: 0, max: 88, step: 1, group: 'Одежда' },
        { key: 'shoesT', label: 'Обувь (цвет)', min: 0, max: 9, step: 1, group: 'Одежда' },
        { key: 'accessory', label: 'Аксессуары', min: 0, max: 130, step: 1, group: 'Одежда' },
        { key: 'accessoryT', label: 'Аксессуары (цвет)', min: 0, max: 9, step: 1, group: 'Одежда' }
    ];

    // Тату: колодка mp_scripted_tattoos
    const TATTOO_LIST = [
        ['', 'Без тату'],
        ['SKULL_1', 'Череп — грудь'], ['SKULL_2', 'Череп — спина'], ['SKULL_3', 'Череп — правая рука'], ['SKULL_4', 'Череп — левая рука'],
        ['WINGS_1', 'Крылья — спина'], ['WINGS_2', 'Крылья — грудь'], ['WINGS_3', 'Крылья — левая рука'], ['WINGS_4', 'Крылья — правая рука'],
        ['SNAKE_1', 'Змея — спина'], ['SNAKE_2', 'Змея — грудь'], ['SNAKE_3', 'Змея — левая рука'], ['SNAKE_4', 'Змея — правая рука'],
        ['GUNS_1', 'Оружие — грудь'], ['GUNS_2', 'Оружие — правая рука'], ['GUNS_3', 'Оружие — левая рука'], ['GUNS_4', 'Оружие — спина'],
        ['ROSE_1', 'Роза — грудь'], ['ROSE_2', 'Роза — правая рука'], ['ROSE_3', 'Роза — левая рука'],
        ['EAGLE_1', 'Орёл — спина'], ['EAGLE_2', 'Орёл — правая рука'], ['EAGLE_3', 'Орёл — левая рука'],
        ['DRAGON_1', 'Дракон — спина'], ['DRAGON_2', 'Дракон — грудь'], ['DRAGON_3', 'Дракон — правая рука'],
        ['CROSS_1', 'Крест — спина'], ['CROSS_2', 'Крест — грудь'], ['CROSS_3', 'Крест — правая рука'], ['CROSS_4', 'Крест — левая рука'],
        ['ANCHOR_1', 'Якорь — грудь'], ['ANCHOR_2', 'Якорь — правая рука'], ['ANCHOR_3', 'Якорь — левая рука'],
        ['SHIP_1', 'Корабль — грудь'], ['SHIP_2', 'Корабль — правая рука'], ['SHIP_3', 'Корабль — спина'],
        ['BLADE_1', 'Клинок — спина'], ['BLADE_2', 'Клинок — грудь'], ['BLADE_3', 'Клинок — правая рука'], ['BLADE_4', 'Клинок — левая рука'],
        ['LION_1', 'Лев — спина'], ['LION_2', 'Лев — грудь'], ['LION_3', 'Лев — правая рука'],
        ['SPIDER_1', 'Паук — спина'], ['SPIDER_2', 'Паук — грудь'], ['SPIDER_3', 'Паук — левая рука'],
        ['EYE_1', 'Глаз — спина'], ['EYE_2', 'Глаз — грудь'], ['EYE_3', 'Глаз — правая рука'],
        ['SHARK_1', 'Акула — спина'], ['SHARK_2', 'Акула — правая рука'], ['SHARK_3', 'Акула — левая рука'],
        ['BIRD_1', 'Птица — спина'], ['BIRD_2', 'Птица — грудь'], ['BIRD_3', 'Птица — левая рука'],
        ['KING_1', 'Король — грудь'], ['KING_2', 'Король — спина'], ['QUEEN_1', 'Королева — грудь'], ['QUEEN_2', 'Королева — спина'],
        ['CLOWN_1', 'Клоун — спина'], ['CLOWN_2', 'Клоун — грудь'], ['ROCKET_1', 'Ракета — правая рука'],
        ['FLAG_1', 'Флаг — спина'], ['DOG_1', 'Собака — спина'], ['DOG_2', 'Собака — грудь'], ['RABBIT_1', 'Кролик — спина'],
        ['ANGEL_1', 'Ангел — спина'], ['ANGEL_2', 'Ангел — грудь'], ['ANGEL_3', 'Ангел — правая рука'], ['ANGEL_4', 'Ангел — левая рука']
    ];

    const faceIdx = {};
    SLIDERS.forEach(function (s) { if (s.key.indexOf('feat') === 0) faceIdx[s.key] = Number(s.key.replace('feat', '')); });

    const state = {
        gender: 0,
        name: '',
        headBlend: {
            shapeFirst: 2, shapeSecond: 2, shapeThird: 0,
            skinFirst: 2, skinSecond: 2, skinThird: 0,
            shapeMix: 1, skinMix: 1, thirdMix: 0
        },
        face: new Array(20).fill(0),
        overlays: new Array(10).fill(0).map(function () { return { s: 0, o: 0 }; }),
        hair: { style: 0, colorId: 0, highlight: 0 },
        eyes: 0,
        clothes: {
            top: { d: 0, t: 0 }, pants: { d: 0, t: 0 }, shoes: { d: 0, t: 0 },
            undershirt: { d: 0, t: 0 }, arms: { d: 0, t: 0 }, accessory: { d: 0, t: 0 }
        },
        tattoo: null
    };

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
        state.headBlend.shapeFirst = state.preset;
        state.headBlend.shapeSecond = state.preset;
        state.headBlend.skinFirst = state.skin;
        state.headBlend.skinSecond = state.skin;
    }

    function genderLimits() {
        return state.gender === 1 ? LIMITS.female : LIMITS.male;
    }

    function applySlider(key, v) {
        v = Math.round(v * 100) / 100;
        const val = document.getElementById('val-' + key);
        if (val) val.textContent = String(v);
        if (key === 'preset') state.preset = v;
        else if (key === 'skin') state.skin = v;
        else if (key === 'hair') state.hair.style = v;
        else if (key === 'hairColor') state.hair.colorId = v;
        else if (key === 'hairHighlight') state.hair.highlight = v;
        else if (key === 'eyes') state.eyes = v;
        else if (key.indexOf('ov') === 0) {
            const isDensity = key.charAt(key.length - 1) === 'o';
            const num = Number(key.replace(/o$/, '').slice(2));
            if (!isNaN(num)) {
                if (isDensity) state.overlays[num].o = v;
                else state.overlays[num].s = v;
            }
        } else if (key.indexOf('feat') === 0 && faceIdx[key] != null) {
            state.face[faceIdx[key]] = v;
        } else {
            const isTex = key.charAt(key.length - 1) === 'T';
            const sub = isTex ? key.slice(0, -1) : key;
            const item = state.clothes[sub];
            if (item) {
                if (isTex) item.t = v;
                else item.d = v;
            }
        }
    }

    function build() {
        const wrap = document.getElementById('sliders');
        wrap.innerHTML = '';
        const groups = [];
        SLIDERS.forEach(function (spec) { if (groups.indexOf(spec.group) < 0) groups.push(spec.group); });
        groups.push('Тату');
        groups.forEach(function (g) {
            const sec = document.createElement('div');
            sec.className = 'group';
            const title = document.createElement('h3');
            title.textContent = g;
            sec.appendChild(title);
            const body = document.createElement('div');
            body.className = 'group-body';

            if (g === 'Тату') {
                const row = document.createElement('div');
                row.className = 'slider-row';
                const label = document.createElement('span');
                label.className = 'slider-label';
                label.textContent = 'Тату';
                const sel = document.createElement('select');
                sel.id = 'sel-tattoo';
                TATTOO_LIST.forEach(function (t) {
                    const o = document.createElement('option');
                    o.value = t[0];
                    o.textContent = t[1];
                    sel.appendChild(o);
                });
                sel.addEventListener('change', function () {
                    const ov = sel.value;
                    state.tattoo = ov ? { collection: 'mp_scripted_tattoos', overlay: ov } : null;
                    sendPreview();
                });
                row.appendChild(label);
                row.appendChild(sel);
                body.appendChild(row);
                sec.appendChild(body);
                wrap.appendChild(sec);
                return;
            }

            SLIDERS.forEach(function (spec) {
                if (spec.group !== g) return;
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

                input.addEventListener('input', (function (key) {
                    return function () {
                        applySlider(key, Number(input.value));
                        applyPreset();
                        sendPreview();
                    };
                })(spec.key));

                row.appendChild(label);
                row.appendChild(input);
                row.appendChild(val);
                body.appendChild(row);
            });
            sec.appendChild(body);
            wrap.appendChild(sec);
        });
    }

    // Обновить максимумы ползунков одежды под пол (и подрезать значения)
    function syncGenderUI() {
        const lim = genderLimits();
        SLIDERS.forEach(function (spec) {
            let max = null;
            if (spec.key === 'top') max = lim.top;
            else if (spec.key === 'pants') max = lim.pants;
            else if (spec.key === 'shoes') max = lim.shoes;
            else if (spec.key === 'undershirt') max = lim.undershirt;
            else if (spec.key === 'arms') max = lim.arms;
            else if (spec.key === 'accessory') max = lim.accessory;
            else if (spec.key === 'hair') max = lim.hair;
            if (max == null) return;
            const input = document.querySelector('input[data-key="' + spec.key + '"]');
            if (!input) return;
            input.max = String(max);
            let v = Number(input.value);
            if (v > max) {
                v = max;
                input.value = String(v);
                applySlider(spec.key, v);
            }
        });
    }

    function setGender(g) {
        if (state.gender === g) return;
        state.gender = g;
        document.getElementById('btn-male').classList.toggle('active', g === 0);
        document.getElementById('btn-female').classList.toggle('active', g === 1);
        applyPreset();
        syncGenderUI();
        sendPreview();
    }

    const itemOf = function (v) {
        if (v && typeof v === 'object') return { d: Number(v.d) || 0, t: Number(v.t) || 0 };
        return { d: Number(v) || 0, t: 0 };
    };
    const clamp01 = function (v) { v = Number(v); if (isNaN(v)) return 0; return Math.max(0, Math.min(1, v)); };

    window.prefill = function (data) {
        if (!data) return;
        if (data.name) document.getElementById('inp-name').value = String(data.name);

        const app = data.appearance || {};
        const hb = app.headBlend || state.headBlend;
        const hair = app.hair || state.hair;

        state.gender = data.gender === 1 ? 1 : 0;
        document.getElementById('btn-male').classList.toggle('active', state.gender === 0);
        document.getElementById('btn-female').classList.toggle('active', state.gender === 1);

        state.preset = hb.shapeFirst || 0;
        state.skin = hb.skinFirst || 0;
        state.face = (Array.isArray(app.face) ? app.face : state.face).slice(0, 20);
        while (state.face.length < 20) state.face.push(0);
        for (let i = 0; i < 20; i++) { const fv = Number(state.face[i]); state.face[i] = isNaN(fv) ? 0 : Math.max(-1, Math.min(1, fv)); }
        state.hair = { style: hair.style || 0, colorId: hair.colorId || 0, highlight: hair.highlight || 0 };
        state.eyes = app.eyes || 0;

        const cl = app.clothes || {};
        state.clothes = {
            top: itemOf(cl.top), pants: itemOf(cl.pants), shoes: itemOf(cl.shoes),
            undershirt: itemOf(cl.undershirt), arms: itemOf(cl.arms), accessory: itemOf(cl.accessory)
        };

        state.overlays = new Array(10).fill(0).map(function () { return { s: 0, o: 0 }; });
        if (Array.isArray(app.overlays)) {
            app.overlays.forEach(function (ov, i) {
                if (i >= 10 || !ov) return;
                state.overlays[i] = { s: Number(ov.s) || 0, o: clamp01(Number(ov.o)) };
            });
        }

        state.tattoo = null;
        if (app.tattoo && app.tattoo.collection && app.tattoo.overlay) {
            state.tattoo = { collection: String(app.tattoo.collection), overlay: String(app.tattoo.overlay) };
        }

        SLIDERS.forEach(function (s) {
            const input = document.querySelector('input[data-key="' + s.key + '"]');
            if (!input) return;
            let v = 0;
            if (s.key === 'preset') v = state.preset;
            else if (s.key === 'skin') v = state.skin;
            else if (s.key === 'hair') v = state.hair.style;
            else if (s.key === 'hairColor') v = state.hair.colorId;
            else if (s.key === 'hairHighlight') v = state.hair.highlight;
            else if (s.key === 'eyes') v = state.eyes;
            else if (s.key.indexOf('ov') === 0) {
                const num = Number(s.key.replace(/o$/, '').slice(2));
                const item = state.overlays[num] || { s: 0, o: 0 };
                v = s.key.charAt(s.key.length - 1) === 'o' ? item.o : item.s;
            } else if (s.key.indexOf('feat') === 0 && faceIdx[s.key] != null) {
                v = state.face[faceIdx[s.key]];
            } else {
                const isTex = s.key.charAt(s.key.length - 1) === 'T';
                const sub = isTex ? s.key.slice(0, -1) : s.key;
                const item = state.clothes[sub] || { d: 0, t: 0 };
                v = isTex ? item.t : item.d;
            }
            input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), Number(v) || 0)));
            const val = document.getElementById('val-' + s.key);
            if (val) val.textContent = String(Number(input.value));
        });

        const sel = document.getElementById('sel-tattoo');
        if (sel) sel.value = state.tattoo ? state.tattoo.overlay : '';

        applyPreset();
        syncGenderUI();
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