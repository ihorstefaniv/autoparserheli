#!/usr/bin/env node
/*
 * "Новий прайс -> готовий CSV" в одну команду.
 *
 * Usage:
 *   node generate.js [--prices "path/to/heli prices.xls"] [--catalog "path/to/items.csv"]
 *                     [--sheet "SheetName"] [--outdir out] [--no-snapshot]
 *
 * Defaults: --prices = newest "*heli*price*.xls|xlsx|csv" file found in the repo root,
 *           --catalog = ../items.csv (repo root's items.csv export).
 *
 * What it does, every run:
 *   1. Parses today's Heli price file into one row per model (qty aggregated across
 *      physical units, spec fields, tech fields derived from Type/Engine/Tyres).
 *   2. Compares it to the last saved snapshot (snapshots/YYYY-MM-DD.json) -> report of
 *      what's new/gone/changed since last time this was run.
 *   3. Compares it to items.csv (the BCS catalog export) -> which models need a NEW
 *      product card vs an UPDATE to an existing one.
 *   4. Writes out/new-cards-draft-<date>.csv (items.csv format, ready for Data.Imports)
 *      and out/report-<date>.csv (full status per model).
 *   5. Saves today's snapshot for tomorrow's comparison.
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const { parsePriceFile } = require('./lib/parsePriceFile');
const { parseCatalog } = require('./lib/parseCatalog');
const { saveSnapshot, loadPreviousSnapshot, diffSnapshots } = require('./lib/snapshot');
const { classify, buildDraftRows } = require('./lib/buildDraftCsv');
const { buildFeedXml } = require('./lib/buildFeedXml');
const { loadExportedItemIds, saveExportedItemIds } = require('./lib/exportedRegistry');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (key === 'no-snapshot') {
        args.noSnapshot = true;
      } else {
        args[key] = argv[i + 1];
        i += 1;
      }
    }
  }
  return args;
}

function findDefaultPricesFile(rootDir) {
  const candidates = fs
    .readdirSync(rootDir)
    .filter((f) => /heli.*(price|stock)/i.test(f) && /\.(xls|xlsx|csv)$/i.test(f) && !f.startsWith('~$') && !f.startsWith('.~lock'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(rootDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates.length ? path.join(rootDir, candidates[0].f) : null;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.join(__dirname, '..');
  const toolDir = __dirname;

  const pricesPath = args.prices ? path.resolve(args.prices) : findDefaultPricesFile(repoRoot);
  const catalogPath = args.catalog ? path.resolve(args.catalog) : path.join(repoRoot, 'items.csv');
  const outDir = args.outdir ? path.resolve(args.outdir) : path.join(toolDir, 'out');
  const date = todayStr();

  if (!pricesPath || !fs.existsSync(pricesPath)) {
    console.error(`Не знайшов файл прайсу. Вкажи --prices "шлях/heli prices.xls" (шукав *heli*price*|*heli*stock*.xls|xlsx|csv у ${repoRoot})`);
    process.exit(1);
  }
  if (!fs.existsSync(catalogPath)) {
    console.error(`Не знайшов каталог. Вкажи --catalog "шлях/items.csv" (очікував ${catalogPath})`);
    process.exit(1);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`Прайс:    ${pricesPath}`);
  console.log(`Каталог:  ${catalogPath}`);
  console.log('');

  const { variants, parseMode, sheetLabel } = parsePriceFile(pricesPath, args.sheet);
  console.log(`Аркуш "${sheetLabel}", режим "${parseMode}", моделей: ${Object.keys(variants).length}`);

  const catalog = parseCatalog(catalogPath);
  console.log(`У каталозі унікальних моделей: ${Object.keys(catalog.byModel).length}`);

  const prev = args.noSnapshot ? null : loadPreviousSnapshot(date);
  if (prev) console.log(`Попередній знімок: ${prev.file} (${Object.keys(prev.models).length} моделей)`);
  else console.log('Попереднього знімка не знайдено (перший запуск, або --no-snapshot) — день-до-дня звіт пропускаю.');
  console.log('');

  // ---- day-over-day report ----
  if (prev) {
    const todayModels = {};
    Object.keys(variants).forEach((k) => {
      const v = variants[k];
      todayModels[k] = { model: v.model, qty: v.qty, prices: v.priceArr, specHash: v.specHash };
    });
    const diff = diffSnapshots(prev.models, todayModels);
    console.log('=== День-до-дня (порівняно з попереднім запуском) ===');
    console.log(`Нові моделі в прайсі: ${diff.added.length}`);
    diff.added.forEach((m) => console.log(`  + ${m.model} (qty ${m.qty})`));
    console.log(`Зникли з прайсу: ${diff.removed.length}`);
    diff.removed.forEach((m) => console.log(`  - ${m.model} (був qty ${m.qty})`));
    console.log(`Змінились (кількість/ціна/специфікація): ${diff.changed.length}`);
    diff.changed.forEach((c) => {
      const bits = [];
      if (c.qtyDelta) bits.push(`qty ${c.qtyDelta > 0 ? '+' : ''}${c.qtyDelta}`);
      if (c.priceDelta) bits.push(`price ${c.priceDelta > 0 ? '+' : ''}${c.priceDelta}`);
      if (c.specChanged) bits.push('спека змінилась');
      console.log(`  ~ ${c.model}: ${bits.join(', ')}`);
    });
    console.log('');

    // ---- persist the same day-over-day diff to a file (console output alone
    // disappears once the run ends) ----
    const changelogRows = [
      ...diff.added.map((m) => ({
        Action: 'added', Model: m.model, Qty: m.qty, QtyDelta: '',
        PriceBefore: '', PriceAfter: m.prices[0] ?? '', PriceDelta: '', SpecChanged: '',
      })),
      ...diff.removed.map((m) => ({
        Action: 'removed', Model: m.model, Qty: '', QtyDelta: '',
        PriceBefore: m.prices[0] ?? '', PriceAfter: '', PriceDelta: '', SpecChanged: '',
      })),
      ...diff.changed.map((c) => ({
        Action: 'changed', Model: c.model, Qty: '', QtyDelta: c.qtyDelta || '',
        PriceBefore: c.priceBefore ?? '', PriceAfter: c.priceAfter ?? '', PriceDelta: c.priceDelta || '',
        SpecChanged: c.specChanged ? 'yes' : '',
      })),
    ];
    const changelogCsv = Papa.unparse({
      fields: ['Action', 'Model', 'Qty', 'QtyDelta', 'PriceBefore', 'PriceAfter', 'PriceDelta', 'SpecChanged'],
      data: changelogRows,
    });
    const changelogPath = path.join(outDir, `changelog-${date}.csv`);
    fs.writeFileSync(changelogPath, changelogCsv, 'utf8');
    console.log(`Написав ${changelogPath} (${changelogRows.length} подій: +${diff.added.length} / -${diff.removed.length} / ~${diff.changed.length})`);
    console.log('');
  }

  // ---- catalog classification ----
  const exportedItemIds = loadExportedItemIds();
  const classified = classify(variants, catalog.byModel, prev ? prev.models : null, exportedItemIds);
  const counts = classified.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});
  console.log('=== Проти каталогу (items.csv) ===');
  console.log(`new (немає картки): ${counts.new || 0}, new-pending (вже задрафтовано раніше, чекає імпорту — пропускаю): ${counts['new-pending'] || 0}, changed (треба оновити картку): ${counts.changed || 0}, first-seen (є в каталозі, спеку ще нема з чим звірити): ${counts['first-seen'] || 0}, unchanged: ${counts.unchanged || 0}`);
  console.log('');

  // ---- draft CSV (new + changed only) ----
  const { rows, rowMeta } = buildDraftRows(classified, catalog.headers);
  if (rows.length) {
    const csv = Papa.unparse({ fields: catalog.headers, data: rows }, { quotes: false });
    const draftPath = path.join(outDir, `new-cards-draft-${date}.csv`);
    fs.writeFileSync(draftPath, csv, 'utf8');
    console.log(`Написав ${draftPath} (${rows.length} рядків: ${rowMeta.filter((r) => r.status === 'new').length} нових, ${rowMeta.filter((r) => r.status === 'changed').length} оновлених)`);
    rowMeta.forEach((r) => console.log(`  [${r.status}] ${r.model} — qty ${r.qty}, engine_type=${r.tech.engine_type || '—'}, battery=${r.tech.battery || '—'}`));
  } else {
    console.log('Нових чи змінених карток немає — CSV не пишу.');
  }
  console.log('');

  // ---- BCS auto-import XML feed (same new/changed scope as the draft CSV) ----
  const feedXml = buildFeedXml(classified, catalog.headers);
  const feedPath = path.join(outDir, `heli-feed-${date}.xml`);
  fs.writeFileSync(feedPath, feedXml, 'utf8');
  console.log(`Написав ${feedPath} (XML-фід для BCS Data.Imports)`);

  // ---- stable-path copy: same file every run (overwritten, never dated) -----
  // this is the one BCS actually polls via a fixed URL (see README "Стабільний URL")
  const stableFeedPath = path.join(toolDir, 'feed', 'heli-import.xml');
  fs.mkdirSync(path.dirname(stableFeedPath), { recursive: true });
  fs.writeFileSync(stableFeedPath, feedXml, 'utf8');
  console.log(`Оновив ${stableFeedPath} (стабільний шлях для BCS, git commit+push — окремим кроком)`);
  console.log('');

  // ---- mark this run's "new" items as drafted, so they aren't redrafted
  // tomorrow while still waiting to be imported into BCS ----
  const newlyDrafted = classified.filter((c) => c.status === 'new');
  if (newlyDrafted.length) {
    newlyDrafted.forEach((c) => (c.variant.itemIdArr || []).forEach((id) => exportedItemIds.add(id)));
    saveExportedItemIds(exportedItemIds);
  }

  // ---- full status report ----
  const reportRows = classified.map((c) => ({
    Model: c.variant.model,
    Status: c.status,
    Qty: c.variant.qty,
    Prices: c.variant.priceArr.join('/'),
    CatalogId: c.catalogEntry ? c.catalogEntry.Id : '',
    SpecConflict: c.variant.specConflict ? 'yes' : '',
  }));
  const reportCsv = Papa.unparse(reportRows);
  const reportPath = path.join(outDir, `report-${date}.csv`);
  fs.writeFileSync(reportPath, reportCsv, 'utf8');
  console.log(`Написав ${reportPath} (повний статус по кожній моделі)`);

  // ---- persist today's snapshot for tomorrow ----
  if (!args.noSnapshot) {
    const snapPath = saveSnapshot(variants, date);
    console.log(`Зберіг знімок: ${snapPath}`);
  }
}

main();
