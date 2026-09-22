const DB_NAME = 'QuranAudioDB';
const STORE_NAME = 'audioFiles';
let db = null;

const TOTAL_QURAN_AYAHS = 6236;

const SURAH_AYAH_COUNTS = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
];

/* =====================================================
   IndexedDB
   ===================================================== */
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getAllStoredItems() {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).openCursor();
    const items = [];
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const val = cursor.value;
        let size = 0;
        if (val instanceof Blob) size = val.size;
        else if (typeof val === 'string') size = new Blob([val]).size;
        else if (val) size = new Blob([JSON.stringify(val)]).size;
        items.push({ key: cursor.key.toString(), value: val, size });
        cursor.continue();
      } else resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/* =====================================================
   Helpers
   ===================================================== */
function parseAudioKey(key) {
  if (key.startsWith('meta_') || key.startsWith('surah_data_') ||
      key.startsWith('tafsir_') || key.startsWith('surah_bundle_')) return null;
  const parts = key.split('_');
  if (parts.length < 3) return null;
  const ayahNum = parts[parts.length - 1];
  const surahNum = parts[parts.length - 2];
  const reciterId = parts.slice(0, parts.length - 2).join('_');
  if (!/^\d+$/.test(ayahNum) || !/^\d+$/.test(surahNum)) return null;
  return { reciterId, surahNum: parseInt(surahNum, 10), ayahNum: parseInt(ayahNum, 10) };
}

function getSelectedReciterId() {
  const sel = document.getElementById('bulk-reciter-select');
  return sel ? sel.value : null;
}

function populateBulkReciterSelect() {
  const sel = document.getElementById('bulk-reciter-select');
  if (!sel) return;
  sel.innerHTML = Object.entries(BulkDownloader.RECITERS)
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join('');
}

/* =====================================================
   تقدير الحجم من بيانات فعلية
   ===================================================== */
async function computeEstimatedSizeMB(reciterId) {
  try {
    if (!db) await initDB();
    const items = await getAllStoredItems();
    let totalBytes = 0, count = 0;
    for (const item of items) {
      const p = parseAudioKey(item.key);
      if (p && p.reciterId === reciterId && item.value instanceof Blob) {
        totalBytes += item.value.size;
        count++;
      }
    }
    if (count >= 10) {
      const avg = totalBytes / count;
      return Math.round((avg * TOTAL_QURAN_AYAHS) / (1024 * 1024));
    }
  } catch (e) { console.warn('estimate from DB failed:', e); }
  return BulkDownloader.estimateSizeMB(reciterId);
}

async function updateEstimatedSize() {
  const reciterId = getSelectedReciterId();
  if (!reciterId) return;
  const el = document.getElementById('estimated-size');
  if (!el) return;
  el.innerText = 'جاري الحساب...';
  try {
    const mb = await computeEstimatedSizeMB(reciterId);
    if (mb >= 1024) el.innerText = `≈ ${(mb / 1024).toFixed(2)} جيجابايت`;
    else el.innerText = `≈ ${mb} ميجابايت`;
  } catch (e) {
    console.error(e);
    el.innerText = '—';
  }
}

/* =====================================================
   تحميل الإحصائيات + قائمة القراء (مع دمج التنزيلات النشطة)
   ===================================================== */
