/**
 * SN Enterprises – Inventory Tracker · Google Apps Script backend
 *
 * Bind this script to a Google Sheet (Extensions → Apps Script), run setup()
 * once, then deploy as a Web app (Execute as: Me · Who has access: Anyone).
 * Every request must carry the ACCESS_KEY stored in Script Properties.
 *
 * Sheets created by setup():
 *   Items      – one row per SKU (item × size × colour)
 *   Movements  – append-only stock ledger; entries are cancelled, never deleted
 *   Stock      – live formulas: on-hand and reorder status per SKU
 */

const SHEET_ITEMS = 'Items';
const SHEET_MOVES = 'Movements';
const SHEET_STOCK = 'Stock';

// Set to true if you want to allow sales before the purchase is booked.
const ALLOW_NEGATIVE_STOCK = false;

const ITEM_HEADERS = ['SKU', 'Item', 'Category', 'Size', 'Colour', 'HSN', 'GST %',
                      'Cost Rate', 'Sale Rate', 'Reorder Level', 'Active'];
const ITEM_KEYS    = ['sku', 'item', 'category', 'size', 'colour', 'hsn', 'gst',
                      'cost', 'sale', 'reorder', 'active'];

const MOVE_HEADERS = ['ID', 'Date', 'Type', 'SKU', 'Qty', 'Signed Qty', 'Rate', 'Party',
                      'Ref', 'Notes', 'Status', 'Created At', 'Cancelled At', 'Cancel Reason'];
const MOVE_KEYS    = ['id', 'date', 'type', 'sku', 'qty', 'signedQty', 'rate', 'party',
                      'ref', 'notes', 'status', 'createdAt', 'cancelledAt', 'cancelReason'];

// +1 = stock goes up, -1 = stock goes down
const TYPE_DIR = {
  OPENING: 1, PURCHASE: 1, SALE_RETURN: 1, ADJ_IN: 1,
  SALE: -1, PURCHASE_RETURN: -1, ADJ_OUT: -1
};

/* ───────────────────────────── Setup ───────────────────────────── */

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('SN Inventory')
      .addItem('Run setup / repair sheets', 'setup')
      .addItem('Show access key', 'showAccessKey')
      .addToUi();
  } catch (e) { /* not bound to a spreadsheet UI */ }
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const items = getOrCreateSheet_(ss, SHEET_ITEMS, ITEM_HEADERS);
  const moves = getOrCreateSheet_(ss, SHEET_MOVES, MOVE_HEADERS);
  // Keep identifiers and dates as plain text so Sheets never reformats them.
  textColumn_(items, 1); textColumn_(items, 6);
  textColumn_(moves, 1); textColumn_(moves, 2); textColumn_(moves, 4);

  const stock = ss.getSheetByName(SHEET_STOCK) || ss.insertSheet(SHEET_STOCK);
  stock.clear();
  stock.getRange(1, 1, 1, 7).setValues([['SKU', 'Item', 'Size', 'Colour', 'On Hand', 'Reorder Level', 'Status']])
    .setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
  stock.setFrozenRows(1);
  const f = (expr) => '=ARRAYFORMULA(IF(A2:A="","",' + expr + '))';
  stock.getRange('A2').setFormula('=ARRAYFORMULA(IF(Items!A2:A="","",Items!A2:A))');
  stock.getRange('B2').setFormula(f('Items!B2:B'));
  stock.getRange('C2').setFormula(f('Items!D2:D'));
  stock.getRange('D2').setFormula(f('Items!E2:E'));
  stock.getRange('E2').setFormula(f('SUMIFS(Movements!F:F,Movements!D:D,A2:A,Movements!K:K,"ACTIVE")'));
  stock.getRange('F2').setFormula(f('Items!J2:J'));
  stock.getRange('G2').setFormula(f('IF(COUNTIFS(Movements!D:D,A2:A,Movements!K:K,"ACTIVE")=0,"NEW",' +
    'IF(E2:E<=0,"OUT",IF(AND(F2:F>0,E2:E<=F2:F),"LOW","OK")))'));
  stock.autoResizeColumns(1, 7);

  ensureAccessKey_();
  showAccessKey();
}

function showAccessKey() {
  const key = ensureAccessKey_();
  Logger.log('ACCESS_KEY: ' + key);
  try {
    SpreadsheetApp.getUi().alert('SN Inventory access key',
      'Paste this into the app (Settings tab) together with the Web app URL:\n\n' + key,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* run from the editor: the key is in the execution log */ }
}

function ensureAccessKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('ACCESS_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('ACCESS_KEY', key);
  }
  return key;
}

function getOrCreateSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

