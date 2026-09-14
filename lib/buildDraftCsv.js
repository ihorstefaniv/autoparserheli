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

// Builds items.csv-shaped rows for status 'new'/'changed' entries only — the same
// scope as the browser tool's "draft CSV" button (not the full-snapshot ZIP mode).
function buildDraftRows(classified, catalogHeaders) {
  const idx = {};
  catalogHeaders.forEach((h, i) => {
    idx[normHeader(h)] = i;
  });
  const set = (arr, name, val) => {
    const k = normHeader(name);
    if (idx[k] !== undefined) arr[idx[k]] = val;
  };

  const rows = [];
  const rowMeta = [];
  classified
    .filter((c) => c.status === 'new' || c.status === 'changed')
    .forEach(({ variant: v, catalogEntry, status }) => {
      const arr = new Array(catalogHeaders.length).fill('');

      if (status === 'changed' && catalogEntry) set(arr, 'Id', catalogEntry.Id);
      set(arr, 'model', v.model);
      set(arr, 'brand', 'Heli');
      set(arr, 'series', v.series || '');
      set(arr, 'ExternalId', v.model);

      const capMatch = String(v.capacity || '').match(/([\d.]+)/);
      if (capMatch) {
        set(arr, 'capacity/t', capMatch[1]);
        set(arr, 'capacity/kg', Math.round(parseFloat(capMatch[1]) * 1000));
      }

      const tech = deriveTechFields(v);
      if (tech.engine_type) set(arr, 'engine_type', tech.engine_type);
      if (tech.battery) set(arr, 'battery', tech.battery);
      if (tech.battery_voltage) set(arr, 'battery_voltage_v/ah', tech.battery_voltage);
      if (tech.motor) set(arr, 'motor', tech.motor);
      if (tech.front_tires) set(arr, 'front_tires', tech.front_tires);
      if (tech.rear_tires) set(arr, 'rear_tires', tech.rear_tires);

      const sample = v.specSample || {};
      const rawOptionsParts = [];
      if (sample.mast) rawOptionsParts.push(`MAST: ${sample.mast}`);
      if (sample.tyres) rawOptionsParts.push(`Tyres: ${sample.tyres}`);
      if (sample.attachments) rawOptionsParts.push(`Attachments: ${sample.attachments}`);
      if (sample.cabin) rawOptionsParts.push(`Cabin: ${sample.cabin}`);
      if (sample.special) rawOptionsParts.push(`Special: ${sample.special.replace(/\n/g, ', ')}`);
      if (rawOptionsParts.length) set(arr, 'options', rawOptionsParts.join(' | '));

      if (status === 'new') {
        // Placeholder only — real German name/description still need the AI-draft
        // button in heli-adapter.html or a manual pass before this goes live.
        const typeLabel = tech.engine_type === 'Diesel' ? 'Dieselstapler'
          : tech.engine_type === 'Elektro' ? 'Elektrostapler'
            : '';
        set(arr, 'Name', typeLabel ? `${typeLabel} ${v.model}` : v.model);
      }

      rows.push(arr);
      rowMeta.push({
        model: v.model, status, qty: v.qty, prices: v.priceArr, tech,
        catalogId: catalogEntry ? catalogEntry.Id : null,
      });
    });

  return { rows, rowMeta };
}

module.exports = { classify, buildDraftRows };
