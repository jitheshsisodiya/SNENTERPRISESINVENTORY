/**
 * SN Enterprises – Inventory Tracker · Google Apps Script backend
 *
 * Works on the three tabs of your "Inventory Sheet SN Enterprises":
 *
 *   Login            A Login Name | B Password | C Type of access
 *                    ("Super admin access", "Edit access", optionally "View access")
 *   Stock Movement   A Item | B Colour | C Size | D Qty (= opening stock)
 *                    then (added by setup): E Inward | F Outward | G Current Stock (formulas)
 *                    and H HSN | I GST % | J Cost Rate | K Sale Rate | L Reorder Level | M Active | N Category
 *   Inward/ Outward  A Type (Inward/ Outward) | B Date | C Item | D Colour | E Size | F Qty |
 *                    G Entry By | H Date & Time, then I Party | J Ref | K Reason | L Rate |
 *                    M Entry ID | N Status | O Cancelled At | P Cancelled By | Q Cancel Reason
 *
 * Setup: paste this file in Extensions → Apps Script, run setup() once, run
 * "SN Inventory → Hash all passwords", then Deploy → Web app (Execute as: Me, Access: Anyone).
 * Every request must carry a sign-in token issued by login(); roles are re-checked on every call.
 */

const SHEET_LOGIN  = 'Login';
const SHEET_STOCK  = 'Stock Movement';
const SHEET_LEDGER = 'Inward/ Outward';

const ALLOW_NEGATIVE_STOCK = false;   // true = allow outward entries beyond the stock on hand
const SESSION_DAYS = 14;              // how long a phone stays signed in
const HASH_ROUNDS  = 200;
const MAX_FAILS    = 5;               // wrong passwords before a 10-minute lock

const R_ADMIN = 'ADMIN', R_EDITOR = 'EDITOR', R_VIEWER = 'VIEWER';
const PERMS = {
  bootstrap:      [R_ADMIN, R_EDITOR, R_VIEWER],
  addMovements:   [R_ADMIN, R_EDITOR],
  saveItem:       [R_ADMIN],
  saveItems:      [R_ADMIN],
  cancelMovement: [R_ADMIN]
};
const ROLE_LABEL = {ADMIN: 'Super admin', EDITOR: 'Edit access', VIEWER: 'View access'};

// +1 = stock goes up (Inward), -1 = stock goes down (Outward)
const TYPE_DIR = {
  PURCHASE: 1, SALE_RETURN: 1, ADJ_IN: 1, INWARD: 1,
  SALE: -1, PURCHASE_RETURN: -1, ADJ_OUT: -1, OUTWARD: -1
};

const STOCK_FIXED = ['Item', 'Colour', 'Size', 'Qty'];
const STOCK_EXTRA = {5: 'Inward', 6: 'Outward', 7: 'Current Stock', 8: 'HSN', 9: 'GST %', 10: 'Cost Rate',
                     11: 'Sale Rate', 12: 'Reorder Level', 13: 'Active', 14: 'Category'};
const LEDGER_HEADERS = ['Type (Inward/ Outward)', 'Date', 'Item', 'Colour', 'Size', 'Qty', 'Entry By', 'Date & Time',
                        'Party', 'Ref', 'Reason', 'Rate', 'Entry ID', 'Status', 'Cancelled At', 'Cancelled By', 'Cancel Reason'];

/* ───────────────────────────── Menu + setup ───────────────────────────── */

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('SN Inventory')
      .addItem('Run setup / repair sheets', 'setup')
      .addItem('Hash all passwords now', 'hashAllPasswords')
      .addItem('Sign out everyone', 'signOutEveryone')
      .addToUi();
  } catch (e) { /* not opened from the spreadsheet UI */ }
}

