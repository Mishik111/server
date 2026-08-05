// ---------- CEF: интерфейс посадки в тюрьму ----------
// Форма: id, причина, время (>50 мин), комментарий.
// Подходящие игроки (наручники + розыск) приходят с сервера списком — клик заполняет id.
let quickPlayers = [];

if (typeof mp !== 'undefined' && mp.trigger) {
    mp.trigger('jailCef:ready');
}

window.__jailInit = function (payload) {
    try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
        quickPlayers = (data && data.players) || [];
    } catch (e) {
        quickPlayers = [];
    }
    renderQuick();
    if (quickPlayers.length === 1 && !document.getElementById('f-id').value) {
        document.getElementById('f-id').value = quickPlayers[0][0];
    }
};

function renderQuick() {
    const box = document.getElementById('quick');
    if (!quickPlayers.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = '';
    quickPlayers.forEach(function (p) {
        const row = document.createElement('div');
        row.className = 'prow';
        row.innerHTML = '<span>#' + p[0] + '  ' + String(p[1]).replace(/[<>&"]/g, '') + '</span><span class="st">' + (p[2] || 0) + ' зв.</span>';
        row.title = 'Нажмите, чтобы вставить ID';
        row.onclick = function () {
            document.getElementById('f-id').value = p[0];
            document.getElementById('err').textContent = '';
        };
        box.appendChild(row);
    });
}

function showErr(msg) {
    document.getElementById('err').textContent = msg;
}

function submit() {
    const id = parseInt(document.getElementById('f-id').value, 10);
    const minutes = parseInt(document.getElementById('f-min').value, 10);
    const reason = document.getElementById('f-reason').value.trim();
    const comment = document.getElementById('f-comment').value.trim();
    if (!Number.isInteger(id) || id < 1) { showErr('Укажите корректный ID игрока'); return; }
    if (!Number.isInteger(minutes) || minutes <= 50) { showErr('Время должно быть больше 50 минут'); return; }
    if (minutes > 1440) { showErr('Максимальный срок — 1440 минут'); return; }
    if (typeof mp !== 'undefined' && mp.trigger) {
        mp.trigger('jailCef:submit', String(id), String(minutes), reason, comment);
    }
}

document.getElementById('btn-jail').onclick = submit;
document.getElementById('btn-close').onclick = function () {
    if (typeof mp !== 'undefined' && mp.trigger) mp.trigger('jailCef:close');
};

document.addEventListener('keydown', function (e) {
    var key = (typeof e.keyCode === 'number') ? e.keyCode : (e.which || 0);
    if (key === 13) { e.preventDefault(); submit(); }
    else if (key === 27) {
        e.preventDefault();
        if (typeof mp !== 'undefined' && mp.trigger) mp.trigger('jailCef:close');
    }
});