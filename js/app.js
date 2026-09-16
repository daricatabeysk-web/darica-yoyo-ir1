/* ============================================================
   Darıca Gücü — Yo-Yo IR1 Performance Lab
   Bilimsel protokol: Bangsbo, Iaia & Krustrup (2008) Sports Med
   - 2×20 m gidiş-dönüş koşuları (40 m/etap)
   - Her etap sonrası 10 sn aktif dinlenme
   - Hızlar: 10 → 19 km/h, 91 etap, toplam 3640 m
   - VO2max = mesafe × 0.0084 + 36.4
   ============================================================ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPA_URL = "https://riqjwcyayewkyhmpgbmd.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpcWp3Y3lheWV3a3lobXBnYm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzEwODUsImV4cCI6MjA5MjEwNzA4NX0.nnJLvstovo60UnoHGmuhkG1vDbkMf9DC9NdojU0F-3M";
const sb = createClient(SUPA_URL, SUPA_KEY);

const $ = (id) => document.getElementById(id);

/* ---------------- Toast ---------------- */
let toastT;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ============================================================
   BİLİMSEL PROTOKOL — Bangsbo ve ark. (2008) resmi tablosu
   ============================================================ */
const SCHEDULE = (() => {
  // [hız, etap sayısı] — resmi YYIR1 hız çizelgesi
  const spec = [[10,1],[12,1],[13,2],[13.5,3],[14,4],[14.5,8],[15,8],[15.5,8],[16,8],[16.5,8],[17,8],[17.5,8],[18,8],[18.5,8],[19,8]];
  // İlk 11 etabın resmi seviye:mekik numaraları (5:1, 9:1, 11:1, 11:2, 12:1-3, 13:1-4)
  const early = [];
  for (const [lv, c] of [[5,1],[9,1],[11,2],[12,3],[13,4]])
    for (let i = 1; i <= c; i++) early.push({ level: lv, inLevel: i });
  const runs = [];
  let n = 0;
  for (const [speed, count] of spec) {
    for (let i = 0; i < count; i++) {
      n++;
      const level = n <= 11 ? early[n-1].level : 14 + Math.floor((n-12)/8);
      const inLevel = n <= 11 ? early[n-1].inLevel : ((n-12) % 8) + 1;
      runs.push({
        n, speed, level, inLevel,
        dist: n * 40,
        legSec: 72 / speed,       // 20 m bacak süresi
        runSec: 144 / speed,      // 40 m etap süresi
      });
    }
  }
  return runs;
})();
const RECOVERY_SEC = 10;
const TOTAL_RUNS = SCHEDULE.length; // 91
const vo2max = (dist) => +(dist * 0.0084 + 36.4).toFixed(1);

// Yetişkin erkek normları (Topend Sports / Bangsbo 2008)
const NORMS = [
  { label: "ELİTE", cls: "rt-elite", min: 2400 },
  { label: "MÜKEMMEL", cls: "rt-exc", min: 2000 },
  { label: "İYİ", cls: "rt-good", min: 1520 },
  { label: "ORTALAMA", cls: "rt-avg", min: 1040 },
  { label: "ORTALAMA ALTI", cls: "rt-poor", min: 520 },
  { label: "ZAYIF", cls: "rt-poor", min: 0 },
];
const rating = (dist) => NORMS.find(x => dist >= x.min) || NORMS[NORMS.length - 1];

/* ============================================================
   SES MOTORU — AudioContext tabanlı, kesintisiz
   ============================================================ */
const AudioSys = {
  ctx: null, vol: +(localStorage.getItem("yoyoVol") ?? 0.8), vib: (localStorage.getItem("yoyoVib") ?? "1") === "1",
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, vol, when = 0) {
    try {
      const ctx = this.ensure();
      const t = ctx.currentTime + when;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(vol * this.vol, 0.001), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (e) {}
  },
  vibrate(p) { if (this.vib && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} },
  // Ses tipleri
  leg()     { this.tone(950, 0.14, 0.55); this.vibrate(40); },                    // dönüş düdüğü
  runStart(){ this.tone(950, 0.14, 0.55); this.vibrate(60); },                    // etap başlangıcı
  count()   { this.tone(620, 0.12, 0.45); },                                      // geri sayım
  go()      { this.tone(1250, 0.25, 0.7); this.vibrate([80,60,80]); },            // BAŞLA
  last3()   { this.tone(800, 0.12, 0.5); this.vibrate(30); },                     // son 3 sn
  levelUp() { this.tone(1500, 0.12, 0.5); },                                      // seviye artışı
  elim()    { this.tone(320, 0.35, 0.6); this.vibrate([120,80,120]); },           // eleme
  finish()  { [0,0.35,0.7].forEach((d,i)=>this.tone(1400+i*120, 0.3, 0.65, d)); this.vibrate([150,100,150,100,300]); },
};

