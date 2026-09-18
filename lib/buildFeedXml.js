const {
  buildRowFields, feedableEntries, fieldsToHeaderPairs, extraFieldPairs,
} = require('./buildDraftCsv');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Field names here mirror items.csv headers 1:1 (e.g. "capacity/t",
// "battery_voltage_v/ah") so they aren't valid XML tag names as-is — "/" isn't
// allowed in a tag. Sanitize for the tag only; the field's meaning (and its
// mapping in BCS's import column config) stays the same either way.
function xmlTagName(name) {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z_]/, '_$&');
}

// Builds a flat <products><product>...</product></products> XML feed for BCS's
// own Data.Imports url+xml+Interval mechanism (UniversalImportAdapter.parseXml's
// generic path: one repeated child tag under one root, each with flat field tags —
// no nesting needed, it maps 1:1 the same way a CSV row would via the import's
// column mapping). Same new/changed scope and field set as buildDraftRows, so the
// CSV draft and this feed only ever disagree on delivery mechanism, not content.
//
// Every <product> carries ALL items.csv columns (blank tag when unset), not just
// whichever fields happen to have a value — UniversalImportAdapter.productFromItem
// detects its available "columns" to map from Object.keys() of the FIRST item only,
// so a sparse/varying tag set per product would starve BCS's column-mapping UI of
// most of items.csv's attributes (this is what CSV already gets right for free,
// since a CSV row is always the full header width with blanks where unset).
//
// A few fields buildRowFields sets (is_active, available) are new BCS attributes
// that don't exist as items.csv columns at all, so they'd be silently dropped by
// fieldsToHeaderPairs alone - appended via extraFieldPairs instead, always in the
// same order for every product (buildRowFields sets them unconditionally).
function buildFeedXml(classified, catalogHeaders) {
  const items = feedableEntries(classified).map((entry) => {
    const { fields } = buildRowFields(entry);
    return [...fieldsToHeaderPairs(fields, catalogHeaders), ...extraFieldPairs(fields, catalogHeaders)];
  });
  const productTags = items.map((pairs) => {
    const fieldTags = pairs
      .map(([name, value]) => {
        const tag = xmlTagName(name);
        return `    <${tag}>${escapeXml(value)}</${tag}>`;
      })
      .join('\n');
    return `  <product>\n${fieldTags}\n  </product>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<products>\n${productTags.join('\n')}\n</products>\n`;
}

module.exports = { buildFeedXml };
