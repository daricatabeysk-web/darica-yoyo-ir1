/* ============================================================
   Darıca Gücü — Yo-Yo IR1 Performance Lab v3
   Bilimsel protokol: Bangsbo, Iaia & Krustrup (2008) Sports Med
   - 2×20 m gidiş-dönüş koşuları (40 m/etap)
   - Her etap sonrası 10 sn aktif dinlenme
   - Hızlar: 10 → 19 km/h, 91 etap, toplam 3640 m
   - VO2max = mesafe × 0.0084 + 36.4
   Yeni: antrenör girişi, duvar-saati motoru (arka planda kaymaz),
   otomatik ara kayıt + kaldığı yerden devam, toplu koşu,
   bitirenler için nabız, CSV export, gelişim kartı
   ============================================================ */
import { createClient } from "./vendor/supabase.esm.js";

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
  const spec = [[10,1],[12,1],[13,2],[13.5,3],[14,4],[14.5,8],[15,8],[15.5,8],[16,8],[16.5,8],[17,8],[17.5,8],[18,8],[18.5,8],[19,8]];
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
      runs.push({ n, speed, level, inLevel, dist: n * 40, legSec: 72 / speed, runSec: 144 / speed });
    }
  }
  return runs;
})();
const RECOVERY_SEC = 10;
const TOTAL_RUNS = SCHEDULE.length; // 91
const vo2max = (dist) => +(dist * 0.0084 + 36.4).toFixed(1);

// Yetişkin erkek normları — 18 yaş altına UYGULANMAZ (gelişim takibi kullanılır)
const NORMS = [
  { label: "ELİTE", cls: "rt-elite", min: 2400 },
  { label: "MÜKEMMEL", cls: "rt-exc", min: 2000 },
  { label: "İYİ", cls: "rt-good", min: 1520 },
  { label: "ORTALAMA", cls: "rt-avg", min: 1040 },
  { label: "ORTALAMA ALTI", cls: "rt-poor", min: 520 },
  { label: "ZAYIF", cls: "rt-poor", min: 0 },
];
function rating(dist, age) {
  if (age != null && age < 18) return { label: "Genç • Gelişim", cls: "rt-dev" };
  return NORMS.find(x => dist >= x.min) || NORMS[NORMS.length - 1];
}

/* ============================================================
   SES MOTORU — AudioContext, kesintisiz + planlanmış düdükler
   ============================================================ */
const AudioSys = {
  ctx: null, vol: +(localStorage.getItem("yoyoVol") ?? 0.8), vib: (localStorage.getItem("yoyoVib") ?? "1") === "1",
  _live: [],
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
      this._live.push(o);
      o.onended = () => { this._live = this._live.filter(x => x !== o); };
    } catch (e) {}
  },
  stopAll() {
    this._live.forEach(o => { try { o.stop(); } catch (e) {} });
    this._live = [];
  },
  vibrate(p) { if (this.vib && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} },
  leg()     { this.tone(950, 0.14, 0.55); this.vibrate(40); },
  runStart(){ this.tone(950, 0.14, 0.55); this.vibrate(60); },
  count()   { this.tone(620, 0.12, 0.45); },
  go()      { this.tone(1250, 0.25, 0.7); this.vibrate([80,60,80]); },
  last3()   { this.tone(800, 0.12, 0.5); this.vibrate(30); },
  levelUp() { this.tone(1500, 0.12, 0.5); },
  elim()    { this.tone(320, 0.35, 0.6); this.vibrate([120,80,120]); },
  finish()  { [0,0.35,0.7].forEach((d,i)=>this.tone(1400+i*120, 0.3, 0.65, d)); this.vibrate([150,100,150,100,300]); },
  tapOk()   { this.tone(700, 0.06, 0.2); },
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
   GİRİŞ (AUTH) — sadece antrenör yazabilir
   ============================================================ */