function textColumn_(sh, col) {
  sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
}

/* ───────────────────────────── HTTP ───────────────────────────── */

function doGet() {
  return json_({ ok: true, service: 'SN Enterprises Inventory API' });
}

function doPost(e) {
  let lock = null;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const key = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
    if (!key) return json_({ ok: false, error: 'Backend not set up. Run setup() in Apps Script.' });
    if (!body.key || body.key !== key) return json_({ ok: false, error: 'Invalid access key.' });

    const action = body.action;
    const p = body.payload || {};
    if (action === 'bootstrap') return json_({ ok: true, items: readItems_(), moves: readMoves_(), serverTime: new Date().toISOString() });

    // All writes are serialised so two operators cannot clash.
    lock = LockService.getScriptLock();
    lock.waitLock(20000);

    let res;
    if (action === 'saveItem') res = saveItems_([p.item], true);
    else if (action === 'saveItems') res = saveItems_(p.items || [], false);
    else if (action === 'addMovements') res = addMovements_(p.movements || []);
    else if (action === 'cancelMovement') res = cancelMovement_(p.id, p.reason);
    else throw new Error('Unknown action: ' + action);
    SpreadsheetApp.flush();
    return json_(Object.assign({ ok: true }, res));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) { /* already released */ } }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────────── Read ───────────────────────────── */

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing. Run setup() first.');
  return sh;
}

function readRows_(sh, ncols) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ncols).getValues();
}

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v).trim();
}

function readItems_() {
  return readRows_(sheet_(SHEET_ITEMS), ITEM_KEYS.length)
    .filter(r => str_(r[0]) !== '')
    .map(r => ({
      sku: str_(r[0]), item: str_(r[1]), category: str_(r[2]), size: str_(r[3]), colour: str_(r[4]),
      hsn: str_(r[5]), gst: Number(r[6]) || 0, cost: Number(r[7]) || 0, sale: Number(r[8]) || 0,
      reorder: Number(r[9]) || 0, active: str_(r[10]).toUpperCase() !== 'NO'
    }));
}

function readMoves_() {
  return readRows_(sheet_(SHEET_MOVES), MOVE_KEYS.length)
    .filter(r => str_(r[0]) !== '')
    .map(r => ({
      id: str_(r[0]), date: str_(r[1]), type: str_(r[2]), sku: str_(r[3]),
      qty: Number(r[4]) || 0, signedQty: Number(r[5]) || 0, rate: Number(r[6]) || 0,
      party: str_(r[7]), ref: str_(r[8]), notes: str_(r[9]), status: str_(r[10]) || 'ACTIVE',
      createdAt: str_(r[11]), cancelledAt: str_(r[12]), cancelReason: str_(r[13])
    }));
}

function onHandMap_(moves) {
  const m = {};
  moves.forEach(x => { if (x.status === 'ACTIVE') m[x.sku] = (m[x.sku] || 0) + x.signedQty; });
  return m;
}

/* ───────────────────────────── Items ───────────────────────────── */

function cleanItem_(it) {
  const sku = str_(it && it.sku).toUpperCase();
  if (!sku) throw new Error('SKU is required.');
  if (!/^[A-Z0-9][A-Z0-9._\-\/]*$/.test(sku)) throw new Error('SKU "' + sku + '" may only use letters, digits and . _ - /');
  const name = str_(it.item);
  if (!name) throw new Error('Item name is required for ' + sku + '.');
  const nonNeg = (v, label) => {
    const n = Number(v || 0);
    if (!isFinite(n) || n < 0) throw new Error(label + ' must be zero or more for ' + sku + '.');
    return n;
  };
  const gst = nonNeg(it.gst, 'GST %');
  if (gst > 100) throw new Error('GST % looks wrong for ' + sku + '.');
  return {
    sku: sku, item: name, category: str_(it.category), size: str_(it.size), colour: str_(it.colour),
    hsn: str_(it.hsn), gst: gst, cost: nonNeg(it.cost, 'Cost rate'), sale: nonNeg(it.sale, 'Sale rate'),
    reorder: nonNeg(it.reorder, 'Reorder level'), active: it.active === false ? 'No' : 'Yes'
  };
}

function itemRow_(c) {
  return [c.sku, c.item, c.category, c.size, c.colour, c.hsn, c.gst, c.cost, c.sale, c.reorder, c.active];
}

