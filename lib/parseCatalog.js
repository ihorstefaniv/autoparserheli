const fs = require('fs');
const Papa = require('papaparse');
const { norm } = require('./shared');

// Parses the BCS export (items.csv) into a model -> row lookup plus the exact
// header list, so generated rows always line up with whatever columns the
// current export actually has (no hardcoded schema).
function parseCatalog(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    const msg = parsed.errors.slice(0, 3).map((e) => `row ${e.row}: ${e.message}`).join('; ');
    throw new Error(`items.csv did not parse cleanly: ${msg}`);
  }
  const headers = parsed.meta.fields;
  const byModel = {};
  for (const row of parsed.data) {
    const key = norm(row.model);
    if (key) byModel[key] = row;
  }
  return { headers, byModel, rows: parsed.data };
}

module.exports = { parseCatalog };
