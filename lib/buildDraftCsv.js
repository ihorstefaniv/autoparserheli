const { normHeader, deriveTechFields } = require('./shared');

// Classifies every model in today's price file against the BCS catalog + the last
// saved snapshot, mirroring heli-adapter (6).html's buildResults():
//   new           — not in items.csv at all -> needs a brand-new product card
//   new-pending   — same as "new", but every one of this model's Item ids was
//                   already put into a previous new-cards-draft -> the card is
//                   presumably still waiting to be imported into BCS, so don't
//                   draft it again (would risk a duplicate card on import)
//   changed       — in items.csv, and its spec (mast/tyres/attachments/cabin/special)
//                   differs from the last snapshot -> existing card needs updating
//   first-seen    — in items.csv, but we have no prior snapshot to compare against
//                   -> unknown, left untouched (not exported)
//   unchanged     — in items.csv, spec matches last snapshot -> left untouched
function classify(variants, catalogByModel, prevModels, exportedItemIds) {
  const exported = exportedItemIds || new Set();
  return Object.keys(variants).map((key) => {
    const v = variants[key];
    const catalogEntry = catalogByModel[key] || null;
    const prevEntry = prevModels ? prevModels[key] : null;
    let status = 'unchanged';
    if (!catalogEntry) {
      const itemIds = v.itemIdArr || [];
      const alreadyDrafted = itemIds.length > 0 && itemIds.every((id) => exported.has(id));
      status = alreadyDrafted ? 'new-pending' : 'new';
    } else if (!prevEntry) status = 'first-seen';
    else if (prevEntry.specHash !== v.specHash) status = 'changed';
    return { key, variant: v, catalogEntry, status };
  });
}

// Builds the plain field->value object for one classified 'new'/'changed' entry —
// shared by the CSV draft (buildDraftRows) and the BCS auto-import XML feed
// (buildFeedXml), so the two never drift apart on what a "row" contains.
// is_active mirrors the same caution buildDraftRows already had for 'new': a
// brand-new card only has a placeholder Name (no AI-polished description yet),
// so it goes in hidden (is_active=false) until someone reviews it manually via
// heli-adapter.html; 'changed' cards already existed and stay visible.
function buildRowFields({ variant: v, catalogEntry, status }) {
  const fields = {};
  const set = (name, val) => { fields[name] = val; };

  // Field names below target the REAL BCS attribute vocabulary for this
  // category (see lib/productSchema.js) - NOT items.csv's own column names,
  // which turned out to belong to a different/aspirational schema that has
  // no matching Attribute records in BCS (2026-09-18 finding: BCS's import
  // column-mapping UI only ever offered a handful of unrelated attributes to
  // map our old field names to, because those Attribute records simply don't
  // exist under this category - manufacturer/enginetype/batterytype/capacity/
  // tyresfront/tyresrear/techdescr etc. already do).
  //
  // 2026-09-22 finding (from BCS's own column-mapping auto-suggestions on a
  // real upload): this adapter's actual dedupe/update key is the `ext_id`
  // attribute, not a raw "Id"/"ExternalId" tag - UniversalImportAdapter's
  // productFromItem() literally computes `data.ExternalId = data.internalno
  // || data.ext_id`. So the model code belongs in `ext_id` for EVERY row
  // (new and changed alike) - that's what lets BCS recognize "same product
  // on tomorrow's re-import" and update it in place, without us ever needing
  // to know/send its internal numeric database Id (which we don't have a
  // safe way to get right anyway - guessing/fabricating one risks silently
  // overwriting an unrelated existing product that happens to have that Id).
  set('ext_id', v.model);
  set('model', v.model);
  set('manufacturer', 'Heli');
  set('series', v.series || ''); // no matching attribute yet - kept as an extra/unmapped tag
  // (no separate "ExternalId" tag - BCS's own dropdown suggested routing that
  // value into the `model` attribute anyway, which is already set above)
  set('is_active', status === 'changed'); // no matching attribute yet either - same as above
  // AVAILABLE (serial numbers) is collected per model across every batch/lot row
  // during parsing (lib/parsePriceFile.js) - true as soon as ANY lot of this
  // model has recorded serials, false only if none of them do yet. This one
  // DOES already exist as a real attribute under this category.
  set('available', Boolean(v.serials && v.serials.length));

  const capMatch = String(v.capacity || '').match(/([\d.]+)/);
  if (capMatch) {
    // items.csv split this into capacity/t + capacity/kg; the real schema has
    // one numeric "capacity" field, kg-scale (e.g. 8000 for an 8t machine).
    set('capacity', Math.round(parseFloat(capMatch[1]) * 1000));
  }

  const tech = deriveTechFields(v);
  // BCS's own auto-suggest matched a column literally called "enginetype" to
  // its real attribute "engine_type" (underscore) - naming the tag that
  // exactly instead means it's a direct hit, no fuzzy-matching needed.
  if (tech.engine_type) set('engine_type', tech.engine_type);
  if (tech.battery) set('batterytype', tech.battery);
  if (tech.battery_voltage) {
    const [volt, amp] = tech.battery_voltage.split('/');
    set('battery', `${volt}V / ${amp}Ah`); // matches the real field's own sample format, e.g. "80V / 1240Ah"
  }
  if (tech.motor) set('engine', tech.motor);
  if (tech.front_tires) set('tyresfront', tech.front_tires);
  if (tech.rear_tires) set('tyresrear', tech.rear_tires);

  const sample = v.specSample || {};
  const rawOptionsParts = [];
  if (sample.mast) rawOptionsParts.push(`MAST: ${sample.mast}`);
  if (sample.tyres) rawOptionsParts.push(`Tyres: ${sample.tyres}`);
  if (sample.attachments) rawOptionsParts.push(`Attachments: ${sample.attachments}`);
  if (sample.cabin) rawOptionsParts.push(`Cabin: ${sample.cabin}`);
  if (sample.special) rawOptionsParts.push(`Special: ${sample.special.replace(/\n/g, ', ')}`);
  if (rawOptionsParts.length) set('techdescr', rawOptionsParts.join(' | ')); // closest real field to our old "options" summary

  if (status === 'new') {
    // Placeholder only — real German name/description still need the AI-draft
    // button in heli-adapter.html or a manual pass before this goes live.
    const typeLabel = tech.engine_type === 'Diesel' ? 'Dieselstapler'
      : tech.engine_type === 'Elektro' ? 'Elektrostapler'
        : '';
    set('Name', typeLabel ? `${typeLabel} ${v.model}` : v.model);
  }

  return { fields, tech };
}

