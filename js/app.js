/* =========================================================
   Darıca Gücü — Yo-Yo IR1 Lab
   Canlı test • Oyuncu kartları • Takım raporu • Kalıcı hafıza
   ========================================================= */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPA_URL = "https://riqjwcyayewkyhmpgbmd.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpcWp3Y3lheWV3a3lobXBnYm1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzEwODUsImV4cCI6MjA5MjEwNzA4NX0.nnJLvstovo60UnoHGmuhkG1vDbkMf9DC9NdojU0F-3M";
const sb = createClient(SUPA_URL, SUPA_KEY);

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
let toastT;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

/* ---------------- Yo-Yo IR1 Protokolü ---------------- */
// Seviye 1: 13.0 km/s, her seviye +0.5 km/s, seviye başına 2 mekik (2x20m), seviye sonunda 10 sn dinlenme
const IR1 = {
  startSpeed: 13.0,
  inc: 0.5,
  shuttlesPerStage: 2,
  recoverySec: 10,
  shuttleDist: 20,
  // toplam mekik -> seviye, seviye içi mekik, hız, mesafe
  calc(n) {
    // n: 1'den başlayan global mekik indeksi
    const stage = Math.floor((n - 1) / this.shuttlesPerStage) + 1;
    const inStage = ((n - 1) % this.shuttlesPerStage) + 1;
    const speed = this.startSpeed + (stage - 1) * this.inc;
    const dist = n * this.shuttleDist;
    return { stage, inStage, speed, dist };
  },
  shuttleSeconds(n) {
    const { speed } = this.calc(n);
    return this.shuttleDist / (speed * 1000 / 3600); // 20m süresi (sn)
  },
  vo2max(dist) { return +(dist * 0.0092 + 39.4).toFixed(1); } // Bangsbo tahmini
};

/* ---------------- Ses ---------------- */
let actx;
function beep(freq = 1000, dur = 0.12, vol = 0.4) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.type = "sine";
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { /* ses engellenmişse sessiz devam */ }
}

/* ---------------- Genel durum ---------------- */
let athletes = [];
let currentSession = null;
let live = null; // canlı test durumu

const POS_TR = { GK: "Kaleci", DF: "Defans", MF: "Orta Saha", FW: "Forvet" };

async function loadAthletes() {
  const { data, error } = await sb.from("yy_athletes").select("*").order("name");
  if (error) { toast("Veritabanına ulaşılamadı — proje uyuyor olabilir"); return; }
  athletes = data || [];
  renderAthletePicker();
  renderAthleteList();
  renderGroupOptions();
}

/* ---------------- Sekmeler ---------------- */
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  $("view-" + t.dataset.view).classList.add("active");
  if (t.dataset.view === "reports") loadSessions();
}));

/* ---------------- Sporcular ---------------- */
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
  ["aName", "aJersey", "aBirth"].forEach(i => $(i).value = "");
  loadAthletes();
});

function renderAthleteList() {
  $("athleteCount").textContent = athletes.length + " sporcu";
  $("athleteList").innerHTML = athletes.map(a => `
    <div class="a-row">
      <div class="info">
        <b>${esc(a.name)} ${a.jersey_number ? "#" + a.jersey_number : ""}</b>
        <span>${POS_TR[a.position] || a.position || ""} • ${a.group_name || "Grup yok"} ${a.birth_year ? "• " + a.birth_year : ""}</span>
      </div>
      <button class="btn del" data-id="${a.id}">Sil</button>
    </div>`).join("");
  $("athleteList").querySelectorAll(".del").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Bu sporcuyu silmek istiyor musun?")) return;
    await sb.from("yy_athletes").delete().eq("id", b.dataset.id);
    loadAthletes();
  }));
}

function renderAthletePicker() {
  $("pickAthletes").innerHTML = athletes.map(a => `
    <label class="pick">
      <input type="checkbox" value="${a.id}">
      <span>${esc(a.name)} ${a.jersey_number ? "#" + a.jersey_number : ""}</span>
    </label>`).join("") || '<p class="dim">Önce "Sporcular" sekmesinden oyuncu ekle.</p>';
}

function renderGroupOptions() {
  const groups = [...new Set(athletes.map(a => a.group_name).filter(Boolean))];
  $("sGroup").innerHTML = '<option value="">Grup seç</option>' +
    groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
}

