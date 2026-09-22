// State Management - قائمة القراء الشاملة والمضمونة (مرتبة حسب الطلب)
const RECITERS = [
  // القراء المصريون
  { id: 'banna_hf', name: 'محمود علي البنا (مرتل)' },
  { id: 'ar.minshawi', name: 'محمد صديق المنشاوي' },
  { id: 'ar.husary', name: 'محمود خليل الحصري (إذاعة القرآن)' },
  { id: 'ar.abdulbasitmurattal', name: 'عبد الباسط عبد الصمد (مرتل)' },
  { id: 'ar.muhammadjibreel', name: 'محمد جبريل' },
  { id: 'aymansowaid', name: 'أيمن سويد' },

  // قراء الحرم
  { id: 'ar.mahermuaiqly', name: 'ماهر المعيقلي' },
  { id: 'yasserdosari', name: 'ياسر الدوسري' },
  { id: 'ar.abdurrahmaansudais', name: 'عبد الرحمن السديس' },
  { id: 'ar.saoodshuraym', name: 'سعود الشريم' },
  { id: 'ar.hudhaify', name: 'علي بن عبدالرحمن الحذيفي' },
  { id: 'ar.ibrahimakhdar', name: 'إبراهيم الأخضر' },

  // باقي القراء
  { id: 'ar.alafasy', name: 'مشاري راشد العفاسي' },
  { id: 'ar.shaatree', name: 'أبو بكر الشاطري' },
  { id: 'ar.muhammadayyoub', name: 'محمد أيوب' },
  { id: 'ar.abdullahbasfar', name: 'عبد الله بصفر' },
  { id: 'ar.ahmedajamy', name: 'أحمد بن علي العجمي' },
  { id: 'ar.hanirifai', name: 'هاني الرفاعي' },
  { id: 'ar.parhizgar', name: 'شهريار پرهيزكار' }
];

let surahs = [];
let currentSurah = null;
let ayahsData = [];
let activeAyahIndex = 0;
let isPlaying = false;

const audio = new Audio();
const nextAudio = new Audio(); // مشغل مساعد لتجهيز الصوت التالي مسبقاً وتفادي أي تأخير

// IndexedDB Storage Setup for Permanent Local Storage
const DB_NAME = 'QuranAudioDB';
const STORE_NAME = 'audioFiles';
let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