async function init() {
  $("sDate").value = new Date().toISOString().slice(0, 10);
  $("splash").classList.add("hide");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  if (session) enterApp(); else showLogin();
}
function showLogin() { $("loginView").classList.remove("hidden"); $("app").classList.add("hidden"); }
async function enterApp() {
  $("loginView").classList.add("hidden");
  $("app").classList.remove("hidden");
  const u = (await sb.auth.getUser()).data?.user;
  $("coachName").textContent = u?.user_metadata?.name || u?.email || "";
  loadAthletes();
  checkResumable();
}
$("btnLogin").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim(), pass = $("loginPass").value;
  if (!email || !pass) return toast("E-posta ve şifre gerekli");
  $("btnLogin").disabled = true; $("btnLogin").textContent = "GİRİLİYOR...";
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  $("btnLogin").disabled = false; $("btnLogin").textContent = "GİRİŞ YAP";
  if (error) return toast("Giriş başarısız — e-posta/şifre kontrol et");
  enterApp();
});
$("loginPass").addEventListener("keydown", e => { if (e.key === "Enter") $("btnLogin").click(); });
$("btnLogout").addEventListener("click", async () => {
  if (live && !live.finished && !confirm("Test sürüyor! Çıkarsan kaldığı yerden devam edebilirsin. Çıkılsın mı?")) return;
  await sb.auth.signOut();
  location.reload();
});

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
    const { error } = await sb.from("yy_athletes").delete().eq("id", b.dataset.id);
    if (error) return toast("Silinemedi: " + error.message);
    loadAthletes();
  }));
}
$("rosterSearch").addEventListener("input", renderAthleteList);

/* ---- Canlı test seçici ---- */
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
   CANLI TEST — duvar saati tabanlı motor
   Faz geçişleri rAF + Date.now() ile, düdükler AudioContext'e
   önceden planlanır → sekme arka plana geçse bile zamanlama kaymaz
   ============================================================ */
$("btnStartSetup").addEventListener("click", async () => {
  const picked = [...$("pickAthletes").querySelectorAll(".pick.on")].map(el => athletes.find(a => a.id === el.dataset.id)).filter(Boolean);
  if (!picked.length) return toast("En az bir sporcu seç");
  AudioSys.ensure();
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
  $("resumeBar").classList.add("hidden");
  startLive(picked);
});

function startLive(picked, restored = null) {
  $("setupCard").classList.add("hidden");
  $("liveCard").classList.remove("hidden");
  $("liveTitle").textContent = currentSession.title;
  $("liveMeta").textContent = `${currentSession.group_name || ""} ${currentSession.location ? "• " + currentSession.location : ""} • ${picked.length} sporcu • ${new Date(currentSession.test_date).toLocaleDateString("tr-TR")}`;
  live = restored || {
    players: picked.map(a => ({
      id: a.id, name: a.name, jersey: a.jersey_number, position: a.position, group: a.group_name,
      completed: 0, violations: 0, eliminated: false, tapped: false, hr: null,
    })),
    runIdx: 0, elapsedSec: 0, pausedTotal: 0,
  };
  live.phase = "countdown";
  live.phaseStart = Date.now();
  live.phaseLen = 5000;
  live.pausedAt = null;
  live.pausedTotal = live.pausedTotal || 0;
  live.testStart = Date.now() - (live.elapsedSec || 0) * 1000;
  live.finished = false;
  if (navigator.wakeLock) navigator.wakeLock.request("screen").then(w => wakeLock = w).catch(() => {});
  // geri sayım düdükleri önceden planlanır
  for (let i = 0; i < 5; i++) AudioSys.tone(620, 0.12, 0.45, i);
  renderBoard();
  live.raf = requestAnimationFrame(tick);
  // motor zamanlayıcısı: rAF durursa bile (ekran kapalı/arka plan) fazlar ilerler
  live.clock = setInterval(() => {
    if (!live || live.finished) return;
    if (!live.paused) { stepEngine(); $("liveTimer").textContent = fmt(elapsedSec()); }
  }, 250);
  saveSnapshot(); // ilk ara kayıt
}

function elapsedSec() {
  return live ? Math.max(0, (Date.now() - live.testStart - live.pausedTotal) / 1000) : 0;
}
function curRun() { return SCHEDULE[live.runIdx]; }

function beginRun(i) {
  // sonraki koşuya geçiş: önceki koşu+dinlenme boyunca işaretlenmeyenler ihlal alır
  if (i > live.runIdx) {
    let anyOut = false;
    live.players.forEach(p => {
      if (p.eliminated) return;
      if (!p.tapped) {
        p.violations++;
        if (p.violations >= 2) { p.eliminated = true; anyOut = true; }
      }
    });
    if (anyOut) { AudioSys.elim(); renderBoard(); }
    if (live.players.every(p => p.eliminated)) { enterResultsMode(true); return; }
  }
  live.runIdx = i;
  live.phase = "run";
  live.phaseStart = Date.now();
  const r = curRun();
  live.phaseLen = r.runSec;
  $("curLevel").textContent = r.level;
  $("curScore").textContent = r.level + "." + r.inLevel;
  $("curSpeed").textContent = r.speed.toFixed(1);
  $("curDist").textContent = r.dist;
  $("trackInfo").textContent = `${r.n}. etap • ${r.speed.toFixed(1)} km/h • ${r.dist} m hedef`;
  $("livePhase").textContent = "KOŞ";
  $("livePhase").className = "phase running";
  $("recovery").classList.add("hidden");
  // düdükler şimdi planlanıyor: başlangıç + dönüş (20 m)
  AudioSys.runStart(); AudioSys.vibrate(60);
  if (r.inLevel === 1) AudioSys.tone(1500, 0.12, 0.5, 0.02);
  AudioSys.tone(950, 0.14, 0.55, r.legSec); AudioSys.vibrate(40);
  live.players.forEach(p => { if (!p.eliminated) p.tapped = false; });
  saveSnapshot();
}

