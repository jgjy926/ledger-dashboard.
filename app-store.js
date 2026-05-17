/* app-store.js — Multi-month offline ledger store (LocalStorage)
   Rules:
   - Amount > 0  => Debit (Out / Expense)
   - Amount < 0  => Credit (In / Income)
*/

/* =========================
   Cloud (Koofr via Worker)
   ========================= */

// ✅ Your Worker URL
const CLOUD_API = "https://ledger-api.jgjy926.workers.dev"; // <-- change if needed

// Small helper: call status renderer only if it exists
function _safeStatus(msg) {
  try {
    if (typeof setStatus === "function") setStatus(msg);
    else console.log("[status]", msg);
  } catch (e) {
    console.log("[status]", msg);
  }
}

// Small helper: call render only if it exists
function _safeRender() {
  try {
    if (typeof render === "function") render();
  } catch (e) {
    console.warn("render() failed:", e);
  }
}

/**
 * Load ledger state from cloud and import into localStorage
 */
async function cloudLoad() {
  _safeStatus("Loading from cloud…");

  const r = await fetch(CLOUD_API + "/ledger", { method: "GET" });
  if (!r.ok) throw new Error("Cloud load failed: HTTP " + r.status);

  const data = await r.json();
  const st = data.state || data; // supports either {state:{...}} or direct state

  if (!AppStore.importState(st)) throw new Error("Cloud data invalid.");

  _safeStatus("Loaded from cloud.");
  _safeRender();
}

/**
 * Save ledger state to cloud from localStorage
 */
async function cloudSave() {
  _safeStatus("Saving to cloud…");

  const payload = {
    v: 1,
    savedAt: new Date().toISOString(),
    state: AppStore.exportState()
  };

  const r = await fetch(CLOUD_API + "/ledger", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.ok) throw new Error("Cloud save failed: HTTP " + r.status);

  _safeStatus("Saved to cloud.");
}

/**
 * Wire up the two buttons:
 * <button id="btnCloudLoad">Load Cloud</button>
 * <button id="btnCloudSave">Save Cloud</button>
 *
 * Call this from your main init().
 * (Also auto-called on DOMContentLoaded.)
 */
function wireCloudButtons() {
  const loadBtn = document.getElementById("btnCloudLoad");
  const saveBtn = document.getElementById("btnCloudSave");

  if (loadBtn) {
    loadBtn.onclick = async () => {
      try {
        await cloudLoad();
      } catch (e) {
        _safeStatus("Cloud load error: " + (e?.message || e));
      }
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      try {
        await cloudSave();
      } catch (e) {
        _safeStatus("Cloud save error: " + (e?.message || e));
      }
    };
  }
}

// Auto-wire when DOM is ready (safe if buttons don’t exist)
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", wireCloudButtons);
}

/* =========================
   AppStore (LocalStorage)
   ========================= */

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
    const date = String(r?.date || "").slice(0, 10);
    let amount = Number(r?.amount || 0);
    if (!isFinite(amount)) amount = 0;

    const month = r?.month || _monthKey(date);

    return {
      id: r?.id || _id(),
      date,
      month,
      details: String(r?.details || "").trim(),
      amount,
      remark: String(r?.remark || "").trim()
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

  /* =========================
     REQUIRED: export/import full state
     ========================= */

  const exportState = () => ({
    tx: _load(KEY_TX, []),
    opening: _load(KEY_OPEN, {}),
    lock: _load(KEY_LOCK, {})
  });

  const importState = (st) => {
    if (!st || typeof st !== "object") return false;

    if (Array.isArray(st.tx)) _save(KEY_TX, st.tx);
    if (st.opening && typeof st.opening === "object") _save(KEY_OPEN, st.opening);
    if (st.lock && typeof st.lock === "object") _save(KEY_LOCK, st.lock);

    return true;
  };

  return {
    getAll, getById, getByMonth, add, addMany, update, remove, clearAll,
    getOpening, setOpening, isMonthLocked, setMonthLocked,
    getMonthLedger, getAllMonthLedgers, getStatsAll,
    exportJSON,
    exportState, importState
  };
})();