function saveToDB(key, data) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(data, key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function getFromDB(key) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteFromDB(key) {
  return new Promise((resolve, reject) => {
    if (!db) return reject('DB not initialized');
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// DOM Elements
const surahsListEl = document.getElementById('surahs-list');
const ayahsContainerEl = document.getElementById('ayahs-container');
const reciterSelectEl = document.getElementById('reciter-select');
const currentSurahTitle = document.getElementById('current-surah-title');
const currentSurahInfo = document.getElementById('current-surah-info');
const bismillahEl = document.getElementById('bismillah');
const playBtn = document.getElementById('play-btn');
const audioInfo = document.getElementById('audio-info');
const searchInput = document.getElementById('search-input');
const mobileSearchInput = document.getElementById('mobile-search-input');
const tafsirModal = document.getElementById('tafsir-modal');

// Sidebar DOM Elements
const sidebarEl = document.getElementById('sidebar');
const sidebarOverlayEl = document.getElementById('sidebar-overlay');
const toggleSidebarBtn = document.getElementById('toggle-sidebar');
const closeSidebarBtn = document.getElementById('close-sidebar');

// Initialize Application
async function init() {
  try {
    await initDB();
  } catch (e) {
    console.error('IndexedDB init failed:', e);
  }

  populateReciters();
  lucide.createIcons();

  await fetchSurahs();
  if (surahs.length > 0) {
    loadSurah(1); // Load Al-Fatihah by default
  }

  setupEventListeners();
  setupSidebarEvents();
  setupMediaSession();
}

function populateReciters() {
  reciterSelectEl.innerHTML = RECITERS.map(r =>
    `<option value="${r.id}">${r.name}</option>`
  ).join('');
}

async function fetchSurahs() {
  try {
    const cachedSurahs = await getFromDB('meta_surahs_list');
    if (cachedSurahs) {
      surahs = cachedSurahs;
      renderSurahsList(surahs);
      return;
    }

    const res = await fetch('https://api.alquran.cloud/v1/surah');
    const data = await res.json();
    surahs = data.data;
    await saveToDB('meta_surahs_list', surahs);
    renderSurahsList(surahs);
  } catch (err) {
    console.error('Failed to load surahs:', err);
    ayahsContainerEl.innerHTML = '<div class="text-center py-12 text-red-400">لا يوجد اتصال بالإنترنت، يرجى الاتصال مرة واحدة على الأقل لتحميل القائمة أولاً.</div>';
  }
}

function renderSurahsList(list) {
  surahsListEl.innerHTML = list.map(s => `
    <button
      onclick="loadSurah(${s.number})"
      class="w-full text-right px-4 py-3 flex items-center justify-between transition hover:bg-slate-800/50 ${currentSurah?.number === s.number ? 'bg-emerald-500/10 border-r-4 border-emerald-500' : ''}"
    >
      <div class="flex items-center gap-3">
        <span class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${currentSurah?.number === s.number ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'}">
          ${s.number}
        </span>
        <div class="truncate">
          <div class="font-bold text-slate-200 truncate">${s.name}</div>
          <div class="text-xs text-slate-500">${s.revelationType === 'Meccan' ? 'مكية' : 'مدنية'} • ${s.numberOfAyahs} آية</div>
        </div>
      </div>
    </button>
  `).join('');
}

async function loadSurah(surahNum, autoPlayAfterLoad = false) {
  currentSurah = surahs.find(s => s.number === surahNum);
  renderSurahsList(surahs);

  closeSidebarDrawer();

  currentSurahTitle.innerText = currentSurah.name;
  currentSurahInfo.innerText = '';

  bismillahEl.classList.toggle('hidden', surahNum === 1 || surahNum === 9);

  ayahsContainerEl.innerHTML = '<div class="text-center py-12 opacity-70 text-slate-300">جاري تحميل الآيات...</div>';

  try {
    const selectedReciterId = reciterSelectEl.value;
    const cacheKey = `surah_data_${selectedReciterId}_${surahNum}`;

    const cachedAyahsData = await getFromDB(cacheKey);

    if (cachedAyahsData) {
      ayahsData = cachedAyahsData;
    } else {
      let arabic, audioItems;

      const everyAyahFolders = {
        'banna_hf': 'mahmoud_ali_al_banna_32kbps',
        'yasserdosari': 'Yasser_Ad-Dussary_128kbps',
        'aymansowaid': 'Ayman_Sowaid_64kbps',
        'ibrahimakhdar': 'Ibrahim_Akhdar_32kbps'
      };

      if (everyAyahFolders[selectedReciterId]) {
        const folderName = everyAyahFolders[selectedReciterId];
        const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/editions/quran-uthmani`);
        const data = await res.json();
        arabic = data.data[0].ayahs;

        ayahsData = arabic.map((a) => {
          let text = a.text;

          if (surahNum !== 1 && surahNum !== 9 && a.numberInSurah === 1) {
            const bismillahPrefix = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ";
            if (text.startsWith(bismillahPrefix)) {
              text = text.replace(bismillahPrefix, "");
            }
          }

          const sStr = String(surahNum).padStart(3, '0');
          const aStr = String(a.numberInSurah).padStart(3, '0');
          const audioUrl = `https://www.everyayah.com/data/${folderName}/${sStr}${aStr}.mp3`;

          return {
            number: a.numberInSurah,
            globalNumber: a.number,
            text: text,
            audio: audioUrl,
            storageKey: `${selectedReciterId}_${surahNum}_${a.numberInSurah}`
          };
        });
      } else {
        const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/editions/quran-uthmani,${selectedReciterId}`);
        const data = await res.json();

        arabic = data.data[0].ayahs;
        audioItems = data.data[1].ayahs;

        ayahsData = arabic.map((a, i) => {
          let text = a.text;

          if (surahNum !== 1 && surahNum !== 9 && a.numberInSurah === 1) {
            const bismillahPrefix = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ";
            if (text.startsWith(bismillahPrefix)) {
              text = text.replace(bismillahPrefix, "");
            }
          }

          return {
            number: a.numberInSurah,
            globalNumber: a.number,
            text: text,
            audio: audioItems[i]?.audio || '',
            storageKey: `${selectedReciterId}_${surahNum}_${a.numberInSurah}`
          };
        });
      }

      await saveToDB(cacheKey, ayahsData);
    }

    activeAyahIndex = 0;
    renderAyahs();

    if (autoPlayAfterLoad) {
      playAyah(0);
    }
  } catch (err) {
    console.error('Error loading surah:', err);
    ayahsContainerEl.innerHTML = '<div class="text-center py-12 text-red-400">عذراً، تعذر تحميل الآيات. تأكد من اتصالك بالإنترنت في المرة الأولى لفتح السورة وحفظها محلياً.</div>';
  }
}

function renderAyahs() {
  ayahsContainerEl.innerHTML = ayahsData.map((a, idx) => {
    const isActive = activeAyahIndex === idx;

    return `
      <div id="ayah-${idx}" class="p-4 sm:p-6 rounded-xl border transition-all duration-300 ${isActive ? 'bg-emerald-950/30 border-emerald-500/50 shadow-lg' : 'bg-slate-800/30 border-slate-800'}">
        <div class="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
          <span class="bg-slate-800/80 text-emerald-400 border border-slate-700 text-xs font-bold px-3 py-1 rounded-full">
            ${currentSurah.number}:${a.number}
          </span>
          <div class="flex items-center gap-1">
            <button onclick="playAyah(${idx})" class="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400" aria-label="تشغيل">
              <i data-lucide="${isActive && isPlaying ? 'pause' : 'play'}" class="w-4 h-4"></i>
            </button>
            <button onclick="openTafsir(${a.globalNumber})" class="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400" aria-label="التفسير">
              <i data-lucide="info" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <p class="font-quran text-2xl sm:text-3xl md:text-4xl leading-loose text-right mb-4 text-slate-100">${a.text}</p>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

async function playAyah(index) {
  activeAyahIndex = index;
  const currentAyah = ayahsData[index];

  if (!currentAyah || !currentAyah.audio) return;

  let audioSourceUrl = currentAyah.audio;

  try {
    const cachedBlob = await getFromDB(currentAyah.storageKey);
    if (cachedBlob) {
      audioSourceUrl = URL.createObjectURL(cachedBlob);
    }
  } catch (e) {}

  audio.src = audioSourceUrl;
  audio.play().then(() => {
    isPlaying = true;
    updateAudioUI();
    updateMediaSession();

    if (index + 1 < ayahsData.length && ayahsData[index + 1].audio) {
      getFromDB(ayahsData[index + 1].storageKey).then(blob => {
        nextAudio.src = blob ? URL.createObjectURL(blob) : ayahsData[index + 1].audio;
        nextAudio.load();
      }).catch(() => {
        nextAudio.src = ayahsData[index + 1].audio;
        nextAudio.load();
      });
    }
  }).catch((err) => {
    console.error("Audio playback error:", err);
  });

  renderAyahs();

  document.getElementById(`ayah-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateAudioUI() {
  playBtn.innerHTML = `<i data-lucide="${isPlaying ? 'pause' : 'play'}" class="w-5 h-5 fill-current"></i>`;
  audioInfo.innerText = `${currentSurah.name} - الآية ${activeAyahIndex + 1}`;
  lucide.createIcons();
}

function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
      audio.play();
      isPlaying = true;
      updateAudioUI();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause();
      isPlaying = false;
      updateAudioUI();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (activeAyahIndex > 0) {
        playAyah(activeAyahIndex - 1);
      }
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (activeAyahIndex < ayahsData.length - 1) {
        playAyah(activeAyahIndex + 1);
      } else if (currentSurah && currentSurah.number < 114) {
        loadSurah(currentSurah.number + 1, true);
      }
    });
  }
}

function updateMediaSession() {
  if ('mediaSession' in navigator && currentSurah) {
    const selectedReciter = RECITERS.find(r => r.id === reciterSelectEl.value);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${currentSurah.name} - الآية ${activeAyahIndex + 1}`,
      artist: selectedReciter ? selectedReciter.name : 'القرآن الكريم',
      album: currentSurah.englishName,
    });
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}

function openSidebarDrawer() {
  sidebarEl.classList.remove('translate-x-full');
  sidebarOverlayEl.classList.remove('hidden');
}

function closeSidebarDrawer() {
  if (window.innerWidth < 1024) {
    sidebarEl.classList.add('translate-x-full');
    sidebarOverlayEl.classList.add('hidden');
  }
}

function setupSidebarEvents() {
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', openSidebarDrawer);
  }
  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', closeSidebarDrawer);
  }
  if (sidebarOverlayEl) {
    sidebarOverlayEl.addEventListener('click', closeSidebarDrawer);
  }
}

function setupEventListeners() {
  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      audio.pause();
      isPlaying = false;
    } else {
      playAyah(activeAyahIndex);
    }
    updateAudioUI();
    updateMediaSession();
  });

  audio.addEventListener('ended', () => {
    if (activeAyahIndex < ayahsData.length - 1) {
      playAyah(activeAyahIndex + 1);
    } else if (currentSurah && currentSurah.number < 114) {
      loadSurah(currentSurah.number + 1, true);
    } else {
      isPlaying = false;
      updateAudioUI();
      updateMediaSession();
    }
  });

  document.getElementById('prev-btn').addEventListener('click', () => {
    if (activeAyahIndex > 0) playAyah(activeAyahIndex - 1);
  });

  document.getElementById('next-btn').addEventListener('click', () => {
    if (activeAyahIndex < ayahsData.length - 1) {
      playAyah(activeAyahIndex + 1);
    } else if (currentSurah && currentSurah.number < 114) {
      loadSurah(currentSurah.number + 1, true);
    }
  });

  reciterSelectEl.addEventListener('change', () => {
    if (currentSurah) loadSurah(currentSurah.number, isPlaying);
  });

  const filterSurahs = (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = surahs.filter(s => s.name.includes(q) || s.englishName.toLowerCase().includes(q) || s.number.toString() === q);
    renderSurahsList(filtered);
  };

  searchInput.addEventListener('input', filterSurahs);
  mobileSearchInput.addEventListener('input', filterSurahs);

  document.getElementById('close-tafsir').addEventListener('click', () => {
    tafsirModal.classList.add('hidden');
  });
}