function alert_(title, msg) {
  try { SpreadsheetApp.getUi().alert(title, msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(title + ': ' + msg); }
}

function headerStyle_(range) {
  range.setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Login
  const login = ss.getSheetByName(SHEET_LOGIN) || ss.insertSheet(SHEET_LOGIN);
  if (str_(login.getRange(1, 1).getValue()) === '') {
    login.getRange(1, 1, 1, 3).setValues([['Login Name', 'Password', 'Type of access']]);
    headerStyle_(login.getRange(1, 1, 1, 3));
  }
  login.getRange(2, 2, Math.max(login.getMaxRows() - 1, 1), 1).setNumberFormat('@');

  // Stock Movement (item master + opening stock + live totals)
  const stock = ss.getSheetByName(SHEET_STOCK) || ss.insertSheet(SHEET_STOCK);
  if (str_(stock.getRange(1, 1).getValue()) === '') stock.getRange(1, 1, 1, 4).setValues([STOCK_FIXED]);
  Object.keys(STOCK_EXTRA).forEach(function (c) {
    const cell = stock.getRange(1, Number(c));
    if (str_(cell.getValue()) === '') cell.setValue(STOCK_EXTRA[c]);
  });
  headerStyle_(stock.getRange(1, 1, 1, 14));
  stock.setFrozenRows(1);
  stock.getRange('D1').setNote('Opening stock. Current Stock = Opening + Inward − Outward.');
  stock.getRange(2, 1, Math.max(stock.getMaxRows() - 1, 1), 3).setNumberFormat('@');
  const L = "'" + SHEET_LEDGER + "'!";
  const sumf = function (dir) {
    return '=ARRAYFORMULA(IF($A$2:$A="","",SUMIFS(' + L + '$F:$F,' + L + '$A:$A,"' + dir + '",' + L + '$C:$C,$A$2:$A,' +
           L + '$D:$D,$B$2:$B,' + L + '$E:$E,$C$2:$C,' + L + '$N:$N,"<>CANCELLED")))';
  };
  setFormulaIfFree_(stock.getRange('E2'), sumf('Inward'));
  setFormulaIfFree_(stock.getRange('F2'), sumf('Outward'));
  setFormulaIfFree_(stock.getRange('G2'), '=ARRAYFORMULA(IF($A$2:$A="","",IF($D$2:$D="",0,$D$2:$D)+$E$2:$E-$F$2:$F))');

  // Inward/ Outward ledger
  const led = ss.getSheetByName(SHEET_LEDGER) || ss.insertSheet(SHEET_LEDGER);
  LEDGER_HEADERS.forEach(function (h, i) {
    const cell = led.getRange(1, i + 1);
    if (str_(cell.getValue()) === '') cell.setValue(h);
  });
  headerStyle_(led.getRange(1, 1, 1, LEDGER_HEADERS.length));
  led.setFrozenRows(1);
  [2, 5, 8, 13].forEach(function (c) { led.getRange(2, c, Math.max(led.getMaxRows() - 1, 1), 1).setNumberFormat('@'); });

  ensureSecret_();
  alert_('Setup complete',
    'Tabs checked: ' + SHEET_LOGIN + ', ' + SHEET_STOCK + ', ' + SHEET_LEDGER + '.\n\n' +
    'Next: put each user on the Login tab (type of access: "Super admin access", "Edit access" or "View access"), ' +
    'then run SN Inventory → Hash all passwords.');
}

function setFormulaIfFree_(range, formula) {
  const cur = range.getFormula();
  if (cur || str_(range.getValue()) === '') range.setFormula(formula);
}

/* ───────────────────────────── Passwords, users, tokens ───────────────────────────── */

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v).trim();
}
function norm_(v) { return String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase(); }
function clean_(v) { return String(v === null || v === undefined ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function hashPassword_(pw, salt) {
  let bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8);
  for (let i = 0; i < HASH_ROUNDS; i++) bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return hex_(bytes);
}
function newHash_(pw) {
  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return 'h1$' + salt + '$' + hashPassword_(pw, salt);
}
function verifyPassword_(stored, pw) {
  stored = (stored === null || stored === undefined) ? '' : String(stored);
  if (!stored) return false;                         // a blank password never works
  if (stored.indexOf('h1$') === 0) {
    const p = stored.split('$');
    return p.length === 3 && hashPassword_(pw, p[1]) === p[2];
  }
  return stored === pw;                              // plain text, until it is hashed
}

function roleFromText_(t) {
  const s = norm_(t);
  if (/super|admin/.test(s)) return R_ADMIN;
  if (/edit/.test(s)) return R_EDITOR;
  if (/view|read/.test(s)) return R_VIEWER;
  return '';
}

function lastRowOfCol_(sh, col) {
  const n = sh.getMaxRows();
  if (n < 1) return 0;
  const vals = sh.getRange(1, col, n, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) { if (str_(vals[i][0]) !== '') return i + 1; }
  return 0;
}
function ensureRows_(sh, needed) {
  const m = sh.getMaxRows();
  if (needed > m) sh.insertRowsAfter(m, needed - m + 50);
}
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing. Run setup() first.');
  return sh;
}