function endRun() {
  const r = curRun();
  // ihlal değerlendirmesi beginRun'da (dinlenme sonunda) yapılır:
  // koç, düdükten sonraki 10 sn dinlenmede de "✓ Koşu" ile işaretleyebilir
  if (r.n >= TOTAL_RUNS || live.players.every(p => p.eliminated)) { enterResultsMode(true); return; }
  live.phase = "rest";
  live.phaseStart = Date.now();
  live.phaseLen = RECOVERY_SEC;
  const next = SCHEDULE[live.runIdx + 1];
  $("livePhase").textContent = "DİNLENME";
  $("livePhase").className = "phase rest";
  $("recovery").classList.remove("hidden");
  $("recNext").textContent = `SONRAKİ: ${next.level}.${next.inLevel} • ${next.speed.toFixed(1)} km/h`;
  // son 3 sn uyarıları planlanır
  for (let s = 3; s >= 1; s--) AudioSys.tone(800, 0.12, 0.5, RECOVERY_SEC - s);
  saveSnapshot();
}

/* ---- rAF döngüsü: faz geçişleri duvar saatinden ---- */
/* ---- FAZ MOTORU: sadece duvar saatine bakar, her yerden çağrılabilir ---- */
function stepEngine() {
  if (!live || live.finished || live.paused) return;
  const el = (Date.now() - live.phaseStart) / 1000;
  if (live.phase === "countdown") {
    $("livePhase").textContent = "HAZIRLAN " + Math.max(1, Math.ceil(5 - el));
    if (el >= 5) { AudioSys.go(); beginRun(live.runIdx); }
  } else if (live.phase === "run") {
    if (el >= curRun().runSec) endRun();
  } else if (live.phase === "rest") {
    const rem = Math.max(0, RECOVERY_SEC - el);
    $("recNum").textContent = Math.ceil(rem);
    $("ringFg").style.strokeDashoffset = 213.6 * (1 - rem / RECOVERY_SEC);
    if (el >= RECOVERY_SEC) beginRun(live.runIdx + 1);
  }
}

/* ---- rAF: sadece animasyon ---- */
function tick() {
  if (!live || live.finished) return;
  if (live.paused) { live.raf = requestAnimationFrame(tick); return; }
  const el = (Date.now() - live.phaseStart) / 1000;
  stepEngine();
  if (live.phase === "run" && !live.finished) {
    const r = curRun();
    const frac = Math.min(1, el / r.runSec);
    const legFrac = (el % r.legSec) / r.legSec;
    const leg = Math.floor(el / r.legSec) % 2;
    const pos = 4 + (leg === 0 ? legFrac : (1 - legFrac)) * 92;
    $("ghost").style.left = pos + "%";
    $("runnerShadow").style.left = pos + "%";
    $("runBar").style.width = (frac * 100) + "%";
    document.querySelectorAll("#athleteBoard .athlete-card").forEach((c, i) => {
      const p = live.players[i];
      if (p) c.classList.toggle("keep", p.tapped && !p.eliminated);
    });
  } else if (live.phase === "rest" && !live.finished) {
    const rem = Math.max(0, RECOVERY_SEC - el);
    $("recNum").textContent = Math.ceil(rem);
    $("ringFg").style.strokeDashoffset = 213.6 * (1 - rem / RECOVERY_SEC);
    $("runBar").style.width = "0%";
  }
  live.raf = requestAnimationFrame(tick);
}

/* ---- Sekme arka plana geçip dönünce ---- */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && live && !live.finished && !live.paused) {
    // duvar saati zaten doğru: tick bir sonraki karede fazı ileri taşır
    AudioSys.ensure();
  }
});