// update=true  → the SKU must exist and is overwritten
// update=false → new SKUs are added, existing ones are skipped and reported
function saveItems_(items, update) {
  if (!items.length) throw new Error('No items supplied.');
  const sh = sheet_(SHEET_ITEMS);
  const rows = readRows_(sh, 1);
  const where = {};
  rows.forEach((r, i) => { where[str_(r[0]).toUpperCase()] = i + 2; });

  const cleaned = items.map(cleanItem_);
  const seen = {};
  cleaned.forEach(c => { if (seen[c.sku]) throw new Error('SKU ' + c.sku + ' appears twice in this request.'); seen[c.sku] = 1; });

  const added = [], skipped = [];
  const toAppend = [];
  cleaned.forEach(c => {
    const row = where[c.sku];
    if (update) {
      if (!row) throw new Error('SKU ' + c.sku + ' does not exist.');
      sh.getRange(row, 1, 1, ITEM_KEYS.length).setValues([itemRow_(c)]);
      added.push(c.sku);
    } else if (row) {
      skipped.push(c.sku);
    } else {
      toAppend.push(itemRow_(c));
      added.push(c.sku);
    }
  });
  if (toAppend.length) {
    const start = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(start, 1, toAppend.length, ITEM_KEYS.length).setValues(toAppend);
  }
  return { saved: added, skipped: skipped };
}

/* ───────────────────────────── Movements ───────────────────────────── */

function addMovements_(list) {
  if (!list.length) throw new Error('No stock lines supplied.');
  const items = readItems_();
  const itemBySku = {};
  items.forEach(i => { itemBySku[i.sku] = i; });
  const moves = readMoves_();
  const existingIds = {};
  moves.forEach(m => { existingIds[m.id] = 1; });
  const stock = onHandMap_(moves);

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const out = [], dupes = [];

  list.forEach((m, idx) => {
    const line = 'Line ' + (idx + 1) + ': ';
    const id = str_(m.id);
    if (!id) throw new Error(line + 'missing entry ID.');
    if (existingIds[id]) { dupes.push(id); return; }   // retry of an entry that already saved
    const type = str_(m.type).toUpperCase();
    if (!TYPE_DIR[type]) throw new Error(line + 'unknown movement type "' + type + '".');
    const sku = str_(m.sku).toUpperCase();
    const it = itemBySku[sku];
    if (!it) throw new Error(line + 'SKU "' + sku + '" is not in the item master.');
    if (!it.active) throw new Error(line + 'SKU ' + sku + ' is inactive.');
    const qty = Number(m.qty);
    if (!isFinite(qty) || qty <= 0 || Math.round(qty) !== qty) throw new Error(line + 'quantity must be a whole number above zero (' + sku + ').');
    const rate = Number(m.rate || 0);
    if (!isFinite(rate) || rate < 0) throw new Error(line + 'rate cannot be negative (' + sku + ').');
    const date = str_(m.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(line + 'date must be YYYY-MM-DD.');

    const signed = TYPE_DIR[type] * qty;
    const after = (stock[sku] || 0) + signed;
    if (!ALLOW_NEGATIVE_STOCK && after < 0) {
      throw new Error(line + sku + ' has only ' + (stock[sku] || 0) + ' in stock; cannot take out ' + qty + '.');
    }
    stock[sku] = after;
    existingIds[id] = 1;
    out.push([id, date, type, sku, qty, signed, rate, str_(m.party), str_(m.ref), str_(m.notes),
              'ACTIVE', now, '', '']);
  });

  if (out.length) {
    const sh = sheet_(SHEET_MOVES);
    const start = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(start, 1, out.length, MOVE_KEYS.length).setValues(out);
  }
  return { saved: out.length, duplicates: dupes };
}

function cancelMovement_(id, reason) {
  id = str_(id);
  if (!id) throw new Error('Entry ID is required.');
  const sh = sheet_(SHEET_MOVES);
  const rows = readRows_(sh, MOVE_KEYS.length);
  let rowIdx = -1;
  for (let i = 0; i < rows.length; i++) { if (str_(rows[i][0]) === id) { rowIdx = i; break; } }
  if (rowIdx < 0) throw new Error('Entry ' + id + ' not found.');
  const r = rows[rowIdx];
  if (str_(r[10]).toUpperCase() === 'CANCELLED') return { already: true };

  const sku = str_(r[3]);
  const signed = Number(r[5]) || 0;
  if (!ALLOW_NEGATIVE_STOCK && signed > 0) {
    const have = onHandMap_(readMoves_())[sku] || 0;
    if (have - signed < 0) {
      throw new Error('Cannot cancel: ' + sku + ' would go negative (' + have + ' on hand, entry added ' + signed + ').');
    }
  }
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  const rowNum = rowIdx + 2;
  sh.getRange(rowNum, 11, 1, 4).setValues([['CANCELLED', str_(r[11]), now, str_(reason)]]);
  return { cancelled: id };
}
