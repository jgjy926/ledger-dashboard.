/* app-store.js — Multi-month offline ledger store (LocalStorage)
   Rules:
   - Amount > 0  => Debit (Out / Expense)
   - Amount < 0  => Credit (In / Income)
*/

const AppStore = (() => {
  const KEY_TX = "ott_tx_v2";
  const KEY_OPEN = "ott_opening_v2";
  const KEY_LOCK = "ott_lock_v2";

  function _load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function _save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function _id() {
    return "tx_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function _monthKey(dateISO) {
    return String(dateISO || "").slice(0, 7);
  }

  function _norm(r) {
    const date = String(r.date || "").slice(0, 10);
    let amount = Number(r.amount || 0);
    if (!isFinite(amount)) amount = 0;

    const month = r.month || _monthKey(date);

    return {
      id: r.id || _id(),
      date,
      month,
      details: String(r.details || "").trim(),
      amount,
      remark: String(r.remark || "").trim()
    };
  }

  function getAll() {
    const arr = _load(KEY_TX, []).map(_norm);
    _save(KEY_TX, arr);
    arr.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return arr;
  }

  function getById(id) {
    return getAll().find(x => x.id === id) || null;
  }

  function getByMonth() {
    const arr = getAll();
    const map = {};
    for (const r of arr) {
      if (!map[r.month]) map[r.month] = [];
      map[r.month].push(r);
    }
    // sort records within each month by date asc
    for (const m of Object.keys(map)) {
      map[m].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    }
    // sort months asc
    return Object.fromEntries(Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])));
  }

  function isMonthLocked(month) {
    const m = _load(KEY_LOCK, {});
    return Boolean(m[month]);
  }

  function setMonthLocked(month, locked) {
    const m = _load(KEY_LOCK, {});
    m[month] = Boolean(locked);
    _save(KEY_LOCK, m);
  }

  function getOpening(month) {
    const m = _load(KEY_OPEN, {});
    const v = Number(m[month] ?? 0);
    return isFinite(v) ? v : 0;
  }

  function setOpening(month, value) {
    const m = _load(KEY_OPEN, {});
    m[month] = Number(value || 0);
    _save(KEY_OPEN, m);
  }

  function add(record) {
    const arr = _load(KEY_TX, []).map(_norm);
    const rec = _norm(record);

    if (!rec.date || !rec.details || rec.amount === 0) return false;
    if (isMonthLocked(rec.month)) return false;

    arr.push(rec);
    _save(KEY_TX, arr);
    return true;
  }

  function addMany(records) {
    const arr = _load(KEY_TX, []).map(_norm);
    let added = 0;

    for (const r of records || []) {
      const rec = _norm(r);
      if (!rec.date || !rec.details || rec.amount === 0) continue;
      if (isMonthLocked(rec.month)) continue;
      arr.push(rec);
      added++;
    }
    _save(KEY_TX, arr);
    return added;
  }

  function update(id, patch) {
    const arr = _load(KEY_TX, []).map(_norm);
    const idx = arr.findIndex(x => x.id === id);
    if (idx < 0) return false;

    const next = _norm({ ...arr[idx], ...patch, id });
    if (isMonthLocked(next.month)) return false;

    arr[idx] = next;
    _save(KEY_TX, arr);
    return true;
  }

  function remove(id) {
    const arr = _load(KEY_TX, []).map(_norm);
    const rec = arr.find(x => x.id === id);
    if (rec && isMonthLocked(rec.month)) return false;

    _save(KEY_TX, arr.filter(x => x.id !== id));
    return true;
  }

  function clearAll() {
    localStorage.removeItem(KEY_TX);
    localStorage.removeItem(KEY_OPEN);
    localStorage.removeItem(KEY_LOCK);
  }

  function getMonthLedger(month) {
    const map = getByMonth();
    const months = Object.keys(map);

    // carry forward if opening not set
    let opening = getOpening(month);
    if (!opening) {
      const idx = months.indexOf(month);
      if (idx > 0) {
        const prevMonth = months[idx - 1];
        const prevLedger = getMonthLedger(prevMonth);
        opening = prevLedger.closing;
      }
    }

    let debit = 0;
    let credit = 0;
    let running = opening;

    const rows = (map[month] || []).map(r => {
      const amt = Number(r.amount || 0);
      if (amt > 0) debit += amt;
      if (amt < 0) credit += Math.abs(amt);
      running += amt;
      return { ...r, running };
    });

    return {
      month,
      opening,
      debit,
      credit,
      net: credit - debit,
      closing: running,
      rows
    };
  }

  function getAllMonthLedgers() {
    const map = getByMonth();
    return Object.keys(map).map(m => getMonthLedger(m));
  }

  function getStatsAll() {
    const ledgers = getAllMonthLedgers();
    let count = 0, totalDebit = 0, totalCredit = 0;
    for (const l of ledgers) {
      count += l.rows.length;
      totalDebit += l.debit;
      totalCredit += l.credit;
    }
    return { count, totalDebit, totalCredit, net: totalCredit - totalDebit };
  }

  function exportJSON() {
    return JSON.stringify(getAll(), null, 2);
  }

  return {
    key: KEY_TX,
    getAll,
    getById,
    getByMonth,
    add,
    addMany,
    update,
    remove,
    clearAll,
    getOpening,
    setOpening,
    isMonthLocked,
    setMonthLocked,
    getMonthLedger,
    getAllMonthLedgers,
    getStatsAll,
    exportJSON
  };
})();