/* ---- Duraklat / Devam ---- */
$("btnPause").addEventListener("click", () => {
  if (!live || live.finished) return;
  if (!live.paused) {
    live.paused = true;
    live.pausedAt = Date.now();
    AudioSys.stopAll();
    $("btnPause").textContent = "▶";
    $("livePhase").textContent = "DURAKLADI";
    $("livePhase").className = "phase paused";
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
    saveSnapshot();
  } else {
    const pauseLen = Date.now() - live.pausedAt;
    live.pausedTotal += pauseLen;
    live.phaseStart += pauseLen;
    live.testStart += pauseLen;
    live.paused = false;
    $("btnPause").textContent = "⏸";
    AudioSys.ensure();
    // kalan düdükleri mevcut faz konumundan planla
    const el = (Date.now() - live.phaseStart) / 1000;
    if (live.phase === "run") {
      const r = curRun();
      if (r.legSec > el) AudioSys.tone(950, 0.14, 0.55, r.legSec - el);
    } else if (live.phase === "rest") {
      for (let s = 3; s >= 1; s--) if (RECOVERY_SEC - s > el) AudioSys.tone(800, 0.12, 0.5, RECOVERY_SEC - s - el);
    }
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then(w => wakeLock = w).catch(() => {});
  }
});

/* ---- Ara kayıt (crash koruması) ---- */
async function saveSnapshot() {
  if (!live || !currentSession || live.finished) return;
  const snap = {
    players: live.players.map(p => ({ id: p.id, name: p.name, jersey: p.jersey, position: p.position, group: p.group, completed: p.completed, violations: p.violations, eliminated: p.eliminated, tapped: p.tapped, hr: p.hr })),
    runIdx: live.runIdx, elapsedSec: Math.floor(elapsedSec()),
  };
  try { await sb.from("yy_live_state").upsert({ session_id: currentSession.id, state: snap }, { onConflict: "session_id" }); } catch (e) {}
}

/* ---- Kaldığı yerden devam ---- */
async function checkResumable() {
  const { data } = await sb.from("yy_test_sessions").select("*").eq("status", "live").order("created_at", { ascending: false }).limit(1);
  if (!data || !data.length) return;
  const s = data[0];
  const { data: snapRow } = await sb.from("yy_live_state").select("state").eq("session_id", s.id).maybeSingle();
  const snap = snapRow?.state;
  const hours = (Date.now() - new Date(s.created_at)) / 36e5;
  if (!snap || !snap.players || hours > 36) {
    await sb.from("yy_test_results").delete().eq("session_id", s.id);
    await sb.from("yy_live_state").delete().eq("session_id", s.id);
    await sb.from("yy_test_sessions").delete().eq("id", s.id);
    return;
  }
  $("resumeBar").classList.remove("hidden");
  $("resumeInfo").textContent = `${s.title} • ${(snap.players || []).length} sporcu • ${snap.runIdx}. etap • yarıda kalmış`;
  $("btnResume").onclick = () => {
    currentSession = s;
    $("resumeBar").classList.add("hidden");
    startLive(snap.players, {
      players: snap.players, runIdx: snap.runIdx, elapsedSec: snap.elapsedSec || 0, pausedTotal: 0,
    });
  };
  $("btnDiscard").onclick = async () => {
    if (!confirm("Yarıda kalan oturum ve tüm verisi silinsin mi?")) return;
    await sb.from("yy_test_results").delete().eq("session_id", s.id);
    await sb.from("yy_live_state").delete().eq("session_id", s.id);
    await sb.from("yy_test_sessions").delete().eq("id", s.id);
    $("resumeBar").classList.add("hidden");
    toast("Yarıda kalan oturum silindi");
  };
}

/* ---- Bitir → nabız girişi modu ---- */
$("btnStop").addEventListener("click", () => {
  if (!live || live.finished) return;
  if (confirm("Testi bitirip sonuç ekranına geç?")) enterResultsMode(false);
});

function enterResultsMode(natural) {
  live.finished = true;
  AudioSys.stopAll();
  cancelAnimationFrame(live.raf);
  clearInterval(live.clock);
  AudioSys.finish();
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  if (natural) live.players.forEach(p => { if (!p.eliminated) p.completed = TOTAL_RUNS; });
  live.natural = natural;
  $("livePhase").textContent = "BİTTİ";
  $("livePhase").className = "phase paused";
  renderResultsEntry();
}