/* ============================================================
   DURUM
   ============================================================ */
let athletes = [];
let currentSession = null;
let live = null;
let wakeLock = null;
const POS_TR = { GK: "Kaleci", DF: "Defans", MF: "Orta Saha", FW: "Forvet" };

const fmt = (s) => String(Math.floor(s/60)).padStart(2,"0") + ":" + String(Math.floor(s%60)).padStart(2,"0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c] ?? c);

/* ============================================================
   SEKMELER
   ============================================================ */
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  $("view-" + t.dataset.view).classList.add("active");
  if (t.dataset.view === "reports") loadSessions();
}));

/* ============================================================
   SUPABASE
   ============================================================ */
async function loadAthletes() {
  const { data, error } = await sb.from("yy_athletes").select("*").order("name");
  if (error) { toast("Veritabanına ulaşılamadı — Supabase uyuyor olabilir"); return; }
  athletes = data || [];
  renderAthleteList();
  renderAthletePicker();
}

/* ============================================================
   SPORCULAR SEKMESİ
   ============================================================ */
$("btnAddAthlete").addEventListener("click", async () => {
  const name = $("aName").value.trim();
  if (!name) return toast("Sporcu adı gerekli");
  const rec = {
    name,
    position: $("aPosition").value,
    jersey_number: $("aJersey").value ? +$("aJersey").value : null,
    birth_year: $("aBirth").value ? +$("aBirth").value : null,
    group_name: $("aGroup").value.trim() || null,
  };
  const { error } = await sb.from("yy_athletes").insert(rec);
  if (error) return toast("Kayıt başarısız: " + error.message);
  toast(name + " kadroya eklendi ✅");
  ["aName","aJersey","aBirth"].forEach(i => $(i).value = "");
  loadAthletes();
});

function athleteRow(a) {
  return `<div class="a-row">
    <div class="info">
      <b>${esc(a.name)} ${a.jersey_number ? "#" + a.jersey_number : ""}</b>
      <span>${POS_TR[a.position] || a.position || "—"} • ${a.group_name || "grup yok"} ${a.birth_year ? "• " + a.birth_year : ""}</span>
    </div>
    <button class="del" data-id="${a.id}">Sil</button>
  </div>`;
}

function renderAthleteList() {
  const q = ($("rosterSearch").value || "").toLocaleLowerCase("tr");
  const list = athletes.filter(a => a.name.toLocaleLowerCase("tr").includes(q));
  $("athleteCount").textContent = athletes.length;
  $("athleteList").innerHTML = list.map(athleteRow).join("") || '<p class="dim center">Sonuç yok.</p>';
  $("athleteList").querySelectorAll(".del").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Bu sporcuyu silmek istiyor musun?")) return;
    await sb.from("yy_athletes").delete().eq("id", b.dataset.id);
    loadAthletes();
  }));
}
$("rosterSearch").addEventListener("input", renderAthleteList);