function findUser_(name) {
  const sh = sheet_(SHEET_LOGIN);
  const last = lastRowOfCol_(sh, 1);
  if (last < 2) return null;
  const rows = sh.getRange(2, 1, last - 1, 3).getValues();
  const want = norm_(name);
  for (let i = 0; i < rows.length; i++) {
    if (norm_(rows[i][0]) === want && want !== '') {
      return {row: i + 2, name: str_(rows[i][0]), pass: rows[i][1], role: roleFromText_(rows[i][2])};
    }
  }
  return null;
}

function hashAllPasswords() {
  const sh = sheet_(SHEET_LOGIN);
  const last = lastRowOfCol_(sh, 1);
  let n = 0;
  if (last >= 2) {
    const rng = sh.getRange(2, 2, last - 1, 1);
    const vals = rng.getValues();
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i][0] === null || vals[i][0] === undefined ? '' : String(vals[i][0]);
      if (v !== '' && v.indexOf('h1$') !== 0) { vals[i][0] = newHash_(v); n++; }
    }
    if (n) rng.setValues(vals);
  }
  alert_('Passwords', n + ' password(s) were scrambled. Anyone opening this sheet can no longer read them.\n' +
    'To set a new password for someone, type it in their Password cell and run this again.');
}

function ensureSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}
function signOutEveryone() {
  PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  alert_('Signed out', 'Everyone has to sign in again.');
}

function makeToken_(name) {
  const p = Utilities.base64EncodeWebSafe(JSON.stringify({u: name, e: Date.now() + SESSION_DAYS * 86400000}));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(p, ensureSecret_()));
  return p + '.' + sig;
}
function authErr_() { const e = new Error('Please sign in again.'); e.auth = true; return e; }

function authenticate_(token) {
  if (!token || String(token).indexOf('.') < 0) throw authErr_();
  const parts = String(token).split('.');
  const expect = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], ensureSecret_()));
  if (parts[1] !== expect) throw authErr_();
  let data;
  try { data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (e) { throw authErr_(); }
  if (!data || !data.e || data.e < Date.now()) throw authErr_();
  const u = findUser_(data.u);                       // role is re-read from the Login tab on every call
  if (!u || !u.role) throw authErr_();
  return {name: u.name, role: u.role};
}

function login_(name, pw) {
  name = str_(name); pw = (pw === null || pw === undefined) ? '' : String(pw);
  if (!name || !pw) throw new Error('Enter your user name and password.');
  const cache = CacheService.getScriptCache();
  const fk = 'lf:' + norm_(name);
  const fails = Number(cache.get(fk) || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong attempts. Try again in 10 minutes.');
  const u = findUser_(name);
  if (!u || !verifyPassword_(u.pass, pw)) {
    cache.put(fk, String(fails + 1), 600);
    throw new Error('Wrong user name or password.');
  }
  if (!u.role) throw new Error('This user has no access yet. Ask the admin to set the type of access.');
  cache.remove(fk);
  const stored = String(u.pass);
  if (stored.indexOf('h1$') !== 0) sheet_(SHEET_LOGIN).getRange(u.row, 2).setValue(newHash_(pw));   // upgrade plain text on first sign-in
  return {token: makeToken_(u.name), user: {name: u.name, role: u.role}};
}

/* ───────────────────────────── HTTP ───────────────────────────── */

function doGet() { return json_({ok: true, service: 'SN Enterprises Inventory API'}); }

function doPost(e) {
  let lock = null;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action, p = body.payload || {};
    if (action === 'login') return json_(Object.assign({ok: true}, login_(p.user, p.password)));

    const user = authenticate_(body.token);
    const allowed = PERMS[action];
    if (!allowed) throw new Error('Unknown action: ' + action);
    if (allowed.indexOf(user.role) < 0) throw new Error('Your access level (' + ROLE_LABEL[user.role] + ') cannot do this.');

    if (action === 'bootstrap') {
      const items = readItemRows_();
      const byKey = keyMap_(items);
      const moves = readMoves_(byKey);
      return json_({ok: true, user: user, items: items.map(publicItem_), moves: moves,
                    orphans: moves.filter(function (m) { return !m.sku; }).length, serverTime: new Date().toISOString()});
    }

    // All writes are serialised so several people can enter at once.
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let res;
    if (action === 'saveItem') res = saveItems_([p.item], true);
    else if (action === 'saveItems') res = saveItems_(p.items || [], false);
    else if (action === 'addMovements') res = addMovements_(p.movements || [], user);
    else if (action === 'cancelMovement') res = cancelMovement_(p.id, p.reason, user);
    SpreadsheetApp.flush();
    return json_(Object.assign({ok: true}, res));
  } catch (err) {
    return json_({ok: false, error: String(err && err.message ? err.message : err), auth: !!(err && err.auth)});
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) { /* already released */ } }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────────── Items (Stock Movement tab) ───────────────────────────── */

