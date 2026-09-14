const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, '..', 'snapshots');

function toSnapshotMap(variants) {
  const map = {};
  Object.keys(variants).forEach((key) => {
    const v = variants[key];
    map[key] = {
      model: v.model,
      series: v.series,
      capacity: v.capacity,
      qty: v.qty,
      prices: v.priceArr,
      specHash: v.specHash,
      specSample: v.specSample,
      description: v.description,
    };
  });
  return map;
}

function saveSnapshot(variants, dateStr) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const filePath = path.join(SNAPSHOT_DIR, `${dateStr}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, models: toSnapshotMap(variants) }, null, 2), 'utf8');
  return filePath;
}

// Latest snapshot strictly before todayStr (filenames are YYYY-MM-DD.json, so
// lexicographic order == date order).
function loadPreviousSnapshot(todayStr) {
  if (!fs.existsSync(SNAPSHOT_DIR)) return null;
  const files = fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .filter((f) => f.slice(0, 10) < todayStr)
    .sort();
  if (!files.length) return null;
  const latest = files[files.length - 1];
  const data = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, latest), 'utf8'));
  return { date: data.date, models: data.models, file: latest };
}

// Day-over-day diff: what showed up, what vanished, what changed qty/price/spec
// for models present on both days.
function diffSnapshots(prevModels, todayModels) {
  const prevKeys = new Set(Object.keys(prevModels));
  const todayKeys = new Set(Object.keys(todayModels));

  const added = [...todayKeys].filter((k) => !prevKeys.has(k)).map((k) => todayModels[k]);
  const removed = [...prevKeys].filter((k) => !todayKeys.has(k)).map((k) => prevModels[k]);

  const changed = [];
  const unchanged = [];
  [...todayKeys].filter((k) => prevKeys.has(k)).forEach((k) => {
    const before = prevModels[k];
    const after = todayModels[k];
    const qtyDelta = after.qty - before.qty;
    const priceBefore = before.prices[0] ?? null;
    const priceAfter = after.prices[0] ?? null;
    const priceDelta = priceBefore !== null && priceAfter !== null ? priceAfter - priceBefore : null;
    const specChanged = before.specHash !== after.specHash;
    if (qtyDelta !== 0 || priceDelta || specChanged) {
      changed.push({ model: after.model, qtyDelta, priceBefore, priceAfter, priceDelta, specChanged });
    } else {
      unchanged.push(after.model);
    }
  });

  return { added, removed, changed, unchanged };
}

module.exports = { saveSnapshot, loadPreviousSnapshot, diffSnapshots, SNAPSHOT_DIR };