/* ---- Canlı test seçici (gruplu + arama + tümünü seç) ---- */
function renderAthletePicker() {
  const q = ($("pickSearch").value || "").toLocaleLowerCase("tr");
  const groups = {};
  athletes.filter(a => a.name.toLocaleLowerCase("tr").includes(q)).forEach(a => {
    const g = a.group_name || "Grupsuz";
    (groups[g] = groups[g] || []).push(a);
  });
  const keys = Object.keys(groups).sort();
  $("pickAthletes").innerHTML = keys.map(g => `
    <div class="pick-group"><span>${esc(g)} (${groups[g].length})</span><button data-grp="${esc(g)}">TÜMÜNÜ SEÇ</button></div>
    ${groups[g].map(a => `
      <div class="pick" data-id="${a.id}">
        ${esc(a.name)} ${a.jersey_number ? "#" + a.jersey_number : ""}
      </div>`).join("")}
  `).join("") || '<p class="dim center">Sporcu bulunamadı.</p>';

  $("pickAthletes").querySelectorAll(".pick").forEach(el => el.addEventListener("click", () => {
    el.classList.toggle("on");
    updatePickCount();
  }));
  $("pickAthletes").querySelectorAll("[data-grp]").forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const g = btn.dataset.grp;
    const cards = [...$("pickAthletes").querySelectorAll(".pick-group")];
    const idx = cards.findIndex(c => c.querySelector("button").dataset.grp === g);
    if (idx === -1) return;
    // grup başlığından sonraki kartlar (bir sonraki gruba kadar)
    let probe = cards[idx].nextElementSibling;
    let allOn = true;
    while (probe && probe.classList.contains("pick")) {
      if (!probe.classList.contains("on")) allOn = false;
      probe = probe.nextElementSibling;
    }
    let sib = cards[idx].nextElementSibling;
    while (sib && sib.classList.contains("pick")) {
      sib.classList.toggle("on", !allOn);
      sib = sib.nextElementSibling;
    }
    updatePickCount();
  }));
}
function updatePickCount() {
  const n = $("pickAthletes").querySelectorAll(".pick.on").length;
  $("pickCount").textContent = n + " seçili";
}
$("pickSearch").addEventListener("input", renderAthletePicker);

/* ---- Ses ayarları ---- */
$("volSlider").value = Math.round(AudioSys.vol * 100);
$("volSlider").addEventListener("input", e => { AudioSys.vol = e.target.value / 100; localStorage.setItem("yoyoVol", AudioSys.vol); });
$("chkVibrate").checked = AudioSys.vib;
$("chkVibrate").addEventListener("change", e => { AudioSys.vib = e.target.checked; localStorage.setItem("yoyoVib", e.target.checked ? "1" : "0"); });

/* ============================================================
   CANLI TEST
   ============================================================ */
$("btnStartSetup").addEventListener("click", async () => {
  const picked = [...$("pickAthletes").querySelectorAll(".pick.on")].map(el => athletes.find(a => a.id === el.dataset.id)).filter(Boolean);
  if (!picked.length) return toast("En az bir sporcu seç");
  AudioSys.ensure(); // ses kilidini aç
  const rec = {
    title: $("sTitle").value.trim() || "Yo-Yo IR1 Testi",
    test_date: $("sDate").value || new Date().toISOString().slice(0,10),
    group_name: picked[0].group_name,
    location: $("sLocation").value.trim() || null,
    status: "live",
  };
  $("btnStartSetup").disabled = true;
  const { data, error } = await sb.from("yy_test_sessions").insert(rec).select().single();
  $("btnStartSetup").disabled = false;
  if (error || !data) return toast("Oturum oluşturulamadı: " + (error?.message || "bilinmeyen"));
  currentSession = data;
  startLive(picked);
});

function startLive(picked) {
  $("setupCard").classList.add("hidden");
  $("liveCard").classList.remove("hidden");
  $("liveTitle").textContent = currentSession.title;
  $("liveMeta").textContent = `${currentSession.group_name || ""} ${currentSession.location ? "• " + currentSession.location : ""} • ${picked.length} sporcu • ${new Date(currentSession.test_date).toLocaleDateString("tr-TR")}`;
  live = {
    players: picked.map(a => ({
      id: a.id, name: a.name, jersey: a.jersey_number, position: a.position,
      completed: 0, violations: 0, eliminated: false, tapped: false, hr: null,
    })),
    runIdx: 0, phase: "countdown", phaseStart: performance.now(), phaseLen: 5000,
    elapsed: 0, t0: performance.now(), paused: false, timeouts: [], finished: false,
  };
  if (navigator.wakeLock) navigator.wakeLock.request("screen").then(w => wakeLock = w).catch(() => {});
  renderBoard();
  // 5-4-3-2-1 geri sayım
  $("livePhase").textContent = "HAZIRLAN";
  $("livePhase").className = "phase running";
  for (let i = 5; i >= 1; i--) {
    live.timeouts.push(setTimeout(() => { $("livePhase").textContent = i; AudioSys.count(); }, (5 - i) * 1000));
  }
  live.timeouts.push(setTimeout(() => {
    AudioSys.go();
    startRun(0);
  }, 5000));
  live.raf = requestAnimationFrame(tick);
  live.clock = setInterval(() => {
    if (!live.paused) $("liveTimer").textContent = fmt((performance.now() - live.t0) / 1000);
  }, 500);
}

