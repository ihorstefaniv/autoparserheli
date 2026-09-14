const fs = require('fs');
const path = require('path');

// Tracks which price-file "Item" ids have already been written into a
// new-cards-draft CSV as status "new". Unlike snapshots/*.json (one file per
// day, used for day-over-day diffing), this is a single running set — a model
// can sit as "new" (no BCS card yet) across many daily runs while waiting to
// be imported, and without this it would get redrafted (and risk being
// re-imported as a duplicate card) every single day until the catalog export
// catches up. Keyed by Item id (not model text) so re-ordered rows or minor
// text differences in the source sheet can't cause false re-drafts.
const REGISTRY_PATH = path.join(__dirname, '..', 'state', 'exported-items.json');

function loadExportedItemIds() {
  if (!fs.existsSync(REGISTRY_PATH)) return new Set();
  const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  return new Set(data.itemIds || []);
}

function saveExportedItemIds(itemIdSet) {
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    REGISTRY_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), itemIds: Array.from(itemIdSet).sort() }, null, 2),
    'utf8',
  );
}

module.exports = { loadExportedItemIds, saveExportedItemIds, REGISTRY_PATH };
