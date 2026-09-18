// State Management
const RECITERS = [
  { id: 'ar.alafasy', name: 'مشاري راشد العفاسي' },
  { id: 'ar.husary', name: 'محمود خليل الحصري' },
  { id: 'ar.minshawi', name: 'محمد صديق المنشاوي' },
  { id: 'ar.saoodshuraym', name: 'سعود الشريم' },
  { id: 'ar.mahermuaiqly', name: 'ماهر المعيقلي' },
  { id: 'ar.shaatree', name: 'أبو بكر الشاطري' }
];

let surahs = [];
let currentSurah = null;
let ayahsData = [];
let activeAyahIndex = 0;
let isPlaying = false;

const audio = new Audio();

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
    const res = await fetch('https://api.alquran.cloud/v1/surah');
    const data = await res.json();
    surahs = data.data;
    renderSurahsList(surahs);
  } catch (err) {
    console.error('Failed to load surahs:', err);
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
  currentSurahInfo.innerText = `${currentSurah.englishName} • ${currentSurah.revelationType === 'Meccan' ? 'مكية' : 'مدنية'} • ${currentSurah.numberOfAyahs} آيات`;
  
  bismillahEl.classList.toggle('hidden', surahNum === 1 || surahNum === 9);

  ayahsContainerEl.innerHTML = '<div class="text-center py-12 text-slate-500">جاري تحميل الآيات...</div>';

  try {
    const reciter = reciterSelectEl.value;
    const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}/editions/quran-uthmani,${reciter}`);
    const data = await res.json();

    const arabic = data.data[0].ayahs;
    const audioItems = data.data[1].ayahs;

    ayahsData = arabic.map((a, i) => {
      let text = a.text;

      if (surahNum !== 1 && surahNum !== 9 && a.numberInSurah === 1) {
        const bismillahPrefix = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ";
        if (text.startsWith(bismillahPrefix)) {
          text = text.replace(bismillahPrefix, "");
        }
      }

      return {
        number: a.numberInSurah,
        globalNumber: a.number,
        text: text,
        audio: audioItems[i]?.audio || ''
      };
    });

    activeAyahIndex = 0;
    renderAyahs();

    if (autoPlayAfterLoad) {
      playAyah(0);
    }
  } catch (err) {
    ayahsContainerEl.innerHTML = '<div class="text-center py-12 text-red-400">حدث خطأ أثناء تحميل البيانات</div>';
  }
}

function renderAyahs() {
  ayahsContainerEl.innerHTML = ayahsData.map((a, idx) => {
    const isActive = activeAyahIndex === idx;

    return `
      <div id="ayah-${idx}" class="p-4 sm:p-6 rounded-xl border transition-all duration-300 ${isActive ? 'bg-emerald-950/30 border-emerald-500/50 shadow-lg' : 'bg-slate-800/30 border-slate-800'}">
        <div class="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
          <span class="bg-slate-800 text-emerald-400 text-xs font-bold px-3 py-1 rounded-full border border-slate-700">
            ${currentSurah.number}:${a.number}
          </span>
          <div class="flex items-center gap-1">
            <button onclick="playAyah(${idx})" class="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-emerald-400" aria-label="تشغيل">
              <i data-lucide="${isActive && isPlaying ? 'pause' : 'play'}" class="w-4 h-4"></i>
            </button>
            <button onclick="openTafsir(${a.globalNumber})" class="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-emerald-400" aria-label="التفسير">
              <i data-lucide="info" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <p class="font-quran text-2xl sm:text-3xl md:text-4xl leading-loose text-slate-100 text-right mb-4">${a.text}</p>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function playAyah(index) {
  activeAyahIndex = index;
  const currentAyah = ayahsData[index];

  if (!currentAyah || !currentAyah.audio) return;

  audio.src = currentAyah.audio;
  audio.play().then(() => {
    isPlaying = true;
    updateAudioUI();
    updateMediaSession();
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
  tafsirModal.classList.remove('hidden');
  document.getElementById('tafsir-content').innerText = 'جاري تحميل التفسير الميسر...';
  
  try {
    const res = await fetch(`https://api.alquran.cloud/v1/ayah/${globalAyahNumber}/ar.muyassar`);
    const data = await res.json();
    document.getElementById('tafsir-content').innerText = data.data.text;
  } catch (err) {
    document.getElementById('tafsir-content').innerText = 'عذراً، تعذر تحميل التفسير.';
  }
}

window.onload = init;