function curRun() { return SCHEDULE[live.runIdx]; }

function startRun(i, offsetSec = 0) {
  live.runIdx = i;
  live.phase = "run";
  live.phaseStart = performance.now() - offsetSec * 1000;
  live.phaseLen = curRun().runSec;
  const r = curRun();
  $("curLevel").textContent = r.level;
  $("curScore").textContent = r.level + "." + r.inLevel;
  $("curSpeed").textContent = r.speed.toFixed(1);
  $("curDist").textContent = r.dist;
  $("trackInfo").textContent = `${r.n}. etap • ${r.speed.toFixed(1)} km/h • ${r.dist} m hedef`;
  $("livePhase").textContent = "KOŞ";
  $("livePhase").className = "phase running";
  $("recovery").classList.add("hidden");
  if (offsetSec === 0) { AudioSys.runStart(); if (r.inLevel === 1) AudioSys.levelUp(); }
  // ikinci bacak (dönüş) düdüğü + etap sonu
  const remain = (r.runSec - offsetSec) * 1000;
  if (offsetSec < r.legSec) {
    live.timeouts.push(setTimeout(() => AudioSys.leg(), Math.max(0, (r.legSec - offsetSec) * 1000)));
  }
  live.timeouts.push(setTimeout(() => endRun(), remain));
  live.players.forEach(p => { if (!p.eliminated) p.tapped = false; });
}

function endRun() {
  const r = curRun();
  let anyOut = false;
  live.players.forEach(p => {
    if (p.eliminated) return;
    if (!p.tapped) {
      p.violations++;
      if (p.violations >= 2) { p.eliminated = true; anyOut = true; }
    }
  });
  if (anyOut) AudioSys.elim();
  renderBoard();
  // doğal bitiş: 91. etap tamamlandı
  if (r.n >= TOTAL_RUNS || live.players.every(p => p.eliminated)) { finishLive(true); return; }
  // 10 sn aktif dinlenme
  live.phase = "rest";
  live.phaseStart = performance.now();
  live.phaseLen = RECOVERY_SEC;
  const next = SCHEDULE[live.runIdx + 1];
  $("livePhase").textContent = "DİNLENME";
  $("livePhase").className = "phase rest";
  $("recovery").classList.remove("hidden");
  $("recNext").textContent = `SONRAKİ: ${next.level}.${next.inLevel} • ${next.speed.toFixed(1)} km/h`;
  for (let s = 3; s >= 1; s--) {
    live.timeouts.push(setTimeout(() => AudioSys.last3(), (RECOVERY_SEC - s) * 1000));
  }
  live.timeouts.push(setTimeout(() => startRun(live.runIdx + 1), RECOVERY_SEC * 1000));
}

/* ---- rAF: pist animasyonu ---- */
function tick() {
  if (!live || live.finished) return;
  const now = performance.now();
  const el = (now - live.phaseStart) / 1000;
  if (live.phase === "run" && !live.paused) {
    const r = curRun();
    const frac = Math.min(1, el / r.runSec);
    const legFrac = (el % r.legSec) / r.legSec;
    const leg = Math.floor(el / r.legSec) % 2; // 0: A→B, 1: B→A
    const pos = 4 + (leg === 0 ? legFrac : (1 - legFrac)) * 92;
    $("ghost").style.left = pos + "%";
    $("runnerShadow").style.left = pos + "%";
    $("runBar").style.width = (frac * 100) + "%";
    // geciken sporcuları vurgula
    const lagging = frac > 0.65;
    document.querySelectorAll("#athleteBoard .athlete-card").forEach((c, i) => {
      const p = live.players[i];
      if (!p) return;
      c.classList.toggle("keep", p.tapped && !p.eliminated);
    });
  } else if (live.phase === "rest" && !live.paused) {
    const rem = Math.max(0, RECOVERY_SEC - el);
    $("recNum").textContent = Math.ceil(rem);
    $("ringFg").style.strokeDashoffset = 213.6 * (1 - rem / RECOVERY_SEC);
    $("runBar").style.width = "0%";
  }
  live.raf = requestAnimationFrame(tick);
}