function keyOf_(item, colour, size) { return [item, colour, size].map(norm_).join('|'); }

// Short codes (e.g. DOTKNIT-S-YEL) are worked out from Item / Size / Colour; they are not stored in the sheet.
function assignSkus_(rows) {
  const prefixOf = {}, usedPrefix = {}, used = {};
  rows.forEach(function (it) {
    const nk = norm_(it.item);
    if (!prefixOf[nk]) {
      const base = clean_(it.item).slice(0, 10) || 'ITEM';
      let p = base, n = 2;
      while (usedPrefix[p]) { p = base + n++; }
      prefixOf[nk] = p; usedPrefix[p] = 1;
    }
    const sz = clean_(it.size), col = clean_(it.colour);
    let len = 3, sku;
    do {
      sku = [prefixOf[nk], sz, col.slice(0, len)].filter(Boolean).join('-');
      len++;
    } while (used[sku] && len <= col.length + 1);
    const base2 = sku; let n2 = 2;
    while (used[sku]) { sku = base2 + '-' + n2++; }
    used[sku] = 1; it.sku = sku;
  });
}

function readItemRows_() {
  const sh = sheet_(SHEET_STOCK);
  const last = lastRowOfCol_(sh, 1);
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, 14).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    if (str_(r[0]) === '') return;
    out.push({row: i + 2, item: str_(r[0]), colour: str_(r[1]), size: str_(r[2]), opening: Number(r[3]) || 0,
              hsn: str_(r[7]), gst: Number(r[8]) || 0, cost: Number(r[9]) || 0, sale: Number(r[10]) || 0,
              reorder: Number(r[11]) || 0, active: str_(r[12]).toUpperCase() !== 'NO', category: str_(r[13])});
  });
  assignSkus_(out);
  return out;
}
function publicItem_(i) {
  return {sku: i.sku, item: i.item, colour: i.colour, size: i.size, opening: i.opening, hsn: i.hsn, gst: i.gst,
          cost: i.cost, sale: i.sale, reorder: i.reorder, active: i.active, category: i.category};
}
function keyMap_(items) {
  const m = {};
  items.forEach(function (i) { const k = keyOf_(i.item, i.colour, i.size); if (!m[k]) m[k] = i; });
  return m;
}

function cleanItem_(it, update) {
  it = it || {};
  const item = str_(it.item);
  if (!item) throw new Error('Item name is required.');
  const sku = str_(it.sku).toUpperCase();
  if (update && !sku) throw new Error('SKU is required to update an item.');
  const nonNeg = function (v, label) {
    const n = Number(v || 0);
    if (!isFinite(n) || n < 0) throw new Error(label + ' must be zero or more for ' + item + '.');
    return n;
  };
  const gst = nonNeg(it.gst, 'GST %');
  if (gst > 100) throw new Error('GST % looks wrong for ' + item + '.');
  return {sku: sku, item: item, colour: str_(it.colour), size: str_(it.size), category: str_(it.category), hsn: str_(it.hsn),
          gst: gst, cost: nonNeg(it.cost, 'Cost rate'), sale: nonNeg(it.sale, 'Sale rate'), reorder: nonNeg(it.reorder, 'Reorder level'),
          opening: nonNeg(it.opening, 'Opening qty'), active: it.active === false ? 'No' : 'Yes'};
}

