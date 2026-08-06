# RAGE:MP Freeroam Server (Node.js)

Приватный фриролм-сервер GTA V на RAGE:MP. Весь код — JavaScript (Node.js) на
сервере и клиенте, интерфейсы — CEF (HTML/CSS/JS).

## Запуск

```bash
RAGE.MP.Server.exe   # конфиг — conf.json (порт 22005, stream-distance 300)
```

- **Серверные пакеты** — `packages/*/index.js` (подхватываются автоматически).
- **Клиентские пакеты** — `client_packages/`, бандл собирает `client_packages/index.js`.
- Правки серверных файлов применяются рестартом сервера; **правки клиентских файлов —
  только полным перезаходом игрока в игру** (не рестартом сервера).

## Структура

```
packages/
  freeroam/index.js      Вход: авторизация, персонажи, старт, общие команды
  freeroam/char-db.js    SQLite (sql-wasm) — база персонажей/денег/фишек
  admin/index.js         Админ-модуль: команды, тюрьма, розыск, NPC-трафик, /perm
  admin/cuff.js          Наручники, поводок (/6 /7, /put)
  casino/index.js        Казино, дуэль костей (/bet /yes)
  rp/index.js            РП-действия (/me /do /try /roll)
client_packages/
  index.js               Бандл: подключает все модули ниже
  admin/index.js         Админ-клиент: спектатор, ноклип, трафик, спидометр, тест-авто
  admin/perm.html/.js    CEF-меню полномочий (/perm)
  admin/jail.html/.js    CEF-форма посадки в тюрьму (клавиша E у маркера)
  chat/index.html/.js    Кастомный CEF-чат: история команд, скролл, /bind
  nametags.js            Ручная отрисовка имён над головами
  cuff/index.js          Клиент наручников (анимации, скорость)
  casino/index.html/.js  CEF казино
  charcreator/           CEF создания персонажа (имя, внешность)
  game_resources/dlcpacks/  DLC-авто (13 пакетов) + dlc.list
conf.json                Порт, имя, stream-distance
```

## Идентификация игроков

- Внутренний ID игрока — `p.citizenId` (из БД), НЕ `p.id` RAGE:MP.
- Поиск: `getPlayerById(id)` в `packages/admin/index.js:2`.
- `HEAD_ADMIN_ID = 1` — главный админ, получает все права автоматически.
- Права: реестр `CMD_LABELS` + `hasPerm(player, cmd)` (`packages/admin/index.js:60`).
  Остальным админам права выдаёт главный админ через `/perm`.

## Команды (админ)

```
/veh [имя] [номер] /livery /color /cid /inc /fuel /repair /delveh /excar
/gun [имя] /kill [id] /kick [id] [причина] /freeze [id] /hp [кол-во] [id] /ar [кол-во] [id]
/sbiv [id] /god /noclip|/fly /invis /copypos /spec [id] /unspec /mtp /skin [id]
/6|/cuff [id] /7|/lead [id] /uncuff /unlead /put /vfly
/ajail [id] [мин] [причина] /unjail /dunjail /auncuff /star [id] [звёзды] /orm /unorm
/traffic [0-100] /trafic    NPC-трафик (серверный спавн, видят все)
/perm /reset /bind          меню прав; сброс персонажа; привязка клавиши к командам
```

Игроки: `/money /pay /bet /yes /casino /buy /sell /me /do /try /roll /respawn (R)`.

## Ключевые конвенции

1. **Создание сущностей на сервере** — только с числовым хэшем:
   ```js
   const veh = mp.vehicles.new(mp.joaat('adder'), pos, { heading: 0, dimension: 0 });
   veh.engine = true;                       // двигун — свойством, не в опциях
   const ped = mp.peds.new(mp.joaat('a_m_y_hipster_01'), pos, { heading: 0, dimension: 0 });
   ```
   Строку модели `mp.vehicles.new('adder', ...)` рантайм не принимает — молча падает.
2. **Посадка в машину** — не сразу после создания, нужен таймаут ~200–250 мс:
   `setTimeout(() => ped.putIntoVehicle(veh, 0), 250)` (см. `/veh`, трафик).
3. **Серверный `mp.entities` не существует** — проверять «живость» сущности
   через пулы: `mp.peds.toArray().indexOf(e) !== -1` (иначе все сущности удалятся
   в catch-обработчике).
4. **Серверные педы/машины видят все игроки**; клиентские `mp.peds.new` —
   только владельца клиента (для общего трафика спавн должен быть на сервере).
5. **Движение NPC** сервер не умеет — клиент навешивает задачи при стриме:
   `mp.events.add('entityStreamIn', ...)` + `mp.game.invoke('0xHASH', ...)`
   (`TASK_WANDER_IN_AREA = 0xE054346CA3A0F315`, `TASK_VEHICLE_DRIVE_WANDER = 0x480142959D337D00`).
6. **Нативы** проверять в локальной базе `C:\Users\rumos\AppData\Local\Temp\opencode\natives.js`
   (официальная ndata с cdn.rage.mp). Несуществующего натива (например,
   `SET_ENTITY_ANGULAR_VELOCITY`) в RAGE:MP нет.
7. **Команды** — `mp.events.addCommand` обёрнут в `packages/admin/index.js:36`:
   блокировка в тюрьме/наручниках + реестр `commandHandlers` для `/bind`.
8. **Скорости >150 м/с** (1000 км/ч) ломают синк — античит кикает
   «Corrupted packet flow»; кап тест-авто — 120 м/с.
9. **Проверка синтаксиса** после правок: `node --check packages/admin/index.js`.

## Полезное

- `/traffic [0-100]` — серверный спавн NPC: педы ходят, машины с водителями ездят;
  трафик следует за админом и живёт, пока плотность > 0.
- Тест-авто (модель `test`): множители двигателя ×50, кап 432 км/ч.
- В машинах отключено радио (`SET_VEHICLE_RADIO_ENABLED`).
- Спидометр (км/ч + передача + топливо) — справа снизу.