/* ---- Duraklat / Devam ---- */
$("btnPause").addEventListener("click", () => {
  if (!live || live.finished) return;
  live.paused = !live.paused;
  if (live.paused) {
    live.timeouts.forEach(clearTimeout); live.timeouts = [];
    live.pausedElapsed = (performance.now() - live.phaseStart) / 1000;
    $("btnPause").textContent = "▶";
    $("livePhase").textContent = "DURAKLADI";
    $("livePhase").className = "phase paused";
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
  } else {
    const off = live.pausedElapsed || 0;
    if (live.phase === "countdown") {
      live.phaseStart = performance.now() - off * 1000;
      const rest = Math.max(0, 5 - off);
      for (let i = 0; i < Math.ceil(rest); i++) live.timeouts.push(setTimeout(() => AudioSys.count(), i * 1000));
      live.timeouts.push(setTimeout(() => { AudioSys.go(); startRun(0); }, rest * 1000));
    } else if (live.phase === "run") {
      startRun(live.runIdx, off);
    } else if (live.phase === "rest") {
      live.phaseStart = performance.now() - off * 1000;
      const rest = Math.max(0, RECOVERY_SEC - off);
      const next = SCHEDULE[live.runIdx + 1];
      $("recNext").textContent = `SONRAKİ: ${next ? next.level + "." + next.inLevel + " • " + next.speed.toFixed(1) + " km/h" : "—"}`
      for (let s = 3; s >= 1; s--) if (rest > s) live.timeouts.push(setTimeout(() => AudioSys.last3(), (rest - s) * 1000));
      live.timeouts.push(setTimeout(() => startRun(live.runIdx + 1), rest * 1000));
    }
    $("btnPause").textContent = "⏸";
    live.t0 = performance.now() - live.elapsed * 1000;
  }
});

/* ---- Bitir ---- */
$("btnStop").addEventListener("click", () => {
  if (!live || live.finished) return;
  if (confirm("Testi bitirip sonuçları kaydet?")) finishLive(false);
});

async function finishLive(natural) {
  if (!live || live.finished) return;
  live.finished = true;
  live.timeouts.forEach(clearTimeout);
  cancelAnimationFrame(live.raf);
  clearInterval(live.clock);
  AudioSys.finish();
  if (wakeLock) { wakeLock.release(); wakeLock = null; }

  if (natural) {
    // testi tamamlayıp hâlâ koşan sporcular tüm protokolü bitirmiş sayılır
    live.players.forEach(p => { if (!p.eliminated) p.completed = TOTAL_RUNS; });
  }
  const rows = live.players.map(p => {
    const r = p.completed > 0 ? SCHEDULE[p.completed - 1] : null;
    const dist = p.completed * 40;
    return {
      session_id: currentSession.id,
      athlete_id: p.id,
      level: r ? r.level : null,
      shuttle: r ? r.inLevel : null,
      distance_m: dist,
      vo2max: dist ? vo2max(dist) : null,
      hr_max: p.hr,
      violations: p.violations,
      eliminated: p.eliminated,
      elapsed_seconds: Math.floor(live.elapsed || (performance.now() - live.t0) / 1000),
    };
  });
  const { error } = await sb.from("yy_test_results").insert(rows);
  if (error) toast("Sonuç kaydedilemedi: " + error.message);
  await sb.from("yy_test_sessions").update({ status: "completed" }).eq("id", currentSession.id);

  toast(natural ? "🏆 Test tamamlandı! " + rows.length + " sporcu kaydedildi." : "Test bitti — sonuçlar kaydedildi ✅");
  $("liveCard").classList.add("hidden");
  $("setupCard").classList.remove("hidden");
  live = null;
}