/* ---------------- Canlı Test ---------------- */
$("btnStartSetup").addEventListener("click", async () => {
  const picked = [...$("pickAthletes").querySelectorAll("input:checked")].map(i => i.value);
  if (!picked.length) return toast("En az bir sporcu seç");
  const title = $("sTitle").value.trim() || "Yo-Yo IR1 Testi";
  const rec = {
    title,
    test_date: $("sDate").value || new Date().toISOString().slice(0, 10),
    group_name: $("sGroup").value || null,
    location: $("sLocation").value.trim() || null,
    status: "live",
  };
  const { data, error } = await sb.from("yy_test_sessions").insert(rec).select().single();
  if (error || !data) return toast("Oturum oluşturulamadı: " + (error?.message || ""));
  currentSession = data;
  startLive(picked);
});

function startLive(pickedIds) {
  $("setupCard").classList.add("hidden");
  $("liveCard").classList.remove("hidden");
  $("liveTitle").textContent = currentSession.title;
  $("liveMeta").textContent = (currentSession.group_name ? currentSession.group_name + " • " : "") +
    (currentSession.location || "") + " • " + pickedIds.length + " sporcu";
  live = {
    shuttleN: 0,            // tamamlanan global mekik (protokol)
    timer: 0,
    paused: false,
    finished: false,
    t0: Date.now(),
    timerInt: setInterval(() => {
      if (!live.paused) {
        live.timer = Math.floor((Date.now() - live.t0) / 1000);
        $("liveTimer").textContent = fmt(live.timer);
      }
    }, 500),
    players: pickedIds.map(id => {
      const a = athletes.find(x => x.id === id);
      return {
        id, name: a.name, jersey: a.jersey_number, position: a.position,
        completed: 0, violations: 0, eliminated: false, tapped: false, hr: null,
      };
    }),
  };
  renderBoard();
  nextShuttle();
}

function nextShuttle() {
  if (!live || live.paused || live.finished) return;
  live.shuttleN++;
  const p = IR1.calc(live.shuttleN);
  $("curLevel").textContent = p.stage;
  $("curShuttle").textContent = p.inStage;
  $("curSpeed").textContent = p.speed.toFixed(1);
  $("curDist").textContent = p.dist;
  beep(900, 0.15, 0.5); // mekik başlama düdüğü
  $("livePhase").textContent = `${p.stage}. seviye • ${p.inStage}. mekik — KOŞ`;

  const runSec = IR1.shuttleSeconds(live.shuttleN);
  live.runTO = setTimeout(() => {
    // Mekik bitti: düdük + değerlendirme + dinlenme
    beep(1300, 0.18, 0.5);
    let autoOut = false;
    live.players.forEach(pl => {
      if (pl.eliminated) return;
      if (!pl.tapped) {
        pl.violations++;
        if (pl.violations >= 2) { pl.eliminated = true; autoOut = true; }
      }
      pl.tapped = false;
    });
    if (autoOut) beep(400, 0.3, 0.6);
    renderBoard();
    if (live.players.every(pl => pl.eliminated)) { finishLive(); return; }
    const isStageEnd = p.inStage === IR1.shuttlesPerStage;
    const rest = isStageEnd ? IR1.recoverySec : 2;
    $("livePhase").textContent = isStageEnd ? `Dinlenme: ${IR1.recoverySec} sn` : "Çevir — HAZIR";
    live.restTO = setTimeout(nextShuttle, rest * 1000);
  }, runSec * 1000);
}