// The set of classified statuses that ever go out to BCS (draft CSV or feed XML) —
// first-seen/unchanged have nothing new to tell BCS, new-pending is deliberately
// withheld until its card actually exists (see classify()).
function feedableEntries(classified) {
  return classified.filter((c) => c.status === 'new' || c.status === 'changed');
}

// Spreads a sparse fields object (only the keys buildRowFields actually set) across
// every items.csv column, in items.csv's own order — blank string for anything not
// set. Shared by the CSV draft and the XML feed so BOTH always expose the SAME full
// column set per row/product, not just whichever fields happened to have a value.
// This matters for the XML feed specifically: BCS's UniversalImportAdapter detects
// its available "columns" to map from Object.keys() of the FIRST item only — if rows
// carried different/sparse tag sets, most of items.csv's ~80 attributes would never
// even show up as mappable in BCS's import config UI.
function fieldsToHeaderPairs(fields, catalogHeaders) {
  const idx = {};
  catalogHeaders.forEach((h, i) => {
    idx[normHeader(h)] = i;
  });
  const arr = new Array(catalogHeaders.length).fill('');
  Object.keys(fields).forEach((name) => {
    const k = idx[normHeader(name)];
    if (k !== undefined) arr[k] = fields[name];
  });
  return catalogHeaders.map((h, i) => [h, arr[i]]);
}

// Fields buildRowFields set that have nowhere to go in items.csv's fixed column
// list (currently: is_active, available - both new BCS attributes created for
// this feed, not part of the items.csv export). The CSV draft can't carry these
// at all (it's a fixed-width items.csv row), but the XML feed isn't positional,
// so it appends them after the full column set rather than silently dropping
// them the way a plain fieldsToHeaderPairs() call would.
function extraFieldPairs(fields, catalogHeaders) {
  const known = new Set(catalogHeaders.map(normHeader));
  return Object.keys(fields)
    .filter((name) => !known.has(normHeader(name)))
    .map((name) => [name, fields[name]]);
}

// Builds items.csv-shaped rows for status 'new'/'changed' entries only — the same
// scope as the browser tool's "draft CSV" button (not the full-snapshot ZIP mode).
function buildDraftRows(classified, catalogHeaders) {
  const rows = [];
  const rowMeta = [];
  feedableEntries(classified).forEach((entry) => {
    const { variant: v, catalogEntry, status } = entry;
    const { fields, tech } = buildRowFields(entry);
    const arr = fieldsToHeaderPairs(fields, catalogHeaders).map(([, value]) => value);

    rows.push(arr);
    rowMeta.push({
      model: v.model, status, qty: v.qty, prices: v.priceArr, tech,
      catalogId: catalogEntry ? catalogEntry.Id : null,
    });
  });

  return { rows, rowMeta };
}

module.exports = {
  classify, buildDraftRows, buildRowFields, feedableEntries, fieldsToHeaderPairs, extraFieldPairs,
};