// update=true  → overwrite rates/opening/etc. of an existing SKU (Item, Colour, Size never change)
// update=false → add new rows; combinations that already exist are skipped and reported
function saveItems_(items, update) {
  if (!items.length) throw new Error('No items supplied.');
  const sh = sheet_(SHEET_STOCK);
  const cur = readItemRows_();
  const bySku = {}; cur.forEach(function (i) { bySku[i.sku] = i; });
  const byKey = keyMap_(cur);
  const cleaned = items.map(function (x) { return cleanItem_(x, update); });
  const seen = {};
  cleaned.forEach(function (c) {
    const k = update ? c.sku : keyOf_(c.item, c.colour, c.size);
    if (seen[k]) throw new Error('"' + (update ? c.sku : [c.item, c.colour, c.size].join(' / ')) + '" appears twice in this request.');
    seen[k] = 1;
  });

  const saved = [], skipped = [], abcd = [], hn = [];
  cleaned.forEach(function (c) {
    if (update) {
      const row = bySku[c.sku];
      if (!row) throw new Error('SKU ' + c.sku + ' does not exist.');
      sh.getRange(row.row, 4).setValue(c.opening);
      sh.getRange(row.row, 8, 1, 7).setValues([[c.hsn, c.gst, c.cost, c.sale, c.reorder, c.active, c.category]]);
      saved.push(c.sku);
    } else if (byKey[keyOf_(c.item, c.colour, c.size)]) {
      skipped.push([c.item, c.colour, c.size].join(' / '));
    } else {
      abcd.push([c.item, c.colour, c.size, c.opening]);
      hn.push([c.hsn, c.gst, c.cost, c.sale, c.reorder, c.active, c.category]);
      saved.push([c.item, c.colour, c.size].join(' / '));
    }
  });
  if (abcd.length) {
    const start = lastRowOfCol_(sh, 1) + 1;
    ensureRows_(sh, start + abcd.length - 1);
    sh.getRange(start, 1, abcd.length, 3).setNumberFormat('@');
    sh.getRange(start, 1, abcd.length, 4).setValues(abcd);   // columns E–G hold formulas, so they are never written
    sh.getRange(start, 8, hn.length, 7).setValues(hn);
  }
  return {saved: saved, skipped: skipped};
}

/* ───────────────────────────── Ledger (Inward/ Outward tab) ───────────────────────────── */

function readMoves_(byKey) {
  const sh = sheet_(SHEET_LEDGER);
  const last = lastRowOfCol_(sh, 3);
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, 17).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    if (str_(r[2]) === '') return;
    const t = norm_(r[0]);
    const dir = t.indexOf('in') === 0 ? 1 : t.indexOf('out') === 0 ? -1 : 0;
    const qty = Number(r[5]) || 0;
    if (!dir || !qty) return;                                  // unreadable rows are ignored, not guessed at
    const reason = str_(r[10]).toUpperCase();
    const type = (TYPE_DIR[reason] === dir) ? reason : (dir > 0 ? 'INWARD' : 'OUTWARD');
    const it = byKey[keyOf_(r[2], r[3], r[4])];
    out.push({
      id: str_(r[12]) || ('ROW' + (i + 2)), date: str_(r[1]), type: type, sku: it ? it.sku : '',
      item: str_(r[2]), colour: str_(r[3]), size: str_(r[4]), qty: qty, signedQty: dir * qty,
      rate: Number(r[11]) || 0, party: str_(r[8]), ref: str_(r[9]), enteredBy: str_(r[6]), createdAt: str_(r[7]),
      status: str_(r[13]).toUpperCase() === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
      cancelledAt: str_(r[14]), cancelledBy: str_(r[15]), cancelReason: str_(r[16])
    });
  });
  return out;
}

function stockMap_(items, moves) {
  const m = {};
  items.forEach(function (i) { m[i.sku] = i.opening; });
  moves.forEach(function (x) { if (x.status === 'ACTIVE' && x.sku) m[x.sku] = (m[x.sku] || 0) + x.signedQty; });
  return m;
}

function nowStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }

function addMovements_(list, user) {
  if (!list.length) throw new Error('No stock lines supplied.');
  const items = readItemRows_();
  const bySku = {}; items.forEach(function (i) { bySku[i.sku] = i; });
  const moves = readMoves_(keyMap_(items));
  const ids = {}; moves.forEach(function (m) { ids[m.id] = 1; });
  const stock = stockMap_(items, moves);
  const now = nowStr_();
  const out = [], dupes = [];

  list.forEach(function (m, idx) {
    const line = 'Line ' + (idx + 1) + ': ';
    const id = str_(m.id);
    if (!id) throw new Error(line + 'missing entry ID.');
    if (ids[id]) { dupes.push(id); return; }                  // a retry of something already saved
    const type = str_(m.type).toUpperCase();
    const dir = TYPE_DIR[type];
    if (!dir) throw new Error(line + 'unknown type "' + type + '".');
    const sku = str_(m.sku).toUpperCase();
    const it = bySku[sku];
    if (!it) throw new Error(line + 'SKU "' + sku + '" is not in the Stock Movement tab.');
    if (!it.active) throw new Error(line + sku + ' is inactive.');
    const qty = Number(m.qty);
    if (!isFinite(qty) || qty <= 0 || Math.round(qty) !== qty) throw new Error(line + 'quantity must be a whole number above zero (' + sku + ').');
    const rate = Number(m.rate || 0);
    if (!isFinite(rate) || rate < 0) throw new Error(line + 'rate cannot be negative (' + sku + ').');
    const date = str_(m.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(line + 'date must be YYYY-MM-DD.');
    const after = (stock[sku] || 0) + dir * qty;
    if (!ALLOW_NEGATIVE_STOCK && after < 0) throw new Error(line + sku + ' has only ' + (stock[sku] || 0) + ' in stock; cannot take out ' + qty + '.');
    stock[sku] = after; ids[id] = 1;
    out.push([dir > 0 ? 'Inward' : 'Outward', date, it.item, it.colour, it.size, qty, user.name, now,
              str_(m.party), str_(m.ref), type, rate, id, 'ACTIVE', '', '', '']);
  });

  if (out.length) {
    const sh = sheet_(SHEET_LEDGER);
    const start = lastRowOfCol_(sh, 3) + 1;
    ensureRows_(sh, start + out.length - 1);
    [2, 5, 8, 13].forEach(function (c) { sh.getRange(start, c, out.length, 1).setNumberFormat('@'); });
    sh.getRange(start, 1, out.length, 17).setValues(out);
  }
  return {saved: out.length, duplicates: dupes};
}

function cancelMovement_(id, reason, user) {
  id = str_(id);
  if (!id) throw new Error('Entry ID is required.');
  const items = readItemRows_();
  const moves = readMoves_(keyMap_(items));
  const m = moves.filter(function (x) { return x.id === id; })[0];
  if (!m) throw new Error('Entry ' + id + ' not found.');
  if (m.status === 'CANCELLED') return {already: true};
  if (!ALLOW_NEGATIVE_STOCK && m.signedQty > 0 && m.sku) {
    const have = stockMap_(items, moves)[m.sku] || 0;
    if (have - m.signedQty < 0) throw new Error('Cannot cancel: ' + m.sku + ' would go negative (' + have + ' on hand, entry added ' + m.signedQty + ').');
  }
  const sh = sheet_(SHEET_LEDGER);
  let rowNum = -1;
  if (/^ROW\d+$/.test(id)) rowNum = Number(id.slice(3));
  else {
    const last = lastRowOfCol_(sh, 3);
    const ids = sh.getRange(2, 13, Math.max(last - 1, 1), 1).getValues();
    for (let i = 0; i < ids.length; i++) { if (str_(ids[i][0]) === id) { rowNum = i + 2; break; } }
  }
  if (rowNum < 2) throw new Error('Entry ' + id + ' not found in the sheet.');
  sh.getRange(rowNum, 14, 1, 4).setValues([['CANCELLED', nowStr_(), user.name, str_(reason)]]);
  return {cancelled: id};
}