/* ---- Sonuç girişi: HERKES için nabız ---- */
function renderResultsEntry() {
  $("athleteBoard").innerHTML = `
    <div class="batch-bar">
      <b>🏁 Test bitti — sporcuların son nabzını gir</b>
      <span class="dim">Nabzı bilmiyorsan boş bırak, kaydedilir.</span>
    </div>
    ${live.players.map((p, i) => {
      const dist = p.completed * 40;
      const r = p.completed > 0 ? SCHEDULE[p.completed - 1] : null;
      return `<div class="athlete-card results ${p.eliminated ? "gone" : ""}">
        <div class="ac-head">
          <span class="ac-name">${esc(p.name)}</span>
          <span class="ac-pos">${p.eliminated ? "Elenen" : "Tamamladı"} • ${r ? r.level + "." + r.inLevel : "–"} • <b>${dist} m</b></span>
        </div>
        <div class="hr-input">
          <input type="number" id="hr-${i}" placeholder="💗 Son nabız (bpm)" min="80" max="240" value="${p.hr ?? ""}">
        </div>
      </div>`;
    }).join("")}
    <button id="btnSaveResults" class="btn primary big" style="width:100%;margin-top:12px">💾 SONUÇLARI KAYDET</button>`;
  $("btnSaveResults").addEventListener("click", saveResults);
}

async function saveResults() {
  live.players.forEach((p, i) => { const el = $("hr-" + i); p.hr = el ? (+el.value || null) : null; });
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
      status: "completed",
      elapsed_seconds: Math.floor(elapsedSec()),
    };
  });
  const btn = $("btnSaveResults");
  btn.disabled = true; btn.textContent = "KAYDEDİLİYOR...";
  const { error } = await sb.from("yy_test_results").upsert(rows, { onConflict: "session_id,athlete_id" });
  if (error) {
    btn.disabled = false; btn.textContent = "💾 SONUÇLARI KAYDET";
    toast("Kaydedilemedi: " + error.message + " — tekrar dene!");
    return;
  }
  await sb.from("yy_test_sessions").update({ status: "completed" }).eq("id", currentSession.id);
  await sb.from("yy_live_state").delete().eq("session_id", currentSession.id);
  toast((live.natural ? "🏆 Test tamamlandı! " : "✅ ") + rows.length + " sporcu kaydedildi");
  live = null;
  currentSession = null;
  $("liveCard").classList.add("hidden");
  $("setupCard").classList.remove("hidden");
}

/* ---- Oyuncu kartları (canlı) ---- */
function renderBoard() {
  const board = $("athleteBoard");
  const keepScroll = board.scrollTop;
  const active = live.players.filter(p => !p.eliminated).length;
  board.innerHTML = `
    <div class="batch-bar">
      <button id="btnAllRan" class="btn ok big-grow">✓ HEPSİ KOŞTU (${active})</button>
      <span class="dim hint">Sporcu kartına tek tek de dokunabilirsin</span>
    </div>
    ${live.players.map((p, i) => cardHTML(p, i)).join("")}`;
  board.scrollTop = keepScroll;
  bindCardEvents();
  $("btnAllRan").addEventListener("click", () => {
    if (live.phase !== "run" && live.phase !== "rest") return toast("Şu anda koşu/dinlenme fazı yok");
    live.players.forEach(p => {
      if (p.eliminated) return;
      p.completed = Math.max(p.completed, curRun().n);
      p.tapped = true;
    });
    AudioSys.tapOk();
    updateAllCards();
  });
}

function cardHTML(p, i) {
  const r = p.completed > 0 ? SCHEDULE[p.completed - 1] : null;
  const dist = p.completed * 40;
  const state = p.eliminated ? ["ELENEN","state-out"] : p.violations > 0 ? ["UYARI","state-warn"] : ["AKTİF","state-ok"];
  return `
  <div class="athlete-card ${p.eliminated ? "gone" : p.violations ? "warn" : ""}" data-idx="${i}">
    <span class="ac-state ${state[1]}">${state[0]}</span>
    <div class="ac-head">
      <span class="ac-name">${esc(p.name)}</span>
      <span class="ac-pos">${p.position || ""}${p.jersey ? " #" + p.jersey : ""}</span>
    </div>
    <div class="ac-stats">
      <span>SEVİYE<b class="gold lv">${r ? r.level : "–"}</b></span>
      <span>MESAFE<b class="ds">${dist}<i style="font-style:normal;font-size:.6em"> m</i></b></span>
      <span>VO₂<b class="vo">${dist ? vo2max(dist) : "–"}</b></span>
      <span>İHLAL<b class="vi" style="color:${p.violations ? "var(--amber)" : "var(--tx)"}">${p.violations}</b></span>
    </div>
    ${p.eliminated ? `
      <div class="ac-actions">
        <span class="dim center" style="width:100%;font-size:.72rem">Elenen — nabız sonuç ekranında</span>
      </div>` : `
      <div class="ac-actions">
        <button class="btn ok" data-ok="${i}">✓ Koşu</button>
        <button class="btn viol" data-vi="${i}">⚠ İhlal</button>
        <button class="btn out" data-out="${i}">✕ Elden Çıkar</button>
      </div>`}
  </div>`;
}