async function loadStorageStats() {
  try {
    if (!db) await initDB();
    const items = await getAllStoredItems();

    const reciterGroups = {};

    for (const item of items) {
      const p = parseAudioKey(item.key);
      if (!p) continue;
      if (!reciterGroups[p.reciterId]) {
        reciterGroups[p.reciterId] = { reciterId: p.reciterId, totalCount: 0, totalSize: 0, surahs: new Set() };
      }
      reciterGroups[p.reciterId].totalCount++;
      reciterGroups[p.reciterId].totalSize += item.size;
      reciterGroups[p.reciterId].surahs.add(p.surahNum);
    }

    try {
      const activeStates = (typeof BulkDownloader !== 'undefined' && BulkDownloader.getAllStates)
        ? BulkDownloader.getAllStates()
        : [];
      activeStates.forEach(st => {
        if (!reciterGroups[st.reciterId]) {
          reciterGroups[st.reciterId] = { reciterId: st.reciterId, totalCount: 0, totalSize: 0, surahs: new Set() };
        }
        reciterGroups[st.reciterId].isActive = true;
        reciterGroups[st.reciterId].activeStatus = st.status;
        reciterGroups[st.reciterId].activeProgress = Math.round((st.totalDone / TOTAL_QURAN_AYAHS) * 100);
      });
    } catch (e) { console.error('merge active states failed:', e); }

    const totalBytes = items.reduce((acc, it) => acc + it.size, 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    const storageSizeEl = document.getElementById('storage-size');
    if (storageSizeEl) storageSizeEl.innerText = `${totalMB} ميجابايت`;

    const recitersArr = Object.values(reciterGroups).sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return b.totalSize - a.totalSize;
    });

    const listEl = document.getElementById('reciter-storage-list');
    if (listEl) {
      if (recitersArr.length === 0) {
        listEl.innerHTML = '<div class="text-slate-400 text-xs py-2">لا يوجد قراء لديهم تنزيلات.</div>';
      } else {
        listEl.innerHTML = recitersArr.map(r => {
          const rName = BulkDownloader.RECITERS[r.reciterId] || r.reciterId;
          const sizeMB = (r.totalSize / (1024 * 1024)).toFixed(2);
          const diskPercent = Math.round((r.totalCount / TOTAL_QURAN_AYAHS) * 100);
          const isComplete = r.totalCount >= TOTAL_QURAN_AYAHS;
          const isActive = !!r.isActive;
          const activeProgress = r.activeProgress || 0;
          const activeStatus = r.activeStatus || 'running';

          let badge, barColor, percent;
          if (isActive && activeStatus === 'paused') {
            badge = '<span class="text-amber-300 text-[10px] bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">⏸ متوقف مؤقتاً</span>';
            barColor = 'bg-amber-400';
            percent = activeProgress;
          } else if (isActive) {
            badge = '<span class="text-sky-300 text-[10px] bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded-full">⏳ قيد التنزيل</span>';
            barColor = 'bg-sky-400 animate-pulse';
            percent = activeProgress;
          } else if (isComplete) {
            badge = '<span class="text-emerald-400 text-[10px] bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">✓ مكتمل</span>';
            barColor = 'bg-emerald-500';
            percent = diskPercent;
          } else {
            badge = '<span class="text-amber-300 text-[10px] bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">جزئي</span>';
            barColor = 'bg-amber-400';
            percent = diskPercent;
          }

          const rNameSafe = rName.replace(/"/g, '&quot;');
          const infoLine = isActive
            ? `${activeProgress}% • ${r.totalCount} آية محفوظة`
            : `${r.surahs.size} سورة • ${r.totalCount} آية • ${sizeMB} م.ب`;

          return `
            <div class="py-2 px-2 sm:px-3 border border-slate-700/60 bg-slate-900/50 hover:bg-slate-700/30 rounded-lg transition space-y-1.5">
              <div class="flex items-center justify-between gap-2">
                <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <div class="text-slate-100 font-bold text-xs sm:text-sm truncate">${rName}</div>
                  ${badge}
                </div>
                <button
                  type="button"
                  data-dl-action="delete-reciter"
                  data-reciter="${r.reciterId}"
                  data-reciter-name="${rNameSafe}"
                  data-surahs="${r.surahs.size}"
                  data-count="${r.totalCount}"
                  class="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition shrink-0 cursor-pointer select-none"
                  title="حذف كل ملفات هذا القارئ">
                  <i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i>
                </button>
              </div>
              <div class="flex items-center justify-between text-[10px] sm:text-xs text-slate-300">
                <span>${infoLine}</span>
                <span class="${isActive ? 'text-sky-300' : (isComplete ? 'text-emerald-400' : 'text-amber-300')} font-bold">${percent}%</span>
              </div>
              <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                <div class="${barColor} h-full transition-all duration-300" style="width: ${Math.min(percent, 100)}%"></div>
              </div>
            </div>`;
        }).join('');
      }
    }

    try { lucide.createIcons(); } catch (e) { console.error(e); }
  } catch (e) {
    console.error(e);
    const storageSizeEl = document.getElementById('storage-size');
    if (storageSizeEl) storageSizeEl.innerText = '0.00 ميجابايت';
    const listEl = document.getElementById('reciter-storage-list');
    if (listEl) listEl.innerHTML = '<div class="text-red-400 text-xs py-2">تعذّر قراءة بيانات التخزين.</div>';
  }
}

