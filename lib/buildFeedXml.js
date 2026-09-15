const { buildRowFields, feedableEntries } = require('./buildDraftCsv');

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
function buildFeedXml(classified) {
  const items = feedableEntries(classified).map((entry) => buildRowFields(entry).fields);
  const productTags = items.map((fields) => {
    const fieldTags = Object.keys(fields)
      .map((name) => {
        const tag = xmlTagName(name);
        return `    <${tag}>${escapeXml(fields[name])}</${tag}>`;
      })
      .join('\n');
    return `  <product>\n${fieldTags}\n  </product>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<products>\n${productTags.join('\n')}\n</products>\n`;
}

module.exports = { buildFeedXml };
