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

  if (status === 'changed' && catalogEntry) set('Id', catalogEntry.Id);
  set('model', v.model);
  set('brand', 'Heli');
  set('series', v.series || '');
  set('ExternalId', v.model);
  set('is_active', status === 'changed');

  const capMatch = String(v.capacity || '').match(/([\d.]+)/);
  if (capMatch) {
    set('capacity/t', capMatch[1]);
    set('capacity/kg', Math.round(parseFloat(capMatch[1]) * 1000));
  }

  const tech = deriveTechFields(v);
  if (tech.engine_type) set('engine_type', tech.engine_type);
  if (tech.battery) set('battery', tech.battery);
  if (tech.battery_voltage) set('battery_voltage_v/ah', tech.battery_voltage);
  if (tech.motor) set('motor', tech.motor);
  if (tech.front_tires) set('front_tires', tech.front_tires);
  if (tech.rear_tires) set('rear_tires', tech.rear_tires);

  const sample = v.specSample || {};
  const rawOptionsParts = [];
  if (sample.mast) rawOptionsParts.push(`MAST: ${sample.mast}`);
  if (sample.tyres) rawOptionsParts.push(`Tyres: ${sample.tyres}`);
  if (sample.attachments) rawOptionsParts.push(`Attachments: ${sample.attachments}`);
  if (sample.cabin) rawOptionsParts.push(`Cabin: ${sample.cabin}`);
  if (sample.special) rawOptionsParts.push(`Special: ${sample.special.replace(/\n/g, ', ')}`);
  if (rawOptionsParts.length) set('options', rawOptionsParts.join(' | '));

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

// Builds items.csv-shaped rows for status 'new'/'changed' entries only — the same
// scope as the browser tool's "draft CSV" button (not the full-snapshot ZIP mode).
function buildDraftRows(classified, catalogHeaders) {
  const idx = {};
  catalogHeaders.forEach((h, i) => {
    idx[normHeader(h)] = i;
  });

  const rows = [];
  const rowMeta = [];
  feedableEntries(classified).forEach((entry) => {
    const { variant: v, catalogEntry, status } = entry;
    const { fields, tech } = buildRowFields(entry);
    const arr = new Array(catalogHeaders.length).fill('');
    Object.keys(fields).forEach((name) => {
      const k = idx[normHeader(name)];
      if (k !== undefined) arr[k] = fields[name];
    });

    rows.push(arr);
    rowMeta.push({
      model: v.model, status, qty: v.qty, prices: v.priceArr, tech,
      catalogId: catalogEntry ? catalogEntry.Id : null,
    });
  });

  return { rows, rowMeta };
}

module.exports = {
  classify, buildDraftRows, buildRowFields, feedableEntries,
};