/* =====================================================
   حذف كل ملفات قارئ
   ===================================================== */
async function deleteAllForReciter(reciterId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).openCursor();
    let deleted = 0;
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const parsed = parseAudioKey(cursor.key.toString());
        if (parsed && parsed.reciterId === reciterId) {
          cursor.delete();
          deleted++;
        }
        cursor.continue();
      } else resolve(deleted);
    };
    req.onerror = () => reject(req.error);
  });
}

/* =====================================================
   عرض قسم التنزيلات النشطة
   ===================================================== */
function renderActiveDownloads() {
  if (typeof BulkDownloader === 'undefined') return;

  const panel = document.getElementById('active-downloads-panel');
  const list = document.getElementById('active-downloads-list');
  const countEl = document.getElementById('active-downloads-count');
  if (!panel || !list || !countEl) return;

  let all = [];
  try { all = BulkDownloader.getAllStates() || []; } catch (e) { console.error(e); return; }

  countEl.innerText = all.length;

  if (all.length === 0) {
    panel.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');

  list.innerHTML = all.map(s => {
    const rName = BulkDownloader.RECITERS[s.reciterId] || s.reciterId;
    const pct = Math.round((s.totalDone / TOTAL_QURAN_AYAHS) * 100);
    const isPaused = s.status === 'paused';
    const barClass = isPaused
      ? 'bg-amber-400 h-full transition-all duration-200'
      : 'bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-200';
    const statusLabel = isPaused ? '⏸ متوقف مؤقتاً' : '⏳ جارٍ';
    const statusColor = isPaused ? 'text-amber-300' : 'text-emerald-400';

    const pauseClass = isPaused
      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
      : 'bg-amber-500 hover:bg-amber-400 text-slate-950';
    const pauseIcon = isPaused ? 'play' : 'pause';
    const pauseText = isPaused ? 'استئناف' : 'إيقاف مؤقت';

    const rNameSafe = rName.replace(/"/g, '&quot;');

    return `
      <div class="bg-slate-900/60 border border-slate-700 rounded-xl p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="text-slate-100 font-bold text-xs sm:text-sm truncate flex-1">${rName}</div>
          <div class="text-[10px] sm:text-xs ${statusColor} shrink-0">${statusLabel}</div>
        </div>
        <div class="w-full bg-slate-950 rounded-full h-2 overflow-hidden">
          <div class="${barClass}" style="width: ${pct}%"></div>
        </div>
        <div class="flex items-center justify-between text-[10px] sm:text-xs text-slate-300">
          <span>${pct}%</span>
          <span>سورة ${Math.min(s.surahNum, 114)}/114</span>
          <span>${s.totalDone}/${TOTAL_QURAN_AYAHS}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button"
                  data-dl-action="toggle-pause"
                  data-reciter="${s.reciterId}"
                  class="${pauseClass} font-bold py-1.5 rounded-lg text-[11px] sm:text-xs flex items-center justify-center gap-1 cursor-pointer select-none">
            <i data-lucide="${pauseIcon}" class="w-3.5 h-3.5 pointer-events-none"></i>
            <span class="pointer-events-none">${pauseText}</span>
          </button>
          <button type="button"
                  data-dl-action="cancel"
                  data-reciter="${s.reciterId}"
                  data-reciter-name="${rNameSafe}"
                  class="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-bold py-1.5 rounded-lg text-[11px] sm:text-xs flex items-center justify-center gap-1 cursor-pointer select-none">
            <i data-lucide="x" class="w-3.5 h-3.5 pointer-events-none"></i>
            <span class="pointer-events-none">إلغاء</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  try { lucide.createIcons(); } catch (e) { console.error(e); }
}

/* =====================================================
   الدوال العامة للأزرار
   ===================================================== */
window.dlTogglePause = function (rid) {
  try {
    if (typeof BulkDownloader === 'undefined') return;
    const st = BulkDownloader.getState(rid);
    if (!st) return;
    if (st.status === 'running') BulkDownloader.pauseDownload(rid);
    else if (st.status === 'paused') BulkDownloader.resumeDownload(rid);
  } catch (e) { console.error('dlTogglePause:', e); }
};

window.dlCancel = function (rid, rName) {
  try {
    if (typeof BulkDownloader === 'undefined') return;
    const name = rName || BulkDownloader.RECITERS[rid] || rid;
    if (!confirm(`هل تريد إلغاء التنزيل للقارئ "${name}"؟\nسيُحفظ ما تم تنزيله حتى الآن.`)) return;
    BulkDownloader.cancelDownload(rid);
    renderActiveDownloads();
    refreshSelectedReciterUI();
    loadStorageStats();
  } catch (e) {
    console.error('dlCancel:', e);
    alert('حدث خطأ أثناء الإلغاء.');
  }
};

window.dlToggleCollapse = function () {
  const listEl = document.getElementById('active-downloads-list');
  const icon = document.getElementById('active-downloads-toggle-icon');
  if (!listEl) return;
  listEl.classList.toggle('hidden');
  if (icon) icon.style.transform = listEl.classList.contains('hidden') ? 'rotate(180deg)' : '';
};

window.deleteReciterFiles = async function (rid, rName, surahs, count) {
  try {
    if (typeof BulkDownloader !== 'undefined' && BulkDownloader.getState(rid)) {
      if (!confirm(`القارئ "${rName}" لديه تنزيل نشط.\nهل تريد إيقافه وحذف كل ملفاته؟`)) return;
      try { BulkDownloader.cancelDownload(rid); } catch (e) {}
    } else {
      if (!confirm(`⚠️ تحذير - تأكيد الحذف\n\nسيتم حذف جميع الملفات الصوتية للقارئ:\n"${rName}"\n\n• عدد السور: ${surahs}\n• عدد الآيات: ${count}\n\nهل أنت متأكد؟`)) return;
      if (!confirm(`تأكيد نهائي: حذف كل ملفات "${rName}"؟ لا يمكن التراجع.`)) return;
    }
    const deleted = await deleteAllForReciter(rid);
    await loadStorageStats();
    renderActiveDownloads();
    alert(`تم حذف ${deleted} ملف صوتي للقارئ "${rName}".`);
  } catch (e) {
    console.error(e);
    alert('حدث خطأ أثناء الحذف.');
  }
};

/* =====================================================
   ربط الأزرار العامة (pointerdown + pointerup)
   ===================================================== */
function setupGlobalButtonHandlers() {
  let pending = null;

  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button[data-dl-action]');
    if (!btn) return;
    pending = {
      action: btn.getAttribute('data-dl-action'),
      reciter: btn.getAttribute('data-reciter'),
      reciterName: btn.getAttribute('data-reciter-name') || '',
      surahs: btn.getAttribute('data-surahs'),
      count: btn.getAttribute('data-count'),
      x: e.clientX,
      y: e.clientY
    };
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (Math.abs(e.clientX - p.x) > 15 || Math.abs(e.clientY - p.y) > 15) return;

    switch (p.action) {
      case 'toggle-pause':
        if (p.reciter) window.dlTogglePause(p.reciter);
        break;
      case 'cancel':
        if (p.reciter) window.dlCancel(p.reciter, p.reciterName);
        break;
      case 'delete-reciter':
        if (p.reciter) window.deleteReciterFiles(p.reciter, p.reciterName, p.surahs, p.count);
        break;
      case 'toggle-collapse':
        window.dlToggleCollapse();
        break;
    }
  }, true);

  document.addEventListener('pointercancel', () => { pending = null; }, true);
}

/* =====================================================
   تحديث واجهة القارئ المحدد
   ===================================================== */
function refreshSelectedReciterUI() {
  const btnStart = document.getElementById('download-all-quran');
  const statusEl = document.getElementById('selected-reciter-status');
  const reciterId = getSelectedReciterId();
  if (!btnStart || !reciterId) return;

  const st = BulkDownloader.getState(reciterId);

  if (st && (st.status === 'running' || st.status === 'paused')) {
    btnStart.disabled = true;
    btnStart.classList.add('opacity-60', 'cursor-not-allowed');
    if (st.status === 'paused') {
      btnStart.innerHTML = '<i data-lucide="pause-circle" class="w-4 h-4"></i> التنزيل متوقف مؤقتاً';
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.innerHTML = '⏸ التنزيل لهذا القارئ متوقف مؤقتاً. يمكنك الاستئناف من قسم التنزيلات النشطة أعلاه.';
      }
    } else {
      btnStart.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> التنزيل جارٍ...';
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.innerHTML = '⏳ التنزيل لهذا القارئ جارٍ الآن. تابع التقدم من قسم التنزيلات النشطة أعلاه.';
      }
    }
  } else {
    btnStart.disabled = false;
    btnStart.classList.remove('opacity-60', 'cursor-not-allowed');
    btnStart.innerHTML = '<i data-lucide="download-cloud" class="w-4 h-4"></i> تنزيل القرآن كاملاً لهذا القارئ';
    if (statusEl) statusEl.classList.add('hidden');
  }
  try { lucide.createIcons(); } catch (e) { console.error(e); }
}

/* ---------- تحديث إحصائيات القراء بشكل مُهدَّأ أثناء التنزيل ---------- */
let statsTimer = null;
function scheduleStatsRefresh(delay = 900) {
  if (statsTimer) return;
  statsTimer = setTimeout(async () => {
    statsTimer = null;
    try { await loadStorageStats(); } catch (e) { console.error(e); }
  }, delay);
}

function refreshAllUI() {
  refreshSelectedReciterUI();
  renderActiveDownloads();
  scheduleStatsRefresh();
}

/* =====================================================
   أحداث التنزيل الكامل
   ===================================================== */
function attachBulkEvents() {
  BulkDownloader.on('change', () => refreshAllUI());

  BulkDownloader.on('done', (summary) => {
    refreshAllUI();
    loadStorageStats();

    if (summary.cancelled) return;

    const rName = BulkDownloader.RECITERS[summary.reciterId] || summary.reciterId;

    if (summary.error) {
      alert(`توقف التنزيل للقارئ "${rName}" بسبب خطأ.\n\nتم تنزيل: ${summary.totalDone} آية.`);
    } else {
      alert(`تم تنزيل القرآن الكريم كاملاً بنجاح للقارئ "${rName}"!\n\nعدد الآيات المنزّلة: ${summary.totalDone}\nموجودة سابقاً: ${summary.totalSkipped}\nفشل: ${summary.totalFailed}`);
    }
  });
}

async function handleStartDownload() {
  const reciterId = getSelectedReciterId();
  if (!reciterId) return;

  const existing = BulkDownloader.getState(reciterId);
  if (existing && (existing.status === 'running' || existing.status === 'paused')) {
    alert('هذا القارئ لديه تنزيل نشط بالفعل. يمكنك إدارته من قسم التنزيلات النشطة.');
    return;
  }

  const reciterName = BulkDownloader.RECITERS[reciterId] || reciterId;
  const estMB = await computeEstimatedSizeMB(reciterId);
  const estText = estMB >= 1024 ? `${(estMB / 1024).toFixed(2)} جيجابايت` : `${estMB} ميجابايت`;

  const confirmed = confirm(
    `⚠️ تأكيد التنزيل الكامل\n\nسيتم تنزيل القرآن الكريم كاملاً (114 سورة، 6236 آية) بصوت:\n"${reciterName}"\n\nالحجم التقريبي: ${estText}\n\nهل تريد المتابعة؟`
  );
  if (!confirmed) return;

  await BulkDownloader.startDownload(reciterId, estMB);
}

/* =====================================================
   حذف كل شيء
   ===================================================== */
async function handleClearAll() {
  if (!db) await initDB();
  const items = await getAllStoredItems();
  if (items.length === 0) { alert('لا توجد بيانات محفوظة أصلاً.'); return; }

  const totalBytes = items.reduce((acc, item) => acc + item.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

  if (!confirm(`⚠️ تحذير شديد\n\nسيتم حذف جميع التنزيلات والبيانات المخزنة:\n• إجمالي الملفات: ${items.length}\n• إجمالي المساحة: ${totalMB} ميجابايت\n\nهل أنت متأكد؟`)) return;
  if (!confirm('تأكيد نهائي: هل تريد بالفعل حذف كل شيء؟ لا يمكن التراجع.')) return;

  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      alert('تم تفريغ مساحة التخزين المحلية بالكامل.');
      loadStorageStats();
    };
    tx.onerror = () => alert('حدث خطأ أثناء تفريغ المساحة.');
  } catch (e) { alert('حدث خطأ أثناء تفريغ المساحة.'); }
}

/* =====================================================
   Theme
   ===================================================== */
function applyThemeSettings() {
  const theme = document.getElementById('theme-select').value;
  document.documentElement.classList.toggle('theme-light', theme === 'light');
  const body = document.getElementById('settings-body');
  const container = document.getElementById('settings-container');
  if (theme === 'light') {
    body.className = "bg-slate-100 text-slate-900 min-h-screen flex flex-col items-center p-2 sm:p-4 md:p-8 transition-colors duration-300";
    container.className = "w-full max-w-2xl bg-white border border-slate-200 rounded-2xl p-3 sm:p-5 md:p-6 shadow-xl space-y-5 sm:space-y-6 transition-colors duration-300";
  } else {
    body.className = "bg-slate-950 text-slate-100 min-h-screen flex flex-col items-center p-2 sm:p-4 md:p-8 transition-colors duration-300";
    container.className = "w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-5 md:p-6 shadow-xl space-y-5 sm:space-y-6 transition-colors duration-300";
  }
}

/* =====================================================
   Init
   ===================================================== */
window.onload = async () => {
  try { await initDB(); } catch (e) { console.error(e); }

  populateBulkReciterSelect();
  await updateEstimatedSize();

  const savedTheme = localStorage.getItem('app_theme') || 'dark';
  document.getElementById('theme-select').value = savedTheme;
  applyThemeSettings();

  await loadStorageStats();
  try { lucide.createIcons(); } catch (e) { console.error(e); }

  attachBulkEvents();
  setupGlobalButtonHandlers();

  document.getElementById('bulk-reciter-select').addEventListener('change', () => {
    updateEstimatedSize();
    refreshSelectedReciterUI();
  });

  document.getElementById('clear-all-storage').addEventListener('click', handleClearAll);
  document.getElementById('download-all-quran').addEventListener('click', handleStartDownload);

  document.getElementById('save-appearance').addEventListener('click', () => {
    localStorage.setItem('app_theme', document.getElementById('theme-select').value);
    applyThemeSettings();
    alert('تم حفظ وتطبيق المظهر بنجاح!');
  });

  try { await BulkDownloader.resumeIfNeeded(); } catch (e) { console.error(e); }
  refreshAllUI();
};

/* =====================================================
   إعادة التهيئة عند العودة إلى الصفحة من bfcache
   ===================================================== */
window.addEventListener('pageshow', async (e) => {
  if (!e.persisted) return;

  // 1) إعادة تطبيق الثيم
  try {
    const savedTheme = localStorage.getItem('app_theme') || 'dark';
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = savedTheme;
    applyThemeSettings();
  } catch (err) { console.error('pageshow theme:', err); }

  // 2) إعادة تحميل الإحصائيات
  try { await loadStorageStats(); } catch (err) { console.error('pageshow stats:', err); }

  // 3) إعادة استئناف التنزيلات إن وُجدت + تحديث الواجهة
  try {
    if (typeof BulkDownloader !== 'undefined') {
      await BulkDownloader.resumeIfNeeded();
    }
  } catch (err) { console.error('pageshow resume:', err); }

  try { refreshAllUI(); } catch (err) { console.error('pageshow refresh:', err); }
});