function renderBoard() {
  $("athleteBoard").innerHTML = live.players.map((pl, i) => {
    const p = IR1.calc(Math.max(1, pl.completed));
    const dist = pl.completed * IR1.shuttleDist;
    const state = pl.eliminated ? ["ELENEN", "state-out"] :
      pl.violations > 0 ? ["UYARI", "state-warn"] : ["AKTİF", "state-ok"];
    return `
    <div class="athlete-card ${pl.eliminated ? "eliminated" : pl.violations ? "warn" : ""}">
      <span class="ac-state ${state[1]}">${state[0]}</span>
      <div class="ac-head">
        <span class="ac-name">${esc(pl.name)}</span>
        <span class="ac-pos">${pl.position || ""}${pl.jersey ? " #" + pl.jersey : ""}</span>
      </div>
      <div class="ac-stats">
        <span>Seviye<b>${pl.completed ? p.stage : "–"}</b></span>
        <span>Mekik<b>${pl.completed}</b></span>
        <span>Mesafe<b>${dist} m</b></span>
        <span>İhlal<b style="color:${pl.violations ? "var(--amber)" : "var(--tx)"}">${pl.violations}</b></span>
      </div>
      ${pl.eliminated ? `
        <div class="hr-input">
          <input type="number" placeholder="Nabız (ops.)" id="hr-${i}" min="80" max="240">
          <button class="btn primary" data-hr="${i}">Kaydet</button>
        </div>` : `
        <div class="ac-actions">
          <button class="btn ok" data-ok="${i}">✓ Mekik Tamam</button>
          <button class="btn viol" data-vi="${i}">⚠ İhlal</button>
          <button class="btn out" data-out="${i}" style="grid-column:1/3">Elden Çıkar</button>
        </div>`}
    </div>`;
  }).join("");

  $("athleteBoard").querySelectorAll("[data-ok]").forEach(b => b.addEventListener("click", () => {
    const pl = live.players[+b.dataset.ok];
    if (pl.eliminated) return;
    pl.completed = Math.max(pl.completed, live.shuttleN); // güncel mekikte tut
    pl.tapped = true;
    renderBoard();
  }));
  $("athleteBoard").querySelectorAll("[data-vi]").forEach(b => b.addEventListener("click", () => {
    const pl = live.players[+b.dataset.vi];
    if (pl.eliminated) return;
    pl.violations++;
    if (pl.violations >= 2) pl.eliminated = true;
    beep(400, 0.2, 0.4);
    renderBoard();
  }));
  $("athleteBoard").querySelectorAll("[data-out]").forEach(b => b.addEventListener("click", () => {
    const pl = live.players[+b.dataset.out];
    pl.eliminated = true;
    renderBoard();
    if (live.players.every(x => x.eliminated)) finishLive();
  }));
  $("athleteBoard").querySelectorAll("[data-hr]").forEach(b => b.addEventListener("click", () => {
    const pl = live.players[+b.dataset.hr];
    pl.hr = +($("hr-" + b.dataset.hr).value) || null;
    toast(pl.name + " nabız kaydedildi");
  }));
}

$("btnPause").addEventListener("click", () => {
  if (!live) return;
  live.paused = !live.paused;
  $("btnPause").textContent = live.paused ? "Devam Et" : "Duraklat";
  if (live.paused) { clearTimeout(live.runTO); clearTimeout(live.restTO); }
  else { live.t0 = Date.now() - live.timer * 1000; nextShuttle(); }
});

$("btnStop").addEventListener("click", () => {
  if (!live) return;
  if (confirm("Testi bitirip sonuçları kaydetmek istiyor musun?")) finishLive();
});

async function finishLive() {
  if (!live || live.finished) return;
  live.finished = true;
  clearTimeout(live.runTO); clearTimeout(live.restTO);
  clearInterval(live.timerInt);
  beep(1300, 0.5, 0.6); setTimeout(() => beep(1300, 0.5, 0.6), 350);

  const rows = live.players.map(pl => {
    const p = IR1.calc(Math.max(1, pl.completed));
    const dist = pl.completed * IR1.shuttleDist;
    return {
      session_id: currentSession.id,
      athlete_id: pl.id,
      level: pl.completed ? p.stage : null,
      shuttle: pl.completed ? p.inStage : null,
      distance_m: dist,
      vo2max: dist ? IR1.vo2max(dist) : null,
      hr_max: pl.hr,
      violations: pl.violations,
      eliminated: pl.eliminated,
      elapsed_seconds: live.timer,
    };
  });
  const { error } = await sb.from("yy_test_results").insert(rows);
  if (error) toast("Sonuç kaydı hatası: " + error.message);
  await sb.from("yy_test_sessions").update({ status: "completed" }).eq("id", currentSession.id);

  toast("Test tamamlandı — " + rows.length + " sporcu sonucu kaydedildi ✅");
  $("liveCard").classList.add("hidden");
  $("setupCard").classList.remove("hidden");
  live = null;
  loadSessions();
}