function bindCardEvents() {
  const board = $("athleteBoard");
  board.querySelectorAll("[data-ok]").forEach(b => b.addEventListener("click", () => {
    const p = live.players[+b.dataset.ok];
    if (p.eliminated) return;
    p.completed = Math.max(p.completed, curRun().n);
    p.tapped = true;
    AudioSys.tapOk();
    updateCard(+b.dataset.ok);
  }));
  board.querySelectorAll("[data-vi]").forEach(b => b.addEventListener("click", () => {
    const p = live.players[+b.dataset.vi];
    if (p.eliminated) return;
    p.violations++;
    if (p.violations >= 2) { p.eliminated = true; AudioSys.elim(); renderBoard(); saveSnapshot(); return; }
    updateCard(+b.dataset.vi);
  }));
  board.querySelectorAll("[data-out]").forEach(b => b.addEventListener("click", () => {
    const p = live.players[+b.dataset.out];
    p.eliminated = true;
    renderBoard();
    saveSnapshot();
    if (live.players.every(x => x.eliminated)) enterResultsMode(false);
  }));
}

/* ---- tek kart güncelle (ekran sıçramasız) ---- */
function updateCard(i) {
  const el = $("athleteBoard").querySelector(`.athlete-card[data-idx="${i}"]`);
  if (!el) return;
  const p = live.players[i];
  const r = p.completed > 0 ? SCHEDULE[p.completed - 1] : null;
  const dist = p.completed * 40;
  el.querySelector(".lv").textContent = r ? r.level : "–";
  el.querySelector(".ds").innerHTML = `${dist}<i style="font-style:normal;font-size:.6em"> m</i>`;
  el.querySelector(".vo").textContent = dist ? vo2max(dist) : "–";
  const vi = el.querySelector(".vi");
  vi.textContent = p.violations;
  vi.style.color = p.violations ? "var(--amber)" : "var(--tx)";
  el.classList.add("keep");
}
function updateAllCards() {
  live.players.forEach((p, i) => { if (!p.eliminated) updateCard(i); });
}

/* ============================================================
   RAPORLAR
   ============================================================ */
async function loadSessions() {
  const { data, error } = await sb.from("yy_test_sessions").select("*").order("test_date", { ascending: false });
  if (error) return;
  $("sessionList").innerHTML = (data || []).map(s => `
    <div class="s-row">
      <div class="s-info" data-id="${s.id}">
        <b>${esc(s.title)}</b>
        <span class="dim">${s.test_date} ${s.group_name ? "• " + esc(s.group_name) : ""} ${s.location ? "• " + esc(s.location) : ""} ${s.status === "completed" ? "• ✅" : "• 🔴 canlı"}</span>
      </div>
      <div class="s-actions">
        <button class="btn ghost small" data-csv="${s.id}">📄 CSV</button>
        <button class="del" data-del="${s.id}">Sil</button>
      </div>
    </div>`).join("") || '<p class="dim center">Henüz test oturumu yok.</p>';
  $("sessionList").querySelectorAll(".s-info").forEach(r => r.addEventListener("click", () => openReport(r.dataset.id)));
  $("sessionList").querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Bu oturum ve TÜM sonuçları kalıcı olarak silinsin mi?")) return;
    await sb.from("yy_test_results").delete().eq("session_id", b.dataset.del);
    await sb.from("yy_live_state").delete().eq("session_id", b.dataset.del);
    const { error } = await sb.from("yy_test_sessions").delete().eq("id", b.dataset.del);
    if (error) return toast("Silinemedi: " + error.message);
    toast("Oturum silindi");
    loadSessions();
  }));
  $("sessionList").querySelectorAll("[data-csv]").forEach(b => b.addEventListener("click", () => exportCSV(b.dataset.csv)));
}