async function openTafsir(globalAyahNumber) {
  tafsirModal.classList.add('hidden');
  tafsirModal.classList.remove('hidden');
  document.getElementById('tafsir-content').innerText = 'جاري تحميل التفسير الميسر...';

  try {
    const cachedTafsir = await getFromDB(`tafsir_${globalAyahNumber}`);
    if (cachedTafsir) {
      document.getElementById('tafsir-content').innerText = cachedTafsir;
      return;
    }

    const res = await fetch(`https://api.alquran.cloud/v1/ayah/${globalAyahNumber}/ar.muyassar`);
    const data = await res.json();
    const text = data.data.text;
    document.getElementById('tafsir-content').innerText = text;
    await saveToDB(`tafsir_${globalAyahNumber}`, text);
  } catch (err) {
    document.getElementById('tafsir-content').innerText = 'عذراً، تعذر تحميل التفسير لعدم توفر الاتصال بالإنترنت.';
  }
}

/* ---------- Theme ---------- */
function applyTheme() {
  const theme = localStorage.getItem('app_theme') || 'dark';
  document.documentElement.classList.toggle('theme-light', theme === 'light');
}

/* =====================================================
   لوحة التنزيلات النشطة
   ===================================================== */
/* =====================================================
   قسم التنزيلات النشطة (مدمج في الصفحة)
   ===================================================== */
