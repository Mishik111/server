// ---------- Кастомный CEF-чат ----------
// Стандартный чат RAGE:MP скрыт; вместо него рисуется client_packages/chat/index.html.
// markAsChat(): входящие сообщения с сервера (outputChatBox / mp.gui.chat.push)
// RAGE:MP сам доставляет в страницу событиями chat:push / chat:clear / chat:activate / chat:show.
// Отправка/команды идут через mp.invoke('chatMessage' / 'command') — как из дефолтного чата,
// поэтому серверные addCommand и client-события playerCommand работают без изменений.

mp.gui.chat.show(false);

const chatBrowser = mp.browsers.new('package://chat/index.html');
chatBrowser.markAsChat();

let chatReady = false;
const chatPending = [];

mp.events.add('browserDomReady', (browser) => {
    if (browser !== chatBrowser) return;
    chatReady = true;
    const items = chatPending.splice(0);
    items.forEach((text) => {
        try { chatBrowser.execute('chatAPI.push(' + JSON.stringify(text) + ');'); } catch (e) { /* ignore */ }
    });
});

// Локальные сообщения из других клиентских модулей (cuff, admin, charcreator)
global.chatPush = (text) => {
    try {
        const t = String(text);
        if (chatReady) chatBrowser.execute('chatAPI.push(' + JSON.stringify(t) + ');');
        else chatPending.push(t);
    } catch (e) { /* ignore */ }
};

// T — открыть строку ввода. Дублируем на уровне игры: страница ловит клавишу сама
// (markAsChat), а этот бинд — подстраховка, если браузер не в фокусе.
// Вызов идемпотентный (openInput проверяет, что строка уже не открыта).
mp.keys.bind(0x54, true, () => { // 0x54 = T
    try { chatBrowser.execute('chatAPI.openInput();'); } catch (e) { /* ignore */ }
});

// Идёт ли сейчас набор текста в чате (флаг ставит сама CEF-страница
// через mp.invoke('setTypingInChatState', ...))
global.isChatTyping = () => {
    try {
        if (mp.players.local.isTypingInChat) return true;
    } catch (e) { /* ignore */ }
    try { if (mp.gui.chat.active === true) return true; } catch (e) { /* ignore */ }
    return false;
};