/* ---------------- Raporlar ---------------- */
async function loadSessions() {
  const { data, error } = await sb.from("yy_test_sessions").select("*").order("test_date", { ascending: false });
  if (error) return;
  $("sessionList").innerHTML = (data || []).map(s => `
    <div class="s-row" data-id="${s.id}">
      <div>
        <b>${esc(s.title)}</b>
        <span class="dim">${s.test_date} ${s.group_name ? "• " + esc(s.group_name) : ""} ${s.location ? "• " + esc(s.location) : ""} ${s.status === "completed" ? "• ✅ Tamamlandı" : ""}</span>
      </div>
      <span class="dim">Rapor →</span>
    </div>`).join("") || '<p class="dim">Henüz test oturumu yok.</p>';
  $("sessionList").querySelectorAll(".s-row").forEach(r => r.addEventListener("click", () => openReport(r.dataset.id)));
}

async function openReport(sessionId) {
  const [{ data: s }, { data: results }] = await Promise.all([
    sb.from("yy_test_sessions").select("*").eq("id", sessionId).single(),
    sb.from("yy_test_results").select("*, yy_athletes(name, position, jersey_number)").eq("session_id", sessionId),
  ]);
  if (!s) return;
  const sorted = (results || []).slice().sort((a, b) => (b.distance_m || 0) - (a.distance_m || 0));
  const finishers = sorted.filter(r => !r.eliminated);
  const avgV = sorted.length ? (sorted.reduce((t, r) => t + (+r.vo2max || 0), 0) / sorted.filter(r => r.vo2max).length || 0) : 0;
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
      <div class="stat"><b>${finishers.length}</b><span>TAMAMLADı</span></div>
      <div class="stat"><b>${best ? best.distance_m + " m" : "–"}</b><span>EN İYİ MESAFE</span></div>
      <div class="stat"><b>${avgV ? avgV.toFixed(1) : "–"}</b><span>ORT. VO2MAX (TAHMİN)</span></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Sporcu</th><th>Mevki</th><th>Seviye</th><th>Mekik</th><th>Mesafe</th><th>VO2max</th><th>İhlal</th><th>Durum</th></tr></thead>
      <tbody>
        ${sorted.map((r, i) => `
          <tr class="${r.eliminated ? "elim" : ""}">
            <td><span class="rank ${i === 0 ? "g" : i === 1 ? "s" : i === 2 ? "b" : ""}">${i + 1}</span></td>
            <td><b>${esc(r.yy_athletes?.name || "?")}</b>${r.yy_athletes?.jersey_number ? " #" + r.yy_athletes.jersey_number : ""}</td>
            <td>${POS_TR[r.yy_athletes?.position] || r.yy_athletes?.position || "–"}</td>
            <td>${r.level || "–"}</td>
            <td>${r.shuttle || "–"}</td>
            <td><b>${r.distance_m || 0} m</b></td>
            <td>${r.vo2max || "–"}</td>
            <td>${r.violations || 0}</td>
            <td>${r.eliminated ? "Elenen" : "Tamamladı"}${r.hr_max ? " • " + r.hr_max + " bpm" : ""}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    <h3>Pozisyon Dağılımı</h3>
    <div class="pos-dist">
      ${Object.entries(posDist).map(([p, c]) => `<div class="pos-chip">${POS_TR[p] || p}: <b>${c}</b></div>`).join("")}
    </div>
    <h3>Antrenör Notları</h3>
    <textarea id="coachNotes" placeholder="Test hakkındaki gözlemler, notlar...">${esc(s.notes || "")}</textarea>
    <button id="btnSaveNotes" class="btn primary" style="margin-top:8px">Notları Kaydet</button>
    <p class="report-foot">Yo-Yo Intermittent Recovery Test Level 1 • VO2max değerleri mesafeye dayalı tahmindir (Bangsbo)</p>
  `;
  $("sessionList").parentElement.classList.add("hidden");
  $("reportDetail").classList.remove("hidden");
  $("btnSaveNotes").addEventListener("click", async () => {
    const { error } = await sb.from("yy_test_sessions").update({ notes: $("coachNotes").value }).eq("id", sessionId);
    toast(error ? "Not kaydedilemedi" : "Notlar kaydedildi ✅");
  });
}

$("btnBackReport").addEventListener("click", () => {
  $("reportDetail").classList.add("hidden");
  document.querySelector("#view-reports .card").classList.remove("hidden");
});
$("btnPrint").addEventListener("click", () => window.print());

/* ---------------- Yardımcılar ---------------- */
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })); }
function fmt(sec) { return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }

/* ---------------- Başlangıç ---------------- */
$("sDate").value = new Date().toISOString().slice(0, 10);
loadAthletes();

// PWA kaydı
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