function renderActiveDownloads() {
  if (typeof BulkDownloader === 'undefined') return;

  const panel = document.getElementById('active-downloads-panel');
  const list = document.getElementById('active-downloads-list');
  const countEl = document.getElementById('active-downloads-count');
  if (!panel || !list || !countEl) return;

  let all = [];
  try {
    all = BulkDownloader.getAllStates() || [];
  } catch (e) {
    console.error('getAllStates failed:', e);
    return;
  }

  countEl.innerText = all.length;

  if (all.length === 0) {
    panel.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');

  list.innerHTML = all.map(s => {
    const rName = BulkDownloader.RECITERS[s.reciterId] || s.reciterId;
    const pct = Math.round((s.totalDone / BulkDownloader.TOTAL_AYAHS) * 100);
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
    const pauseText = isPaused ? 'استئناف' : 'إيقاف';

    return `
      <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="text-slate-100 font-bold text-xs sm:text-sm truncate flex-1">${rName}</div>
          <div class="text-[10px] sm:text-xs ${statusColor} shrink-0">${statusLabel}</div>
        </div>
        <div class="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
          <div class="${barClass}" style="width: ${pct}%"></div>
        </div>
        <div class="flex items-center justify-between text-[10px] sm:text-xs text-slate-300">
          <span>${pct}%</span>
          <span>سورة ${Math.min(s.surahNum, 114)}/114</span>
          <span>${s.totalDone}/${BulkDownloader.TOTAL_AYAHS}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button"
                  data-dl-action="toggle-pause"
                  data-reciter="${s.reciterId}"
                  class="dl-pause-resume-btn ${pauseClass} font-bold py-1.5 rounded-lg text-[11px] sm:text-xs flex items-center justify-center gap-1 cursor-pointer select-none">
            <i data-lucide="${pauseIcon}" class="w-3.5 h-3.5 pointer-events-none"></i>
            <span class="pointer-events-none">${pauseText}</span>
          </button>
          <button type="button"
                  data-dl-action="cancel"
                  data-reciter="${s.reciterId}"
                  class="dl-cancel-btn bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-bold py-1.5 rounded-lg text-[11px] sm:text-xs flex items-center justify-center gap-1 cursor-pointer select-none">
            <i data-lucide="x" class="w-3.5 h-3.5 pointer-events-none"></i>
            <span class="pointer-events-none">إلغاء</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  try { lucide.createIcons(); } catch (e) { console.error(e); }
}

/* ---------- معالج نقرات اللوحة (document-level capture) ---------- */
function handlePanelClick(e) {
  const panel = document.getElementById('active-downloads-panel');
  if (!panel) return;

  // 1) زر الطي/العرض
  const toggle = e.target.closest('#active-downloads-toggle');
  if (toggle && panel.contains(toggle)) {
    e.preventDefault();
    e.stopPropagation();
    const listEl = document.getElementById('active-downloads-list');
    const icon = document.getElementById('active-downloads-toggle-icon');
    if (!listEl) return;
    listEl.classList.toggle('hidden');
    if (icon) {
      icon.style.transform = listEl.classList.contains('hidden') ? 'rotate(180deg)' : '';
    }
    return;
  }

  // 2) زر الإيقاف / الاستئناف
  const pauseBtn = e.target.closest('.dl-pause-resume-btn');
  if (pauseBtn && panel.contains(pauseBtn)) {
    e.preventDefault();
    e.stopPropagation();
    const rid = pauseBtn.getAttribute('data-reciter');
    if (!rid) return;
    try {
      const st = BulkDownloader.getState(rid);
      if (!st) {
        console.warn('No state found for reciter:', rid);
        return;
      }
      if (st.status === 'running') {
        BulkDownloader.pauseDownload(rid);
      } else if (st.status === 'paused') {
        BulkDownloader.resumeDownload(rid);
      }
    } catch (err) {
      console.error('Pause/Resume error:', err);
    }
    return;
  }

  // 3) زر الإلغاء
  const cancelBtn = e.target.closest('.dl-cancel-btn');
  if (cancelBtn && panel.contains(cancelBtn)) {
    e.preventDefault();
    e.stopPropagation();
    const rid = cancelBtn.getAttribute('data-reciter');
    if (!rid) return;
    try {
      const rName = BulkDownloader.RECITERS[rid] || rid;
      if (!confirm(`هل تريد إلغاء التنزيل للقارئ "${rName}"؟\nسيُحفظ ما تم تنزيله حتى الآن.`)) return;
      BulkDownloader.cancelDownload(rid);
    } catch (err) {
      console.error('Cancel error:', err);
    }
    return;
  }
}

/* ---------- معالج انتهاء التنزيل ---------- */
function handleBulkDone(summary) {
  renderActiveDownloads();

  if (summary.cancelled) return;

  const rName = BulkDownloader.RECITERS[summary.reciterId] || summary.reciterId;
  const ok = !summary.error;
  const msg = ok
    ? `تم تنزيل القرآن كاملاً بصوت "${rName}" (${summary.totalDone} آية)`
    : `توقف تنزيل "${rName}" بسبب خطأ في الاتصال`;

  const toast = document.createElement('div');
  toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-slate-950 font-bold px-6 py-3 rounded-xl shadow-2xl flex items-center gap-2 max-w-[90vw] text-sm';
  toast.innerHTML = `<i data-lucide="${ok ? 'check-circle' : 'alert-circle'}" class="w-5 h-5 shrink-0"></i> <span>${msg}</span>`;
  document.body.appendChild(toast);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => toast.remove(), 6000);

  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('القرآن الكريم', { body: msg }); } catch (e) {}
  }
}

/* ---------- تهيئة اللوحة ---------- */
function initDownloadBanner() {
  if (typeof BulkDownloader === 'undefined') return;

  const panel = document.getElementById('active-downloads-panel');
  if (!panel) {
    console.warn('active-downloads-panel not found');
    return;
  }

  // مستمع واحد على document بمرحلة capture — يلتقط كل النقرات قبل أي عنصر آخر
  document.addEventListener('click', handlePanelClick, true);

  // استقبال أحداث التنزيل
  BulkDownloader.on('change', () => renderActiveDownloads());
  BulkDownloader.on('done', (summary) => handleBulkDone(summary));

  // عرض أولي
  renderActiveDownloads();
}

/* ---------- نقطة البداية ---------- */
window.onload = async () => {
  applyTheme();
  await init();
  initDownloadBanner();
  try {
    if (typeof BulkDownloader !== 'undefined') {
      await BulkDownloader.resumeIfNeeded();
    }
  } catch (e) {
    console.error(e);
  }
};