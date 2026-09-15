# heli-csv-tool

Консольна версія `heli-adapter (6).html` — та сама логіка (парсинг прайсу, дифф,
деривація battery/engine_type/тощо), але без браузера і без ручного копіювання.
В БД нічого не пише — тільки читає прайс + `items.csv` і виводить файли.

## Встановлення (один раз)

```
cd heli-csv-tool
npm install
```

## Щоденний запуск

1. Поклади свіжий файл прайсу в корінь репо (`E:\Repo\biz24`), назва має містити
   "heli" і "price" (напр. `heli prices.xls`, підійде .xls/.xlsx/.csv).
2. З папки `heli-csv-tool`:
   ```
   node generate.js
   ```
3. Дивись консоль:
   - **День-до-дня** — що з'явилось/зникло/змінилось порівняно з попереднім запуском
     (потребує snapshot з учора — з'явиться сам після другого запуску).
   - **Проти каталогу** — скільки моделей `new` (нема картки) / `changed` (картка є,
     спека відрізняється) / `unchanged`.
4. Забери файли з `out/`:
   - `new-cards-draft-<дата>.csv` — готовий до імпорту в Data.Imports (тільки
     new+changed рядки, формат `items.csv`).
   - `report-<дата>.csv` — повний статус по кожній моделі з прайсу.
   - `heli-feed-<дата>.xml` — той самий new+changed набір у XML (див. нижче).
5. `snapshots/<дата>.json` зберігається автоматично щоразу — це і є "вчора" для
   наступного запуску. Не видаляй без потреби.

## Параметри (за потреби)

```
node generate.js --prices "шлях/heli prices.xls" --catalog "шлях/items.csv" --sheet "Аркуш1" --outdir out
node generate.js --no-snapshot   # прогнати без збереження/читання знімка (напр. тестовий прогін)
```

Дефолтний пошук файлу прайсу бере найновіший `*heli*price*` або `*heli*stock*`
(.xls/.xlsx/.csv) у корені репо — підходить і під старий "heli prices.xls",
і під "HELI ... Stock List to Client.xlsx".

## Чому "new" не дублюється щодня

У прайсі кожен рядок має свій `Item` (унікальний номер партії/лота). Коли модель
класифікується як `new` (нема картки в `items.csv`) і потрапляє в
`new-cards-draft-<дата>.csv`, її Item-и записуються в `state/exported-items.json`.
Наступного дня, поки картку ще не імпортували в BCS, та сама модель матиме
статус `new-pending` — вона й далі в `report-<дата>.csv` (щоб не загубилась),
але вже НЕ в драфт-CSV, щоб не задублювати картку повторним імпортом. Як тільки
модель з'явиться в `items.csv` (картку імпортували) — вона природно стає
`changed`/`unchanged`, і Item-и в реєстрі більше не впливають.

## XML-фід для BCS Data.Imports (url + interval)

`out/heli-feed-<дата>.xml` — той самий new+changed набір рядків, що й у
new-cards-draft CSV, у форматі `<products><product>...</product></products>`
(поле = тег, назви полів ті самі, що в `items.csv`, тільки `/` замінено на `_`,
бо в XML-тегах `/` не можна — напр. `capacity/t` → `capacity_t`). Це під
`UniversalImportAdapter.parseXml`'s generic-шлях у BCS-Backend — один корінь з
повторюваним дочірнім тегом, без вкладеності, мапиться так само, як CSV-рядок.

Кожен `<product>` несе `is_active` (true/false):
- `changed` (картка вже існує) → `true` — вона й так вже жива, ми лише
  оновлюємо специфікацію/ціну.
- `new` (картки нема) → `false` — нова картка створюється, але прихована, бо
  `Name`/`description_details` тут ще заглушка (див. нижче). Хтось вручну
  вмикає `is_active`, коли пройде AI-полірування.

`is_active` — новий атрибут у BCS під категорію forklift, ще не існував до
цього фіду.

Стабільний URL для BCS (`DataSource: url`, `DataFormat: xml`, `Interval: ...`):
`https://raw.githubusercontent.com/ihorstefaniv/autoparserheli/main/feed/heli-import.xml`
— хмарний routine щодня комітить туди свіжий XML (репо має бути публічним, інакше
raw.githubusercontent.com не віддасть вміст без авторизації).

## Що воно НЕ робить (свідомо)

- Не пише `description_details`/полірований `name` — це поки що через AI-кнопку в
  `heli-adapter (6).html` у браузері, або вручну. `Name` тут — заглушка
  `"<Тип> <Модель>"`, щоб поле не було порожнім/undefined.
- Не мапить `mast_type` — колонка MAST у прайсі це код контролера (ZSM470), а не
  Standard/Duplex/Triplex.
- У БД сам нічого не пише — тільки файли на диск + XML-фід за фіксованим URL.
  Import у BCS (CSV вручну, або XML через Data.Imports url+interval) лишається
  окремим кроком/налаштуванням на стороні BCS.

## Структура

- `generate.js` — CLI, що все зв'язує докупи
- `lib/parsePriceFile.js` — парсинг прайс-файлу (дзеркалить heli-adapter.html)
- `lib/parseCatalog.js` — парсинг items.csv
- `lib/shared.js` — норм-функції + `deriveTechFields`
- `lib/snapshot.js` — збереження/читання/дифф знімків дня
- `lib/buildDraftCsv.js` — класифікація new/new-pending/changed/first-seen/unchanged + побудова CSV-рядків
  (і спільний `buildRowFields`, яким користується й XML-фід)
- `lib/buildFeedXml.js` — той самий new+changed набір у XML для BCS Data.Imports
- `lib/exportedRegistry.js` — `state/exported-items.json`, реєстр Item-ів, що вже пішли в
  draft як "new" (щоб не дублювати картку, поки чекає імпорту)
- `feed/heli-import.xml` — фіксований шлях, куди хмарний routine комітить свіжий XML
  щодня (стабільний URL для BCS, дивись розділ вище)
