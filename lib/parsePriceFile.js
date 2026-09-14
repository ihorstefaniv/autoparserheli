const XLSX = require('xlsx');
const { norm, normHeader, findCol, parseSerials, parseQtyAvailable } = require('./shared');

// Parses a Heli price file (.xls/.xlsx/.csv — anything SheetJS reads) into one
// "variant" per model: aggregated qty across all physical units, the set of prices
// seen, and a specHash (mast|tyres|attachments|cabin|special) used to detect spec
// changes day-over-day. Mirrors the parsing in heli-adapter (6).html 1:1 so the
// two never drift apart.
function parsePriceFile(filePath, sheetName) {
  const wb = XLSX.readFile(filePath);
  const usedSheet = sheetName || wb.SheetNames[0];
  const ws = wb.Sheets[usedSheet];
  if (!ws) throw new Error(`Sheet "${usedSheet}" not found. Available: ${wb.SheetNames.join(', ')}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const norms = rows[i].map(normHeader);
    if (norms.some((h) => h === 'model')) {
      headerRowIdx = i;
      break;
    }
  }
  const headers = rows[headerRowIdx] || [];

  const col = {
    item: findCol(headers, 'item'),
    model: findCol(headers, 'model'),
    series: findCol(headers, 'series'),
    capacity: findCol(headers, 'capacity'),
    qty: findCol(headers, 'qty'),
    mast: findCol(headers, 'mast'),
    tyres: findCol(headers, 'tyres'),
    typeCol: findCol(headers, 'type'),
    engine: findCol(headers, 'controller', 'engine'),
    attachments: findCol(headers, 'attachments'),
    cabin: findCol(headers, 'cabin'),
    special: findCol(headers, 'special'),
    description: findCol(headers, 'description'),
    available: findCol(headers, 'available'),
    price: findCol(headers, 'price'),
  };

  if (col.model === -1) {
    throw new Error(`No "Model" column found on sheet "${usedSheet}". Wrong file/sheet?`);
  }

  const parseMode = col.mast === -1 && col.tyres === -1 && col.available === -1 ? 'pricelist' : 'stock';

  const variants = {};
  for (let i = headerRowIdx + 1; i < rows.length; i += 1) {
    const r = rows[i];
    const modelRaw = r[col.model];
    if (!modelRaw || String(modelRaw).trim() === '') continue;
    const model = String(modelRaw).trim();
    const key = norm(model);
    const price = parseFloat(r[col.price]) || null;
    const itemId = col.item !== -1 && r[col.item] !== '' ? String(r[col.item]).trim() : null;

    let serials = [];
    let qty = 1;
    let specParts = { mast: '', tyres: '', attachments: '', cabin: '', special: '', type: '', engine: '' };
    let description = '';

    if (parseMode === 'stock') {
      serials = parseSerials(r[col.available]);
      qty = serials.length || parseQtyAvailable(r[col.qty]) || 1;
      specParts = {
        mast: String(r[col.mast] || '').trim(),
        tyres: String(r[col.tyres] || '').trim(),
        attachments: String(r[col.attachments] || '').trim(),
        cabin: String(r[col.cabin] || '').trim(),
        special: String(r[col.special] || '').trim(),
        type: col.typeCol !== -1 ? String(r[col.typeCol] || '').trim() : '',
        engine: col.engine !== -1 ? String(r[col.engine] || '').trim() : '',
      };
      description = r[col.description] || '';
    } else {
      qty = parseQtyAvailable(r[col.qty]) || 1;
    }

    const specHash = [specParts.mast, specParts.tyres, specParts.attachments, specParts.cabin, specParts.special]
      .map(norm)
      .join('|');

    if (!variants[key]) {
      variants[key] = {
        model,
        series: col.series !== -1 ? r[col.series] : '',
        capacity: col.capacity !== -1 ? r[col.capacity] : '',
        qty: 0,
        prices: new Set(),
        specHashes: new Set(),
        specSamples: [],
        serials: [],
        descriptions: new Set(),
        itemIds: new Set(),
      };
    }
    const v = variants[key];
    v.qty += qty;
    if (price) v.prices.add(price);
    v.specHashes.add(specHash);
    v.specSamples.push(specParts);
    v.serials.push(...serials);
    if (description) v.descriptions.add(description);
    if (itemId) v.itemIds.add(itemId);
  }

  Object.values(variants).forEach((v) => {
    v.description = Array.from(v.descriptions).join(' | ');
    v.specSample = v.specSamples[0] || {};
    v.specHash = Array.from(v.specHashes)[0] || '';
    v.specConflict = v.specHashes.size > 1;
    v.priceConflict = v.prices.size > 1;
    v.priceArr = Array.from(v.prices).sort((a, b) => a - b);
    v.itemIdArr = Array.from(v.itemIds);
  });

  return { variants, parseMode, sheetLabel: usedSheet, sheetNames: wb.SheetNames };
}

module.exports = { parsePriceFile };
