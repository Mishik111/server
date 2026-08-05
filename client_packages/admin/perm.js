// ---------- CEF: меню полномочий ----------
let data = null; // { players: [[id, name]], cmds: [[cmd, label]], perms: { id: {cmd:true} } }
let selectedId = null;

if (typeof mp !== 'undefined' && mp.trigger) {
    mp.trigger('perm:ready');
}

window.__permInit = function (payload) {
    try {
        data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (e) {
        data = null;
    }
    if (!data) return;
    let preselect = null;
    const players = data.players || [];
    if (players.length > 0) {
        // Гл. админ (id=1) всегда первый — удобнее выбирать остальных
        const first = players.find(function (p) { return p[0] === 1; }) || players[0];
        preselect = first[0];
    }
    renderPlayers(preselect);
};

function renderPlayers(preselectId) {
    const box = document.getElementById('players');
    box.innerHTML = '';
    const players = data.players || [];
    players.forEach(function (p) {
        const row = document.createElement('div');
        row.className = 'prow';
        row.textContent = '#' + p[0] + '  ' + p[1];
        row.onclick = function () {
            selectedId = Number(p[0]);
            renderPlayers(selectedId);
            renderCmds();
        };
        if (selectedId != null && selectedId === Number(p[0])) row.classList.add('sel');
        box.appendChild(row);
    });
    if (selectedId == null) selectedId = preselectId != null ? Number(preselectId) : null;
    if (selectedId != null) renderCmds();
}

function renderCmds() {
    const box = document.getElementById('cmds');
    box.innerHTML = '';
    if (!data || selectedId == null) return;
    const cur = (data.perms && data.perms[String(selectedId)]) || {};
    (data.cmds || []).forEach(function (c) {
        const lab = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.cmd = c[0];
        cb.checked = !!cur[c[0]];
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(' ' + c[1]));
        box.appendChild(lab);
    });
}

document.getElementById('btn-save').onclick = function () {
    if (!data || selectedId == null) return;
    const result = {};
    document.querySelectorAll('#cmds input[type=checkbox]').forEach(function (cb) {
        if (cb.checked) result[cb.dataset.cmd] = true;
    });
    if (typeof mp !== 'undefined' && mp.trigger) {
        mp.trigger('perm:save', String(selectedId), JSON.stringify(result));
    }
};

document.getElementById('btn-close').onclick = function () {
    if (typeof mp !== 'undefined' && mp.trigger) {
        mp.trigger('perm:close');
    }
};