async function exportCSV(sessionId) {
  const [{ data: s }, { data: results }] = await Promise.all([
    sb.from("yy_test_sessions").select("*").eq("id", sessionId).single(),
    sb.from("yy_test_results").select("*, yy_athletes(name, position, jersey_number, group_name, birth_year)").eq("session_id", sessionId),
  ]);
  if (!s) return;
  const head = ["Sıra","Sporcu","Forma","Mevki","Grup","Yaş","Skor","Mesafe (m)","VO2max","Nabız","İhlal","Durum"];
  const lines = [head.join(";")];
  (results || []).sort((a, b) => (b.distance_m || 0) - (a.distance_m || 0)).forEach((r, i) => {
    const a = r.yy_athletes || {};
    const age = a.birth_year ? new Date(s.test_date).getFullYear() - a.birth_year : "";
    lines.push([
      i + 1, (a.name || "?"), a.jersey_number || "", POS_TR[a.position] || a.position || "",
      a.group_name || "", age,
      r.level ? r.level + "." + r.shuttle : "", r.distance_m || 0, r.vo2max || "",
      r.hr_max || "", r.violations || 0, r.eliminated ? "Elenen" : "Tamamladı",
    ].map(x => String(x).replace(/;/g, ",")).join(";"));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `yoyo-ir1-${s.title.replace(/[^\wğüşöçıİĞÜŞÖÇ -]/g, "")}-${s.test_date}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV indirildi 📄");
}

async function openReport(sessionId) {
  const [{ data: s }, { data: results }] = await Promise.all([
    sb.from("yy_test_sessions").select("*").eq("id", sessionId).single(),
    sb.from("yy_test_results").select("*, yy_athletes(name, position, jersey_number, group_name, birth_year)").eq("session_id", sessionId),
  ]);
  if (!s) return;
  const sorted = (results || []).slice().sort((a, b) => (b.distance_m || 0) - (a.distance_m || 0));
  const withV = sorted.filter(r => r.vo2max);
  const avgV = withV.length ? withV.reduce((t, r) => t + +r.vo2max, 0) / withV.length : 0;
  const avgD = sorted.length ? sorted.reduce((t, r) => t + (r.distance_m || 0), 0) / sorted.length : 0;
  const best = sorted[0];
  const maxD = Math.max(...sorted.map(r => r.distance_m || 0), 1);
  const posDist = {};
  sorted.forEach(r => { const p = r.yy_athletes?.position || "?"; posDist[p] = (posDist[p] || 0) + 1; });
  const youngCount = sorted.filter(r => {
    const by = r.yy_athletes?.birth_year;
    return by && new Date(s.test_date).getFullYear() - by < 18;
  }).length;

  $("reportBody").innerHTML = `
    <div class="rp-title">
      <h2>${esc(s.title)}</h2>
      <p class="dim">Darıca Gücü Spor Kulübü • ${s.test_date} ${s.group_name ? "• " + esc(s.group_name) : ""} ${s.location ? "• " + esc(s.location) : ""}</p>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${sorted.length}</b><span>🏃 KATILIMCI</span></div>
      <div class="stat"><b>${Math.round(avgD)} m</b><span>📏 ORT. MESAFE</span></div>
      <div class="stat"><b class="gold">${best ? best.distance_m + " m" : "–"}</b><span>🏆 EN İYİ</span></div>
      <div class="stat"><b>${avgV ? avgV.toFixed(1) : "–"}</b><span>💓 ORT. VO₂max</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Sporcu</th><th>Mevki</th><th>Skor</th><th>Mesafe</th><th>VO₂max</th><th>Değerlendirme</th><th>Durum</th><th></th></tr></thead>
      <tbody>
        ${sorted.map((r, i) => {
          const age = r.yy_athletes?.birth_year ? new Date(s.test_date).getFullYear() - r.yy_athletes.birth_year : null;
          const rt = rating(r.distance_m || 0, age);
          const barPct = Math.round((r.distance_m || 0) / maxD * 100);
          return `
          <tr class="${r.eliminated ? "elim" : ""}">
            <td><span class="rank ${i === 0 ? "g" : i === 1 ? "s" : i === 2 ? "b" : ""}">${i + 1}</span></td>
            <td><b>${esc(r.yy_athletes?.name || "?")}</b>${r.yy_athletes?.jersey_number ? " #" + r.yy_athletes.jersey_number : ""}<br><span class="dim" style="font-size:.68rem">${age ? age + " yaş" : ""}</span></td>
            <td>${POS_TR[r.yy_athletes?.position] || "–"}</td>
            <td><b>${r.level ? r.level + "." + r.shuttle : "–"}</b></td>
            <td><b>${r.distance_m || 0} m</b><div class="mini-bar"><i style="width:${barPct}%"></i></div></td>
            <td>${r.vo2max || "–"}</td>
            <td><span class="rating ${rt.cls}">${rt.label}</span></td>
            <td>${r.eliminated ? "Elenen" : "Tamamladı"}${r.hr_max ? "<br><span class='dim' style='font-size:.68rem'>💗 " + r.hr_max + " bpm</span>" : ""}</td>
            <td><button class="btn ghost small" data-hist="${r.athlete_id}" title="Gelişim kartı">📈</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${youngCount ? `<p class="dim center" style="font-size:.72rem;margin:10px 0">${youngCount} sporcu 18 yaş altı — yetişkin normu yerine gelişim takibi (📈) kullanılır</p>` : ""}
    <h3>Pozisyon Dağılımı</h3>
    <div class="pos-dist">
      ${Object.entries(posDist).map(([p, c]) => `<div class="pos-chip">${POS_TR[p] || p}: <b>${c}</b></div>`).join("")}
    </div>
    <h3>Antrenör Notları</h3>
    <textarea id="coachNotes" placeholder="Gözlemler, gelişim alanları, hedefler...">${esc(s.notes || "")}</textarea>
    <button id="btnSaveNotes" class="btn primary" style="margin-top:10px">Notları Kaydet</button>
    <p class="report-foot">
      Yo-Yo Intermittent Recovery Test Level 1 • Protokol: Bangsbo, Iaia &amp; Krustrup (2008) Sports Med 38(1):37-51<br>
      VO₂max = mesafe × 0.0084 + 36.4
    </p>`;
  $("sessionListCard").classList.add("hidden");
  $("reportDetail").classList.remove("hidden");
  $("btnSaveNotes").addEventListener("click", async () => {
    const { error } = await sb.from("yy_test_sessions").update({ notes: $("coachNotes").value }).eq("id", sessionId);
    toast(error ? "Not kaydedilemedi" : "Notlar kaydedildi ✅");
  });
  $("reportBody").querySelectorAll("[data-hist]").forEach(b => b.addEventListener("click", () => openHistory(b.dataset.hist)));
}

/* ---- Oyuncu gelişim kartı ---- */
async function openHistory(athleteId) {
  const { data: rows } = await sb.from("yy_test_results")
    .select("*, yy_test_sessions(title, test_date)")
    .eq("athlete_id", athleteId)
    .order("test_date", { ascending: true, referencedTable: "yy_test_sessions" });
  const a = athletes.find(x => x.id === athleteId) || { name: "?" };
  const list = rows || [];
  const maxD = Math.max(...list.map(r => r.distance_m || 0), 1);
  let prev = null;
  const cards = list.map((r) => {
    const delta = prev != null ? (r.distance_m || 0) - (prev.distance_m || 0) : null;
    prev = r;
    const pct = Math.round((r.distance_m || 0) / maxD * 100);
    const d = new Date(r.yy_test_sessions?.test_date || r.created_at);
    return `
    <div class="hist-row">
      <div class="hist-date">${d.toLocaleDateString("tr-TR")}<br><span class="dim" style="font-size:.64rem">${esc(r.yy_test_sessions?.title || "")}</span></div>
      <div class="hist-bar"><i style="width:${pct}%"></i><b>${r.distance_m || 0} m</b></div>
      <div class="hist-delta">${delta == null ? '<span class="dim">—</span>' : delta > 0 ? `<span class="up">▲ +${delta} m</span>` : delta < 0 ? `<span class="down">▼ ${delta} m</span>` : '<span class="dim">= aynı</span>'}</div>
      <div class="hist-vo">${r.vo2max ? "VO₂ " + r.vo2max : ""}</div>
    </div>`;
  }).join("");
  let summary = "";
  if (list.length >= 2) {
    const first = list[0], last = list[list.length - 1];
    const d = (last.distance_m || 0) - (first.distance_m || 0);
    const pct = first.distance_m ? Math.round(d / first.distance_m * 100) : 0;
    summary = `<div class="hist-summary ${d >= 0 ? "up-bg" : "down-bg"}">${d >= 0 ? "📈" : "📉"} İlk teste göre: <b>${d >= 0 ? "+" : ""}${d} m (${pct >= 0 ? "+" : ""}${pct}%)</b></div>`;
  }
  $("histBody").innerHTML = `
    <h2>📈 ${esc(a.name)}</h2>
    <p class="dim">${POS_TR[a.position] || ""} ${a.group_name ? "• " + esc(a.group_name) : ""} ${a.birth_year ? "• " + a.birth_year : ""}</p>
    ${list.length ? cards : '<p class="dim center">Bu sporcunun kayıtlı testi yok.</p>'}
    ${summary}`;
  $("historyModal").classList.remove("hidden");
}
$("btnCloseHist").addEventListener("click", () => $("historyModal").classList.add("hidden"));
$("historyModal").addEventListener("click", e => { if (e.target.id === "historyModal") $("historyModal").classList.add("hidden"); });

$("btnBackReport").addEventListener("click", () => {
  $("reportDetail").classList.add("hidden");
  $("sessionListCard").classList.remove("hidden");
});
$("btnPrint").addEventListener("click", () => window.print());

/* ============================================================
   BAŞLANGIÇ
   ============================================================ */
init();
