(() => {
  const STORAGE_KEY = "bp_chatlog_items_v4";
  const MEDS_KEY = "bp_chatlog_meds_v1";

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

  function medStatusLabel(status){
    if(status === "taken") return "wzięty";
    if(status === "missed") return "pominięty";
    if(status === "late") return "opóźniony";
    return "brak info";
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

  function calcAverages(items){
    const nums = (arr) => arr.filter(v => typeof v === "number" && Number.isFinite(v) && v > 0);
    const avg = (arr) => {
      const a = nums(arr);
      if(!a.length) return null;
      return a.reduce((s,x) => s+x, 0) / a.length;
    };
    return {
      sysAvg: avg(items.map(i => i.sys)),
      diaAvg: avg(items.map(i => i.dia)),
      pulseAvg: avg(items.map(i => i.pulse)),
      sevAvg: avg(items.map(i => i.severity)),
      anxAvg: avg(items.map(i => i.anxiety)),
    };
  }

  function setAvgPill(items){
    const a = calcAverages(items);
    const fmt = (x) => x == null ? "-" : Math.round(x);
    el("avgPill").textContent = `BP ${fmt(a.sysAvg)}/${fmt(a.diaAvg)} P ${fmt(a.pulseAvg)} | Sev ${fmt(a.sevAvg)} Anx ${fmt(a.anxAvg)}`;
  }

  function render(){
    const items = filtered();
    setAvgPill(items);
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

    for(const it of items){
      const item = document.createElement("div");
      item.className = "item";

      const meta = document.createElement("div");
      meta.className = "meta";

      const left = document.createElement("div");
      left.innerHTML = `
        <div class="when">${formatWhen(it.dt)}</div>
        <div class="small">Typ: ${escapeHtml(it.entryType || "-")} | Sev: ${it.severity ?? "-"} | Anx: ${it.anxiety ?? "-"}</div>
      `;

      const kpis = document.createElement("div");
      kpis.className = "kpis";

      if (typeof it.sys === "number" && typeof it.dia === "number" && it.sys > 0 && it.dia > 0) {
        const bp = classifyBP(it.sys, it.dia);
        const kpiBP = document.createElement("span");
        kpiBP.className = `kpi ${bp.cls}`;
        kpiBP.textContent = `BP: ${it.sys} / ${it.dia} (${bp.label})`;
        kpis.appendChild(kpiBP);
      }

      if (typeof it.pulse === "number" && it.pulse > 0) {
        const kpiP = document.createElement("span");
        kpiP.className = "kpi";
        kpiP.textContent = `P: ${it.pulse}`;
        kpis.appendChild(kpiP);
      }

      if (typeof it.waterMl === "number" && it.waterMl > 0) {
        const eff = Math.round(it.waterMl * (typeof it.hydration === "number" ? it.hydration : 1));
        const kpiW = document.createElement("span");
        kpiW.className = "kpi";
        kpiW.textContent = `Woda: ${eff} ml`;
        kpis.appendChild(kpiW);
      }

      meta.appendChild(left);
      meta.appendChild(kpis);

      const content = document.createElement("div");
      content.className = "content";

      const lines = [];

      if(it.medications && typeof it.medications === "object" && Object.keys(it.medications).length){
        const medsLine = Object.entries(it.medications)
          .map(([k,v]) => `${k}=${medStatusLabel(v)}`)
          .join(", ");
        lines.push({k:"Leki", v: medsLine});
      }
      if(it.medNotes) lines.push({k:"Uwagi do leków", v: it.medNotes});
      if(it.food) lines.push({k:"Jedzenie", v: it.food});

      if(typeof it.waterMl === "number" && it.waterMl > 0){
        const hyd = (typeof it.hydration === "number" ? it.hydration : 1);
        const eff = Math.round(it.waterMl * hyd);
        lines.push({k:"Nawodnienie", v: `${it.waterMl} ml (efektywnie ${eff} ml)`});
      }

      if(it.events) lines.push({k:"Wydarzenia", v: it.events});
      if(it.sleep) lines.push({k:"Sen", v: it.sleep});
      if(it.substances) lines.push({k:"Substancje", v: it.substances});
      if(it.symptoms) lines.push({k:"Objawy", v: it.symptoms});
      if(it.hypothesis) lines.push({k:"Hipoteza", v: it.hypothesis});
      if(it.notes) lines.push({k:"Notatki", v: it.notes});

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

    el("todayBtn").addEventListener("click", setDateRangeToToday);
    el("allBtn").addEventListener("click", clearDateRange);
    el("copyViewBtn").addEventListener("click", copyCurrentViewJson);

    setDateRangeToToday();
    render();
  }

  init();
})();