/* ---- Oyuncu kartları ---- */
function renderBoard() {
  $("athleteBoard").innerHTML = live.players.map((p, i) => {
    const r = p.completed > 0 ? SCHEDULE[p.completed - 1] : null;
    const dist = p.completed * 40;
    const state = p.eliminated ? ["ELENEN","state-out"] : p.violations > 0 ? ["UYARI","state-warn"] : ["AKTİF","state-ok"];
    return `
    <div class="athlete-card ${p.eliminated ? "gone" : p.violations ? "warn" : ""}">
      <span class="ac-state ${state[1]}">${state[0]}</span>
      <div class="ac-head">
        <span class="ac-name">${esc(p.name)}</span>
        <span class="ac-pos">${p.position || ""}${p.jersey ? " #" + p.jersey : ""}</span>
      </div>
      <div class="ac-stats">
        <span>SEVİYE<b class="gold">${r ? r.level : "–"}</b></span>
        <span>MESAFE<b>${dist}<i style="font-style:normal;font-size:.6em"> m</i></b></span>
        <span>VO₂<b>${dist ? vo2max(dist) : "–"}</b></span>
        <span>İHLAL<b style="color:${p.violations ? "var(--amber)" : "var(--tx)"}">${p.violations}</b></span>
      </div>
      ${p.eliminated ? `
        <div class="hr-input">
          <input type="number" id="hr-${i}" placeholder="💗 Nabız" min="80" max="240">
          <button class="btn primary" data-hr="${i}">✓</button>
        </div>` : `
        <div class="ac-actions">
          <button class="btn ok" data-ok="${i}">✓ Koşu</button>
          <button class="btn viol" data-vi="${i}">⚠ İhlal</button>
          <button class="btn out" data-out="${i}">✕ Elden Çıkar</button>
        </div>`}
    </div>`;
  }).join("");

  $("athleteBoard").querySelectorAll("[data-ok]").forEach(b => b.addEventListener("click", () => {
    const p = live.players[+b.dataset.ok];
    if (p.eliminated) return;
    p.completed = Math.max(p.completed, curRun().n);
    p.tapped = true;
    AudioSys.tone(700, 0.06, 0.2);
    renderBoard();
  }));
  $("athleteBoard").querySelectorAll("[data-vi]").forEach(b => b.addEventListener("click", () => {
    const p = live.players[+b.dataset.vi];
    if (p.eliminated) return;
    p.violations++;
    if (p.violations >= 2) { p.eliminated = true; AudioSys.elim(); }
    renderBoard();
  }));
  $("athleteBoard").querySelectorAll("[data-out]").forEach(b => b.addEventListener("click", () => {
    const p = live.players[+b.dataset.out];
    p.eliminated = true;
    renderBoard();
    if (live.players.every(x => x.eliminated)) finishLive(false);
  }));
  $("athleteBoard").querySelectorAll("[data-hr]").forEach(b => b.addEventListener("click", () => {
    const p = live.players[+b.dataset.hr];
    p.hr = +($("hr-" + b.dataset.hr).value) || null;
    toast(p.name + " • nabız kaydedildi 💗");
  }));
}

/* ============================================================
   RAPORLAR
   ============================================================ */
async function loadSessions() {
  const { data, error } = await sb.from("yy_test_sessions").select("*").order("test_date", { ascending: false });
  if (error) return;
  $("sessionList").innerHTML = (data || []).map(s => `
    <div class="s-row" data-id="${s.id}">
      <div>
        <b>${esc(s.title)}</b>
        <span class="dim">${s.test_date} ${s.group_name ? "• " + esc(s.group_name) : ""} ${s.location ? "• " + esc(s.location) : ""} ${s.status === "completed" ? "• ✅" : ""}</span>
      </div>
      <span class="dim">Rapor →</span>
    </div>`).join("") || '<p class="dim center">Henüz test oturumu yok.</p>';
  $("sessionList").querySelectorAll(".s-row").forEach(r => r.addEventListener("click", () => openReport(r.dataset.id)));
}

