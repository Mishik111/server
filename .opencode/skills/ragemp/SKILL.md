---
name: ragemp
description: Use when writing or debugging RAGE:MP Node.js code in this repo — server (packages/) and client (client_packages/) — or when asked how RAGE:MP functions/API work here. Explains entity pools, commands, permissions, natives, movement tasks, and known runtime pitfalls.
---

# RAGE:MP Node.js — как работают функции в этом проекте

Проект — GTA V фриролм на RAGE:MP. Два рантайма, оба JavaScript:

- **Сервер** (`packages/*/index.js`) — Node.js, полный доступ к миру,
  создаёт сущности, хранит состояние, базу данных (SQLite через
  `packages/freeroam/char-db.js`, sql-wasm).
- **Клиент** (`client_packages/`) — браузерный JS внутри игры, может только
  дёргать нативы GTA через `mp.game.invoke` и управлять локальным игроком.

Правки серверных файлов применяются рестартом сервера. Правки клиентских —
**только полным перезаходом игрока** (не рестартом).

## Серверная часть (Node.js)

### Пуллы и события

- Пуллы: `mp.players`, `mp.peds`, `mp.vehicles`, `mp.objects`, `mp.colshapes`…
- **`mp.entities` на сервере НЕ существует.** Любой вызов через него падает
  в `catch` — проверять «живость» сущности только через пулы:
  ```js
  const alive = mp.peds.toArray().indexOf(e) !== -1; // e.type === 'ped'
  ```
- События: `mp.events.add('playerReady'|'playerQuit'|'playerDeath'|'entityDestroy', ...)`,
  команды: `mp.events.addCommand('name', (player, fullText, arg1, ...rest) => {})`
  (в `packages/admin/index.js` команды обёрнуты: блокировка в тюрьме/наручниках
  и реестр `commandHandlers` для `/bind`).

### Создание сущностей

```js
const veh = mp.vehicles.new(mp.joaat('adder'), pos, { heading: 0, dimension: 0, numberPlate: 'ADMIN' });
veh.engine = true;                      // двигатель — свойством, НЕ в опциях (опцию `engine` рантайм не знает)
const ped = mp.peds.new(mp.joaat('a_m_y_hipster_01'), pos, { heading: 0, dimension: 0 });
ped.putIntoVehicle(veh, 0);             // ТОЛЬКО с задержкой: setTimeout(..., 250)
veh.destroy(); ped.destroy();           // удаление
```

Правила (проверены на рантайме, иначе молча падает):

- **Модель передаётся числовым хэшем `mp.joaat(name)`.** Строка
  (`mp.vehicles.new('adder', ...)`) типизированными типами разрешена,
  но эта версия рантайма её молча отбрасывает — машина не появится.
- `heading` и `dimension` — только в объекте-опциях, не позиционными.
- Посадка в машину сразу после создания не работает — нужен `setTimeout` 200–250 мс.
- Созданные на сервере педы/машины **видят все игроки** (в отличие от
  клиентских `mp.peds.new`, которые локальны для одного клиента).
- Удалённую сущность (`destroy()` у других систем) — учесть в своих пулах,
  чтобы не копить «зомби» (см. `/traffic` и `trafficSpawned`).

### Игроки и права

- ID игрока — `player.citizenId` (из БД), поиск `getPlayerById(id)`.
- Главный админ `HEAD_ADMIN_ID = 1`; права — `hasPerm(player, 'cmd')`,
  реестр `CMD_LABELS`; выдача прав — CEF `/perm` (`perm:sync` на клиенте).
- Кик: `player.kick('причина')` (в `/kick`, `packages/admin/index.js`).

### Телепорты/состояние

- `player.position = new mp.Vector3(x, y, z)` — работает и на незастримленного
  игрока, но **камера** за ним не едет: для `/spec` сервер шлёт позицию тиками
  (`spec:tick`), клиент интерполирует.
- `player.putIntoVehicle(veh, 0)` — тоже с таймаутом.

## Клиентская часть

### Где что

- `render` — каждый кадр: спидометр, отключение радио, множители тест-авто,
  спектатор, ноклип.
- `entityStreamIn` — сущность застримилась к игроку: навешиваем NPC задачи.
- `chatPush(text)` — сообщение в кастомный чат; `mp.gui.execute(...)` — вызов
  JS в CEF чата.
- CEF-страницы (`perm.html`, `jail.html`, `casino/`, `charcreator/`) —
  `browser.execute(...)` для вызова их JS с клиента.

### Нативы GTA

```js
mp.game.invoke('0xE054346CA3A0F315', ped.handle, x, y, z, 50, 0, 0); // TASK_WANDER_IN_AREA
mp.game.invoke('0x480142959D337D00', ped.handle, veh.handle, 30, 0); // TASK_VEHICLE_DRIVE_WANDER
```

- Хэш — **шестнадцатеричная строка** `'0x...'`.
- Сверить хэш по локальной базе: `C:\Users\rumos\AppData\Local\Temp\opencode\natives.js`
  (официальная `ndata` с cdn.rage.mp). Если натива нет в базе — его нет
  (например, `SET_ENTITY_ANGULAR_VELOCITY` — миф).
- `mp.game.joaat('model') >>> 0` — unsigned-хэш для сравнения с `entity.model`.

### Движение NPC (сервер их «шевелить» не умеет)

Сервер создаёт педов и машин; **задачи движения вешает клиент**, когда
сущность застримилась (`entityStreamIn`): пешеход — `TASK_WANDER_IN_AREA`,
водитель в авто — `TASK_VEHICLE_DRIVE_WANDER`. Водителя сажают в машину на
сервере с задержкой 250 мс, поэтому задача на клиенте пере-назначается
повторно через 400 мс (пед может застримиться раньше, чем окажется в авто).

## Известные подводные камни

1. `mp.entities.exists` — не существует → всё удаляется каждый тик (баг трафика).
2. Строковая модель в `mp.vehicles.new` — молча нет машин.
3. `engine: true` в опциях создания — молча нет машин; только `veh.engine = true`.
4. `putIntoVehicle` сразу после создания — не сажает; нужен таймаут.
5. Скорость >~150 м/с ломает синк — античит кикает «Corrupted packet flow»
   (кап тест-авто 120 м/с = 432 км/ч).
6. Клиентские файлы требуют полного перезахода игрока.
7. Проверка синтаксиса: `node --check packages/admin/index.js` и
   `node --check client_packages/admin/index.js`.
8. DLC-авто: модели монтируются через `client_packages/game_resources/dlcpacks/`
   (13 пакетов в `dlc.list`); наличие модели на клиенте проверять
   `veh:verify` / `mp.game.streaming.isModelInCdimage`.

## Процедура работы

1. Найти нужный файл (сервер `packages/`, клиент `client_packages/`).
2. Следовать конвенциям выше; скопировать образец из соседнего кода.
3. Проверить нативы по локальной базе `natives.js`.
4. `node --check` обоих файлов.
5. Сказать пользователю: рестарт сервера (серверные правки) и/или полный
   перезаход (клиентские правки).
