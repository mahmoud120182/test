// وحدة التنزيل المشتركة - تدعم تنزيلات متعددة متزامنة (كل قارئ على حدة)
(function () {
  const DB_NAME = 'QuranAudioDB';
  const STORE_NAME = 'audioFiles';
  const STATE_KEY = 'quran_bulk_downloads_v2';

  const RECITERS = {
    'banna_hf': 'محمود علي البنا (مرتل)',
    'ar.minshawi': 'محمد صديق المنشاوي',
    'ar.husary': 'محمود خليل الحصري',
    'ar.abdulbasitmurattal': 'عبد الباسط عبد الصمد (مرتل)',
    'ar.muhammadjibreel': 'محمد جبريل',
    'aymansowaid': 'أيمن سويد',
    'ar.mahermuaiqly': 'ماهر المعيقلي',
    'yasserdosari': 'ياسر الدوسري',
    'ar.abdurrahmaansudais': 'عبد الرحمن السديس',
    'ar.saoodshuraym': 'سعود الشريم',
    'ar.hudhaify': 'علي الحذيفي',
    'ar.ibrahimakhdar': 'إبراهيم الأخضر',
    'ar.alafasy': 'مشاري العفاسي',
    'ar.shaatree': 'أبو بكر الشاطري',
    'ar.muhammadayyoub': 'محمد أيوب',
    'ar.abdullahbasfar': 'عبد الله بصفر',
    'ar.ahmedajamy': 'أحمد بن علي العجمي',
    'ar.hanirifai': 'هاني الرفاعي',
    'ar.parhizgar': 'شهريار پرهيزكار'
  };

  const EVERYAYAH_FOLDERS = {
    'banna_hf': 'mahmoud_ali_al_banna_32kbps',
    'yasserdosari': 'Yasser_Ad-Dussary_128kbps',
    'aymansowaid': 'Ayman_Sowaid_64kbps',
    'ibrahimakhdar': 'Ibrahim_Akhdar_32kbps'
  };

  const RECITER_BITRATES = {
    'banna_hf': 32, 'yasserdosari': 128, 'aymansowaid': 64, 'ibrahimakhdar': 32,
    'ar.alafasy': 128, 'ar.husary': 128, 'ar.minshawi': 128
  };
  const DEFAULT_BITRATE = 64;
  const TOTAL_QURAN_SECONDS = 12 * 3600;

  const SURAH_AYAH_COUNTS = [
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
    112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
    54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
    14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
    29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
    11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
  ];
  const TOTAL_AYAHS = SURAH_AYAH_COUNTS.reduce((a, b) => a + b, 0);

  const listeners = { change: [], done: [] };
  let db = null;
  const states = {};   // { reciterId: state }
  const tokens = {};   // { reciterId: number }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME);
      };
    });
  }

  function idbGet(key) {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const r = tx.objectStore(STORE_NAME).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  function idbPut(key, val) {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const r = tx.objectStore(STORE_NAME).put(val, key);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  }

  /* ---------- Persistence ---------- */
  function persist() {
    const out = {};
    for (const id in states) {
      const s = states[id];
      out[id] = {
        reciterId: s.reciterId,
        surahNum: s.surahNum,
        ayahNum: s.ayahNum,
        totalDone: s.totalDone,
        totalSkipped: s.totalSkipped,
        totalFailed: s.totalFailed,
        status: s.status,
        startedAt: s.startedAt,
        estimatedMB: s.estimatedMB
      };
    }
    if (Object.keys(out).length === 0) localStorage.removeItem(STATE_KEY);
    else localStorage.setItem(STATE_KEY, JSON.stringify(out));
  }

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  /* ---------- Events ---------- */
  function emitChange() {
    const snap = Object.values(states).map(s => ({ ...s }));
    (listeners.change || []).forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } });
  }
  function emitDone(summary) {
    (listeners.done || []).forEach(cb => { try { cb(summary); } catch (e) { console.error(e); } });
  }

  /* ---------- Helpers ---------- */
  async function buildSurahUrls(reciterId, surahNum) {
    const folder = EVERYAYAH_FOLDERS[reciterId];
    if (folder) {
      const sStr = String(surahNum).padStart(3, '0');
      const count = SURAH_AYAH_COUNTS[surahNum - 1];
      const list = [];
      for (let a = 1; a <= count; a++) {
        list.push({ ayahNum: a, url: `https://www.everyayah.com/data/${folder}/${sStr}${String(a).padStart(3, '0')}.mp3` });
      }
      return list;
    }
    const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/${reciterId}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.data.ayahs.map(a => ({ ayahNum: a.numberInSurah, url: a.audio }));
  }

  function estimateSizeMB(reciterId) {
    const kbps = RECITER_BITRATES[reciterId] || DEFAULT_BITRATE;
    return Math.round((TOTAL_QURAN_SECONDS * kbps) / 8 / 1024);
  }

  function isStopped(reciterId, myToken) {
    return tokens[reciterId] !== myToken || !states[reciterId];
  }

  async function waitWhilePaused(reciterId, myToken) {
    while (true) {
      if (isStopped(reciterId, myToken)) return;
      const st = states[reciterId];
      if (!st || st.status !== 'paused') return;
      await sleep(250);
    }
  }

  /* ---------- Run loop per reciter ---------- */
  async function runLoop(reciterId, myToken) {
    await openDB();
    if (isStopped(reciterId, myToken)) return;

    const state = states[reciterId];
    if (!state) return;

    try {
      for (let s = state.surahNum || 1; s <= 114; s++) {
        if (isStopped(reciterId, myToken)) return;
        await waitWhilePaused(reciterId, myToken);
        if (isStopped(reciterId, myToken)) return;

        let urls = [];
        try {
          urls = await buildSurahUrls(state.reciterId, s);
        } catch (e) {
          if (isStopped(reciterId, myToken)) return;
          state.totalDone += SURAH_AYAH_COUNTS[s - 1];
          state.totalFailed += SURAH_AYAH_COUNTS[s - 1];
          state.surahNum = s + 1;
          state.ayahNum = 0;
          persist();
          emitChange();
          continue;
        }

        if (isStopped(reciterId, myToken)) return;

        // ابدأ من الآية التالية للآية الأخيرة المحفوظة (استئناف دقيق)
        const isResume = (s === state.surahNum && state.ayahNum > 0);
        const firstAyah = isResume ? state.ayahNum + 1 : 1;

        for (const item of urls) {
          if (isStopped(reciterId, myToken)) return;
          await waitWhilePaused(reciterId, myToken);
          if (isStopped(reciterId, myToken)) return;

          if (item.ayahNum < firstAyah) continue;

          const key = `${state.reciterId}_${s}_${item.ayahNum}`;
          try {
            const existing = await idbGet(key);
            if (isStopped(reciterId, myToken)) return;
            if (existing) {
              state.totalSkipped++;
            } else if (item.url) {
              const resp = await fetch(item.url);
              if (isStopped(reciterId, myToken)) return;
              if (!resp.ok) throw new Error('HTTP ' + resp.status);
              const blob = await resp.blob();
              if (isStopped(reciterId, myToken)) return;
              await idbPut(key, blob);
            }
          } catch (e) {
            if (isStopped(reciterId, myToken)) return;
            state.totalFailed++;
          }
          state.totalDone++;
          state.surahNum = s;
          state.ayahNum = item.ayahNum;
          persist();
          emitChange();
        }

        state.surahNum = s + 1;
        state.ayahNum = 0;
        persist();
        emitChange();
      }

      if (isStopped(reciterId, myToken)) return;
      const summary = { ...state, completed: true };
      delete states[reciterId];
      persist();
      emitChange();
      emitDone(summary);
    } catch (e) {
      console.error('Bulk download error:', e);
      if (!states[reciterId]) return;
      const summary = { ...state, error: true };
      delete states[reciterId];
      persist();
      emitChange();
      emitDone(summary);
    }
  }

  /* ---------- Public API ---------- */
  async function startDownload(reciterId, estimatedMB) {
    const existing = states[reciterId];
    if (existing && (existing.status === 'running' || existing.status === 'paused')) {
      return { ...existing };
    }

    await openDB();

    const myToken = (tokens[reciterId] || 0) + 1;
    tokens[reciterId] = myToken;

    states[reciterId] = {
      reciterId,
      surahNum: 1,
      ayahNum: 0,
      totalDone: 0,
      totalSkipped: 0,
      totalFailed: 0,
      status: 'running',
      startedAt: Date.now(),
      estimatedMB
    };
    persist();
    emitChange();

    runLoop(reciterId, myToken);
    return { ...states[reciterId] };
  }

  function pauseDownload(reciterId) {
    const st = states[reciterId];
    if (!st || st.status !== 'running') return;
    st.status = 'paused';
    persist();
    emitChange();
  }

  function resumeDownload(reciterId) {
    const st = states[reciterId];
    if (!st || st.status !== 'paused') return;
    st.status = 'running';
    persist();
    emitChange();
    const myToken = (tokens[reciterId] || 0) + 1;
    tokens[reciterId] = myToken;
    runLoop(reciterId, myToken);
  }

  function cancelDownload(reciterId) {
    const st = states[reciterId];
    if (!st) return;
    const summary = { ...st, cancelled: true };
    // نُبطل الرمز أولاً ثم نحذف الحالة حتى يتوقف الحلقة فوراً
    tokens[reciterId] = (tokens[reciterId] || 0) + 1;
    delete states[reciterId];
    persist();
    emitChange();
    emitDone(summary);
  }

  function getState(reciterId) {
    return states[reciterId] ? { ...states[reciterId] } : null;
  }

  function getAllStates() {
    return Object.values(states).map(s => ({ ...s }));
  }

  async function resumeIfNeeded() {
    const persisted = loadPersisted();
    let any = false;
    for (const id in persisted) {
      states[id] = persisted[id];
      any = true;
    }
    if (!any) return;
    await openDB();
    for (const id in states) {
      if (states[id].status === 'running') {
        const myToken = (tokens[id] || 0) + 1;
        tokens[id] = myToken;
        runLoop(id, myToken);
      }
    }
    emitChange();
  }

  function on(event, cb) {
    if (listeners[event]) listeners[event].push(cb);
  }

  window.BulkDownloader = {
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    getState,
    getAllStates,
    resumeIfNeeded,
    on,
    TOTAL_AYAHS,
    SURAH_AYAH_COUNTS,
    RECITERS,
    EVERYAYAH_FOLDERS,
    RECITER_BITRATES,
    DEFAULT_BITRATE,
    estimateSizeMB
  };
})();