async function openReport(sessionId) {
  const [{ data: s }, { data: results }] = await Promise.all([
    sb.from("yy_test_sessions").select("*").eq("id", sessionId).single(),
    sb.from("yy_test_results").select("*, yy_athletes(name, position, jersey_number, birth_year)").eq("session_id", sessionId),
  ]);
  if (!s) return;
  const sorted = (results || []).slice().sort((a, b) => (b.distance_m || 0) - (a.distance_m || 0));
  const withV = sorted.filter(r => r.vo2max);
  const avgV = withV.length ? withV.reduce((t, r) => t + +r.vo2max, 0) / withV.length : 0;
  const avgD = sorted.length ? sorted.reduce((t, r) => t + (r.distance_m || 0), 0) / sorted.length : 0;
  const best = sorted[0];
  const posDist = {};
  sorted.forEach(r => { const p = r.yy_athletes?.position || "?"; posDist[p] = (posDist[p] || 0) + 1; });

  $("reportBody").innerHTML = `
    <div class="rp-title">
      <h2>${esc(s.title)}</h2>
      <p class="dim">Darıca Gücü Spor Kulübü • ${s.test_date} ${s.group_name ? "• " + esc(s.group_name) : ""} ${s.location ? "• " + esc(s.location) : ""}</p>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${sorted.length}</b><span>KATILIMCI</span></div>
      <div class="stat"><b>${Math.round(avgD)} m</b><span>ORT. MESAFE</span></div>
      <div class="stat"><b>${best ? best.distance_m + " m" : "–"}</b><span>EN İYİ</span></div>
      <div class="stat"><b>${avgV ? avgV.toFixed(1) : "–"}</b><span>ORT. VO₂max</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Sporcu</th><th>Mevki</th><th>Skor</th><th>Mesafe</th><th>VO₂max</th><th>Değerlendirme</th><th>Durum</th></tr></thead>
      <tbody>
        ${sorted.map((r, i) => {
          const rt = rating(r.distance_m || 0);
          const age = r.yy_athletes?.birth_year ? new Date(s.test_date).getFullYear() - r.yy_athletes.birth_year : null;
          return `
          <tr class="${r.eliminated ? "elim" : ""}">
            <td><span class="rank ${i === 0 ? "g" : i === 1 ? "s" : i === 2 ? "b" : ""}">${i + 1}</span></td>
            <td><b>${esc(r.yy_athletes?.name || "?")}</b>${r.yy_athletes?.jersey_number ? " #" + r.yy_athletes.jersey_number : ""}<br><span class="dim" style="font-size:.68rem">${age ? age + " yaş" : ""}</span></td>
            <td>${POS_TR[r.yy_athletes?.position] || "–"}</td>
            <td><b>${r.level ? r.level + "." + r.shuttle : "–"}</b></td>
            <td><b>${r.distance_m || 0} m</b></td>
            <td>${r.vo2max || "–"}</td>
            <td><span class="rating ${rt.cls}">${rt.label}</span></td>
            <td>${r.eliminated ? "Elenen" : "Tamamladı"}${r.hr_max ? "<br><span class='dim' style='font-size:.68rem'>💗 " + r.hr_max + " bpm</span>" : ""}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <h3>Pozisyon Dağılımı</h3>
    <div class="pos-dist">
      ${Object.entries(posDist).map(([p, c]) => `<div class="pos-chip">${POS_TR[p] || p}: <b>${c}</b></div>`).join("")}
    </div>
    <h3>Antrenör Notları</h3>
    <textarea id="coachNotes" placeholder="Gözlemler, gelişim alanları, hedefler...">${esc(s.notes || "")}</textarea>
    <button id="btnSaveNotes" class="btn primary" style="margin-top:10px">Notları Kaydet</button>
    <p class="report-foot">
      Yo-Yo Intermittent Recovery Test Level 1 • Protokol: Bangsbo, Iaia &amp; Krustrup (2008) Sports Med 38(1):37-51<br>
      VO₂max = mesafe × 0.0084 + 36.4 • Değerlendirme aralıkları yetişkin erkek normlarıdır; gelişim takibi için karşılaştırma temel alınmalıdır
    </p>`;
  $("sessionListCard").classList.add("hidden");
  $("reportDetail").classList.remove("hidden");
  $("btnSaveNotes").addEventListener("click", async () => {
    const { error } = await sb.from("yy_test_sessions").update({ notes: $("coachNotes").value }).eq("id", sessionId);
    toast(error ? "Not kaydedilemedi" : "Notlar kaydedildi ✅");
  });
}

$("btnBackReport").addEventListener("click", () => {
  $("reportDetail").classList.add("hidden");
  $("sessionListCard").classList.remove("hidden");
});
$("btnPrint").addEventListener("click", () => window.print());

/* ============================================================
   BAŞLANGIÇ
   ============================================================ */
$("sDate").value = new Date().toISOString().slice(0, 10);
loadAthletes();
setTimeout(() => $("splash").classList.add("hide"), 1100);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
