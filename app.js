(() => {
  const STORAGE_KEY = "bp_chatlog_items_v4";
  const MEDS_KEY = "bp_chatlog_meds_v1";
  const WATER_TARGET_KEY = "bp_chatlog_water_target_ml_v1";
  const DEFAULT_WATER_TARGET = 2000;

  const el = (id) => document.getElementById(id);
  const state = { items: [], editingId: null };

  function uuid(){
    return (crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  }

  function safeNum(v){
    const s = String(v ?? "").trim();
    if(!s) return null;
    const x = Number(s.replace(",", "."));
    return Number.isFinite(x) ? x : null;
  }

  function nowLocalInputValue(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toLocalInput(dateObj){
    const pad = (n) => String(n).padStart(2, "0");
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth()+1)}-${pad(dateObj.getDate())}T${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
  }

  function escapeHtml(str){
    return String(str ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;")
      .replaceAll("\n","<br/>");
  }

  function normalizeText(s){ return String(s ?? "").toLowerCase().trim(); }

  function toast(msg){
    const t = el("toast");
    if(!t) return;
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.add("hidden"), 2200);
  }

  function formatWhen(iso){
    if(!iso) return "-";
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function parseDateOnly(v){
    if(!v) return null;
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dayKey(iso){
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())) return "unknown";
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  function classifyBP(sys, dia){
    if(sys == null || dia == null) return {label:"-", cls:""};
    if(sys >= 180 || dia >= 120) return {label:"bardzo wysokie", cls:"bad"};
    if(sys >= 140 || dia >= 90) return {label:"wysokie", cls:"warn"};
    if(sys >= 130 || dia >= 85) return {label:"podwyższone", cls:"warn"};
    if(sys < 90 || dia < 60) return {label:"niskie", cls:"warn"};
    return {label:"OK", cls:"ok"};
  }

  function scaleLabel(v){
    if(v <= 0) return "brak";
    if(v <= 2) return "minimalne";
    if(v <= 4) return "łagodne";
    if(v <= 6) return "wyraźne";
    if(v <= 8) return "silne";
    return "bardzo silne";
  }

  function loadWaterTarget(){
    try{
      const raw = localStorage.getItem(WATER_TARGET_KEY);
      const v = Number(raw);
      return Number.isFinite(v) && v > 0 ? Math.round(v) : DEFAULT_WATER_TARGET;
    }catch{
      return DEFAULT_WATER_TARGET;
    }
  }

  function effectiveWaterMl(item){
    if (typeof item?.waterMl === "number" && item.waterMl > 0) {
      const hyd = (typeof item.hydration === "number" && Number.isFinite(item.hydration)) ? item.hydration : 1;
      return Math.round(item.waterMl * hyd);
    }
    return 0;
  }

  function loadMedsAll(){
    try{
      const raw = localStorage.getItem(MEDS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch{
      return [];
    }
  }

  function chartSvg(series){
    const w = 320;
    const h = 80;
    const p = 6;
    const points = series.filter(s => s.values.length > 1);
    if(!points.length) return "";

    let min = Infinity;
    let max = -Infinity;
    for(const s of points){
      for(const v of s.values){
        if(v == null) continue;
        if(v < min) min = v;
        if(v > max) max = v;
      }
    }
    if(!Number.isFinite(min) || !Number.isFinite(max)) return "";
    const span = (max - min) || 1;

    const lines = points.map((s) => {
      const pts = s.values.map((v, i) => {
        if(v == null) return null;
        const x = p + (w - 2 * p) * (i / Math.max(1, s.values.length - 1));
        const y = p + (h - 2 * p) * (1 - (v - min) / span);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).filter(Boolean).join(" ");
      return `<polyline class="chartLine ${s.cls}" points="${pts}"/>`;
    }).join("");

    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`;
  }

  function renderSummary(items){
    const waterTotal = items.reduce((sum, it) => sum + effectiveWaterMl(it), 0);
    const from = parseDateOnly(el("fromDate").value);
    const to = parseDateOnly(el("toDate").value);
    let dayCount = 0;
    if(from && to){
      const fromMs = from.getTime();
      const toMs = to.getTime();
      dayCount = Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1);
    }else{
      const days = new Set();
      for(const it of items){
        if(it?.dt) days.add(dayKey(it.dt));
      }
      dayCount = days.size || 0;
    }
    const targetPerDay = loadWaterTarget();
    const targetTotal = dayCount > 0 ? (dayCount * targetPerDay) : 0;

    const waterTotalEl = el("waterTotal");
    const waterTargetEl = el("waterTarget");
    const waterDaysEl = el("waterDays");
    const waterBarEl = el("waterBar");

    if(waterTotalEl) waterTotalEl.textContent = String(waterTotal || 0);
    if(waterTargetEl) waterTargetEl.textContent = targetTotal ? String(targetTotal) : "-";
    if(waterDaysEl) waterDaysEl.textContent = dayCount ? `${dayCount} dni` : "brak zakresu";
    if(waterBarEl){
      const pct = targetTotal > 0 ? Math.min(100, Math.round((waterTotal / targetTotal) * 100)) : 0;
      waterBarEl.style.width = `${pct}%`;
    }

    const sorted = [...items].sort((a,b) => new Date(a.dt).getTime() - new Date(b.dt).getTime());
    const sysSeries = sorted.map(it => (typeof it.sys === "number" && it.sys > 0 ? it.sys : null));
    const diaSeries = sorted.map(it => (typeof it.dia === "number" && it.dia > 0 ? it.dia : null));
    const pulseSeries = sorted.map(it => (typeof it.pulse === "number" && it.pulse > 0 ? it.pulse : null));
    const chart = chartSvg([
      { cls: "sys", values: sysSeries },
      { cls: "dia", values: diaSeries },
      { cls: "pulse", values: pulseSeries }
    ]);

    const chartBox = el("bpPulseChart");
    if(chartBox){
      if(chart){
        chartBox.innerHTML = chart;
        chartBox.classList.add("hasChart");
      }else{
        chartBox.textContent = "Brak danych w widoku.";
        chartBox.classList.remove("hasChart");
      }
    }

    const bpInfo = el("bpPulseInfo");
    if(bpInfo){
      const latestBp = [...sorted].reverse().find(it => typeof it.sys === "number" && typeof it.dia === "number" && it.sys > 0 && it.dia > 0);
      const latestPulse = [...sorted].reverse().find(it => typeof it.pulse === "number" && it.pulse > 0);
      const bpCount = sysSeries.filter(v => v != null).length;
      const pulseCount = pulseSeries.filter(v => v != null).length;

      const rows = [];
      if(latestBp){
        const bp = classifyBP(latestBp.sys, latestBp.dia);
        rows.push(
          `<div class="bpInfoRow"><span class="bpInfoLabel">Ostatni BP:</span><span class="bpInfoValue">${latestBp.sys}/${latestBp.dia}</span><span>${bp.label}</span></div>`
        );
        rows.push(
          `<div class="bpInfoRow"><span class="bpInfoLabel">Kiedy:</span><span class="bpInfoValue">${formatWhen(latestBp.dt)}</span></div>`
        );
      }
      if(latestPulse){
        rows.push(
          `<div class="bpInfoRow"><span class="bpInfoLabel">Ostatni puls:</span><span class="bpInfoValue">${latestPulse.pulse}</span></div>`
        );
      }
      if(bpCount || pulseCount){
        rows.push(
          `<div class="bpInfoRow"><span class="bpInfoLabel">Wpisy:</span><span class="bpInfoValue">BP ${bpCount} | P ${pulseCount}</span></div>`
        );
      }

      bpInfo.innerHTML = rows.length ? rows.join("") : "-";
    }

    const medsBox = el("medsSummary");
    if(medsBox){
      const stats = new Map();
      for(const it of items){
        if(!it?.medications || typeof it.medications !== "object") continue;
        for(const [id, status] of Object.entries(it.medications)){
          if(!stats.has(id)) stats.set(id, { taken: 0, missed: 0 });
          const entry = stats.get(id);
          if(status === "taken") entry.taken += 1;
          if(status === "missed" || status === "late") entry.missed += 1;
        }
      }

      if(!stats.size){
        medsBox.textContent = "Brak danych w widoku.";
      }else{
        const catalog = loadMedsAll();
        const nameById = new Map(catalog.map(m => [m.id, m]));

        const rows = [];
        for(const [id, v] of stats.entries()){
          const m = nameById.get(id);
          const name = m ? `${m.name}${m.dose ? " " + m.dose : ""}` : id;
          rows.push(
            `<div class="medsRow">
              <div class="medsCell">${escapeHtml(name)}</div>
              <div class="medsStat ok">${v.taken ? "✓" + v.taken : "-"}</div>
              <div class="medsStat bad">${v.missed ? "✕" + v.missed : "-"}</div>
            </div>`
          );
        }
        medsBox.innerHTML = rows.join("");
      }
    }
  }

  function appendLine(current, line){
    const c = (current || "").trim();
    const l = String(line || "").trim();
    if(!l) return c;
    if(!c) return l;
    if(c.includes(l)) return c;
    return c + "\n" + l;
  }

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      state.items = raw ? JSON.parse(raw) : [];
      if(!Array.isArray(state.items)) state.items = [];
    }catch{
      state.items = [];
    }
  }

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  }

  function loadMedsCatalog(){
    try{
      const raw = localStorage.getItem(MEDS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const meds = Array.isArray(arr) ? arr : [];
      return meds.filter(m => m && m.active);
    }catch{
      return [];
    }
  }

  function renderMedChecklist(selected){
    const box = el("medChecklist");
    if(!box) return;

    const meds = loadMedsCatalog();
    const cur = selected && typeof selected === "object" ? selected : {};

    if(!meds.length){
      box.innerHTML = `<div class="small">Nie masz zdefiniowanych leków. Dodaj je w Ustawieniach.</div>`;
      return;
    }

    box.innerHTML = "";
    meds.forEach(m => {
      const tooltip = [m.name, m.dose, m.defaultTime].filter(Boolean).join(" | ");
      const row = document.createElement("div");
      row.className = "medItem";

      const left = document.createElement("div");
      left.className = "left";
      left.innerHTML = `
        <div class="name tooltipTrigger" data-tooltip="${escapeHtml(tooltip || m.name || "")}"><span class="medNameText">${escapeHtml(m.name)}</span> ${m.dose ? `<span class="badge">${escapeHtml(m.dose)}</span>` : ""}</div>
        <div class="hint">${m.defaultTime ? `domyślnie ${escapeHtml(m.defaultTime)}` : "bez domyślnej godziny"}</div>
      `;

      const right = document.createElement("div");
      right.className = "right";

      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.setAttribute("data-med-id", m.id);
      hidden.value = cur[m.id] || "none";

      const seg = document.createElement("div");
      seg.className = "seg";

      const mkBtn = (key, label, cls) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `segBtn ${cls}`;
        b.textContent = label;
        b.onclick = () => { hidden.value = key; updateActive(); };
        return b;
      };

      const btnTaken = mkBtn("taken", "wzięty", "taken");
      const btnMissed = mkBtn("missed", "pominięty", "missed");
      const btnLate = mkBtn("late", "opóźniony", "late");
      seg.appendChild(btnTaken);
      seg.appendChild(btnMissed);
      seg.appendChild(btnLate);

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "medReset";
      reset.textContent = "brak info";
      reset.onclick = () => { hidden.value = "none"; updateActive(); };

      const updateActive = () => {
        const v = hidden.value || "none";
        btnTaken.classList.toggle("active", v === "taken");
        btnMissed.classList.toggle("active", v === "missed");
        btnLate.classList.toggle("active", v === "late");
        reset.classList.toggle("active", v === "none");
      };
      updateActive();

      right.appendChild(seg);
      right.appendChild(reset);
      right.appendChild(hidden);

      row.appendChild(left);
      row.appendChild(right);
      box.appendChild(row);
    });
  }

  function syncSliders(){
    const s = Number(el("severity").value);
    const a = Number(el("anxiety").value);
    el("severityVal").textContent = String(s);
    el("anxietyVal").textContent = String(a);
    el("severityText").textContent = scaleLabel(s);
    el("anxietyText").textContent = scaleLabel(a);
  }

  function resetForm(){
    state.editingId = null;
    el("formTitle").textContent = "Dodaj wpis";
    el("cancelEditBtn").classList.add("hidden");
    el("saveBtn").textContent = "Zapisz";

    el("dt").value = nowLocalInputValue();
    el("entryType").value = "log";

    el("sys").value = "";
    el("dia").value = "";
    el("pulse").value = "";

    el("food").value = "";
    el("waterAmount").value = "";
    el("waterType").value = "1";

    el("substances").value = "";
    el("events").value = "";
    el("sleep").value = "";

    el("symptoms").value = "";
    el("hypothesis").value = "";
    el("notes").value = "";

    el("medNotes").value = "";
    renderMedChecklist({});

    el("severity").value = "0";
    el("anxiety").value = "0";
    syncSliders();
  }

  function readForm(){
    const dtLocal = el("dt").value;
    const dtISO = dtLocal ? new Date(dtLocal).toISOString() : new Date().toISOString();

    const medsStatus = {};
    document.querySelectorAll('#medChecklist input[type="hidden"][data-med-id]').forEach(h => {
      const id = h.getAttribute("data-med-id");
      const v = h.value;
      if(id && v && v !== "none") medsStatus[id] = v;
    });

    const waterMl = safeNum(el("waterAmount").value);
    const hydration = Number(el("waterType").value || 1);

    return {
      dt: dtISO,
      entryType: el("entryType").value,

      sys: safeNum(el("sys").value),
      dia: safeNum(el("dia").value),
      pulse: safeNum(el("pulse").value),

      medications: medsStatus,
      medNotes: el("medNotes").value.trim(),

      food: el("food").value.trim(),
      waterMl,
      hydration: Number.isFinite(hydration) ? hydration : 1,

      events: el("events").value.trim(),
      sleep: el("sleep").value.trim(),
      substances: el("substances").value.trim(),

      symptoms: el("symptoms").value.trim(),
      severity: safeNum(el("severity").value) ?? 0,
      anxiety: safeNum(el("anxiety").value) ?? 0,
      hypothesis: el("hypothesis").value.trim(),
      notes: el("notes").value.trim(),
    };
  }

  function writeForm(item){
    const d = new Date(item.dt);
    el("dt").value = Number.isNaN(d.getTime()) ? nowLocalInputValue() : toLocalInput(d);

    el("entryType").value = item.entryType ?? "log";
    el("sys").value = item.sys ?? "";
    el("dia").value = item.dia ?? "";
    el("pulse").value = item.pulse ?? "";

    el("food").value = item.food ?? "";
    el("waterAmount").value = item.waterMl ?? "";
    el("waterType").value = String(item.hydration ?? 1);

    el("events").value = item.events ?? "";
    el("sleep").value = item.sleep ?? "";
    el("substances").value = item.substances ?? "";

    el("symptoms").value = item.symptoms ?? "";

    el("severity").value = String(item.severity ?? 0);
    el("anxiety").value = String(item.anxiety ?? 0);
    syncSliders();

    el("hypothesis").value = item.hypothesis ?? "";
    el("notes").value = item.notes ?? "";

    el("medNotes").value = item.medNotes ?? "";
    renderMedChecklist(item.medications || {});
  }

  function upsert(){
    const data = readForm();

    if(state.editingId){
      const idx = state.items.findIndex(x => x.id === state.editingId);
      if(idx >= 0){
        state.items[idx] = { ...state.items[idx], ...data };
        save();
        toast("Zapisano zmiany.");
      }else{
        state.items.push({ id: uuid(), createdAt: new Date().toISOString(), ...data });
        save();
        toast("Nie znalazłem wpisu do edycji. Zapisano jako nowy.");
      }
    }else{
      state.items.push({ id: uuid(), createdAt: new Date().toISOString(), ...data });
      save();
      toast("Dodano wpis.");
    }

    load();
    resetForm();
    render();
  }

  function startEdit(id){
    const it = state.items.find(x => x.id === id);
    if(!it) return;
    state.editingId = id;
    el("formTitle").textContent = "Edytuj wpis";
    el("cancelEditBtn").classList.remove("hidden");
    el("saveBtn").textContent = "Zapisz zmiany";
    writeForm(it);
  }

  function remove(id){
    const ok = confirm("Usunąć ten wpis? Tego nie cofniesz.");
    if(!ok) return;
    state.items = state.items.filter(x => x.id !== id);
    save();
    load();
    toast("Usunięto wpis.");
    render();
  }

  function buildSearchBlob(item){
    const medsText = item.medications ? JSON.stringify(item.medications) : "";
    return normalizeText([
      item.entryType,
      item.food,
      item.waterMl, item.hydration,
      item.events, item.sleep, item.substances,
      item.symptoms, item.hypothesis, item.notes,
      item.medNotes, medsText
    ].join(" | "));
  }

  function filtered(){
    const q = normalizeText(el("q").value);
    const sort = el("sort").value;

    const from = parseDateOnly(el("fromDate").value);
    const to = parseDateOnly(el("toDate").value);

    let fromTs = null;
    let toTs = null;

    if(from){
      from.setHours(0,0,0,0);
      fromTs = from.getTime();
    }
    if(to){
      to.setHours(23,59,59,999);
      toTs = to.getTime();
    }

    let items = [...state.items].filter(x => x && x.dt);

    if(fromTs != null) items = items.filter(it => new Date(it.dt).getTime() >= fromTs);
    if(toTs != null) items = items.filter(it => new Date(it.dt).getTime() <= toTs);

    if(q) items = items.filter(it => buildSearchBlob(it).includes(q));

    items.sort((a,b) => {
      const ta = new Date(a.dt).getTime();
      const tb = new Date(b.dt).getTime();
      return sort === "asc" ? ta - tb : tb - ta;
    });

    return items;
  }

  function render(){
    const items = filtered();
    renderSummary(items);
    el("countPill").textContent = String(state.items.length);

    const list = el("list");
    list.innerHTML = "";

    if(!items.length){
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "Brak wpisów w tym widoku.";
      list.appendChild(empty);
      return;
    }

    const showMetrics = Boolean(el("showMetrics")?.checked);
    let rendered = 0;
    for(let idx = 0; idx < items.length; idx += 1){
      const it = items[idx];
      const lines = [];

      if(it.medNotes) lines.push({k:"Uwagi do leków", v: it.medNotes});
      if(it.food) lines.push({k:"Jedzenie", v: it.food});
      if(it.events) lines.push({k:"Wydarzenia", v: it.events});
      if(it.sleep) lines.push({k:"Sen", v: it.sleep});
      if(it.substances) lines.push({k:"Substancje", v: it.substances});
      if(it.symptoms) lines.push({k:"Objawy", v: it.symptoms});
      if(it.hypothesis) lines.push({k:"Hipoteza", v: it.hypothesis});
      if(it.notes) lines.push({k:"Notatki", v: it.notes});

      if(!lines.length){
        const tags = [];
        if(typeof it.sys === "number" && typeof it.dia === "number" && it.sys > 0 && it.dia > 0) tags.push("ciśnienie");
        if(typeof it.pulse === "number" && it.pulse > 0) tags.push("puls");
        if(typeof it.waterMl === "number" && it.waterMl > 0) tags.push("nawodnienie");
        if(it.medications && typeof it.medications === "object" && Object.keys(it.medications).length) tags.push("leki");
        if(!showMetrics || !tags.length) continue;
        lines.push({k:"Wpis metryczny", v: tags.join(", ")});
      }

      const item = document.createElement("div");
      item.className = "item";

      const meta = document.createElement("div");
      meta.className = "meta";

      const left = document.createElement("div");
      left.innerHTML = `
        <div class="when">${formatWhen(it.dt)}</div>
        <div class="small">Typ: ${escapeHtml(it.entryType || "-")} | Sev: ${it.severity ?? "-"} | Anx: ${it.anxiety ?? "-"}</div>
      `;

      meta.appendChild(left);

      const content = document.createElement("div");
      content.className = "content";

      for(const ln of lines){
        const p = document.createElement("div");
        p.className = "line";
        p.innerHTML = `<span class="muted">${ln.k}:</span> ${escapeHtml(ln.v)}`;
        content.appendChild(p);
      }

      const actions = document.createElement("div");
      actions.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Edytuj";
      editBtn.onclick = () => startEdit(it.id);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.textContent = "Usuń";
      delBtn.onclick = () => remove(it.id);

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      item.appendChild(meta);
      item.appendChild(content);
      item.appendChild(actions);

      list.appendChild(item);
      rendered += 1;
    }
    if(!rendered){
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "Brak wpisów w tym widoku.";
      list.appendChild(empty);
    }
  }

  function setDateRangeToToday(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    el("fromDate").value = today;
    el("toDate").value = today;
    render();
  }

  function clearDateRange(){
    el("fromDate").value = "";
    el("toDate").value = "";
    render();
  }

  function buildViewExportPayload(viewItems){
    return {
      exportedAt: new Date().toISOString(),
      app: "bp-chatlog",
      version: 4,
      scope: "current_view",
      filters: {
        q: el("q").value ?? "",
        sort: el("sort").value ?? "desc",
        fromDate: el("fromDate").value ?? "",
        toDate: el("toDate").value ?? ""
      },
      items: viewItems
    };
  }

  async function copyTextToClipboard(text){
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch{}

    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }catch{
      return false;
    }
  }

  async function copyCurrentViewJson(){
    const view = filtered();
    const payload = buildViewExportPayload(view);
    const text = JSON.stringify(payload, null, 2);
    const ok = await copyTextToClipboard(text);
    if(ok) toast(`Skopiowano JSON z widoku. Wpisów: ${view.length}`);
    else alert("Nie udało się skopiować do schowka (blokada przeglądarki).");
  }

  function init(){
    load();

    const settings = window.Theme.loadSettings();
    window.Theme.applyTheme(settings);

    el("dt").value = nowLocalInputValue();
    el("severity").value = "0";
    el("anxiety").value = "0";
    syncSliders();

    renderMedChecklist({});

    el("saveBtn").addEventListener("click", upsert);
    el("resetBtn").addEventListener("click", () => { resetForm(); toast("Wyczyszczono formularz."); });
    el("cancelEditBtn").addEventListener("click", () => { resetForm(); toast("Anulowano edycję."); });

    el("severity").addEventListener("input", syncSliders);
    el("anxiety").addEventListener("input", syncSliders);

    document.querySelectorAll(".chipbtn").forEach(btn => {
      btn.onclick = () => {
        const token = btn.dataset.addsym;
        if(!token) return;
        const cur = el("symptoms").value.trim();
        if(!cur) { el("symptoms").value = token; return; }
        if(cur.toLowerCase().includes(token.toLowerCase())) return;
        el("symptoms").value = cur + ", " + token;
      };
    });

    el("q").addEventListener("input", render);
    el("sort").addEventListener("change", render);
    el("fromDate").addEventListener("change", render);
    el("toDate").addEventListener("change", render);
    el("showMetrics").addEventListener("change", render);

    el("todayBtn").addEventListener("click", setDateRangeToToday);
    el("allBtn").addEventListener("click", clearDateRange);
    el("copyViewBtn").addEventListener("click", copyCurrentViewJson);

    setDateRangeToToday();
    render();
  }

  init();
})();
