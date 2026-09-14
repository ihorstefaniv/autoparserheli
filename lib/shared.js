function norm(s) {
  return s === undefined || s === null ? '' : String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

function normHeader(h) {
  return norm(h)
    .replace(/\n/g, ' ')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ä/g, 'a')
    .replace(/ß/g, 'ss');
}

function findCol(headers, ...candidates) {
  const norms = headers.map(normHeader);
  for (const cand of candidates) {
    const idx = norms.findIndex((h) => h === cand);
    if (idx >= 0) return idx;
  }
  for (const cand of candidates) {
    const idx = norms.findIndex((h) => h.includes(cand));
    if (idx >= 0) return idx;
  }
  return -1;
}

// Qty cells come in two shapes seen so far: a plain number ("13"), or a batch note
// "available / total" ("2 / 5", "92 / 118") — the second number is how many units the
// batch/lot originally had, not how many are in stock now. We only want the first
// (available) number; Number("2 / 5") is NaN, so this needs its own parse.
function parseQtyAvailable(cell) {
  if (cell === undefined || cell === null || cell === '') return null;
  const match = String(cell).match(/^\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function parseSerials(cell) {
  if (!cell) return [];
  return String(cell).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

// Mirrors heli-adapter (6).html's deriveTechFields. Deliberately does NOT map
// mast_type: the sheet's MAST column is a ZAPI/HELI controller code (e.g. ZSM470),
// not the Standard/Duplex/Triplex value items.csv expects there.
function deriveTechFields(variant) {
  const sample = variant.specSample || {};
  const typeRaw = norm(sample.type || '');
  const engineRaw = (sample.engine || '').trim();
  const tyresRaw = (sample.tyres || '').trim();
  const out = { engine_type: '', battery: '', battery_voltage: '', motor: '', front_tires: '', rear_tires: '' };

  // Order matters: "IC LPG stage V" contains "ic" but is gas, not diesel — so LPG/gas
  // must be checked before any bare "IC ..." -> diesel fallback. And a bare "IC ..."
  // with neither "diesel" nor "lpg"/"gas" spelled out is deliberately left unmapped
  // rather than guessed (matters for e.g. "Rough terrain forklift", which the supplier
  // sheet doesn't spell out as diesel/electric anywhere).
  if (typeRaw.includes('lpg') || typeRaw.includes('gas')) out.engine_type = 'Gas';
  else if (typeRaw.includes('diesel')) out.engine_type = 'Diesel';
  else if (
    typeRaw.includes('electric')
    || typeRaw.includes('lithium')
    || /pallet truck|stacker|reach truck|order picker/.test(typeRaw)
  ) out.engine_type = 'Elektro'; // these categories are indoor equipment — always electric
  else if (/kubota|cummins|xinchai|yuchai|perkins|isuzu|yanmar|deutz|volvo engine/i.test(engineRaw)) {
    // Type column was blank/unhelpful (e.g. "Rough terrain forklift" doesn't say the
    // fuel), but the engine column names an actual diesel engine make/model — that's
    // reading the data, not guessing it.
    out.engine_type = 'Diesel';
  }

  if (out.engine_type === 'Elektro') {
    if (typeRaw.includes('lithium')) out.battery = 'Lithium-Batterie';
    else if (typeRaw.includes('lead') || typeRaw.includes('blei')) out.battery = 'Bleibatterie';
  } else if (engineRaw) {
    out.motor = engineRaw;
  }

  const voltSource = `${variant.description || ''} ${sample.special || ''}`;
  const voltMatch = voltSource.match(/(\d{2,3})\s*V[/\-]\s*(\d{2,3})\s*Ah/i);
  if (voltMatch) out.battery_voltage = `${voltMatch[1]}/${voltMatch[2]}`;

  if (tyresRaw) {
    out.front_tires = tyresRaw;
    out.rear_tires = tyresRaw;
  }

  return out;
}

module.exports = { norm, normHeader, findCol, parseSerials, parseQtyAvailable, deriveTechFields };
