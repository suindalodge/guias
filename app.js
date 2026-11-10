/* Plataforma de guías · Suindá — etapa 1
   Capturas con fotos, Mis días, Licencias sin señal y Equipo. */
"use strict";

const sb = supabase.createClient(CONFIG.url, CONFIG.key, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = s => document.querySelector(s);
const main = $("#main");
const ESPECIES = ["Dorado", "Pacú", "Pirá pytá", "Otra"];
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let perfil = null;          // { id, email, nombre, rol, guia_id, guia_nombre }
let tabActual = null;

/* ---------- utilidades ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const isoLocal = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const hoy = () => isoLocal(new Date());
const sumaDias = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoLocal(d); };
const horaStr = () => { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DIAS_L = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fCorta = iso => { const d = new Date(iso + "T12:00:00"); return DIAS[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1); };
const fDM = iso => { const d = new Date(iso + "T12:00:00"); return d.getDate() + "/" + (d.getMonth() + 1); };
const uid = () => crypto.randomUUID();
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};
function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const online = () => navigator.onLine;
function cargarScript(src) {
  return new Promise((ok, no) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("No se pudo cargar " + src));
    document.head.appendChild(s);
  });
}

/* ---------- almacenamiento en el teléfono (IndexedDB) ---------- */
const idb = (() => {
  let dbp;
  const abrir = () => dbp || (dbp = new Promise((ok, no) => {
    const r = indexedDB.open("suinda", 1);
    r.onupgradeneeded = () => { const db = r.result; ["fotos", "cola", "lic"].forEach(n => db.objectStoreNames.contains(n) || db.createObjectStore(n)); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  }));
  const tx = async (st, modo, fn) => { const db = await abrir(); return new Promise((ok, no) => {
    const t = db.transaction(st, modo); const s = t.objectStore(st); const req = fn(s);
    t.oncomplete = () => ok(req && req.result); t.onerror = () => no(t.error);
  }); };
  return {
    get: (st, k) => tx(st, "readonly", s => s.get(k)),
    put: (st, k, v) => tx(st, "readwrite", s => s.put(v, k)),
    del: (st, k) => tx(st, "readwrite", s => s.delete(k)),
    all: (st) => tx(st, "readonly", s => s.getAll()),
    keys: (st) => tx(st, "readonly", s => s.getAllKeys())
  };
})();

/* ---------- imágenes ---------- */
function comprimir(file, max = 1600, calidad = 0.82) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : no(new Error("No se pudo procesar la imagen")), "image/jpeg", calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error("No se pudo leer la imagen")); };
    img.src = url;
  });
}
async function pdfAImagenes(file) {
  await cargarScript(PDFJS);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
    const page = await pdf.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1600 / Math.max(v1.width, v1.height)) });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.85)));
  }
  return out;
}

/* ---------- inicio y sesión ---------- */
async function iniciar() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  actualizarRed();
  window.addEventListener("online", () => { actualizarRed(); procesarCola(); });
  window.addEventListener("offline", actualizarRed);
  $("#salir").onclick = salir;
  $("#cola-btn").onclick = () => procesarCola(true);
  $("#visor-cerrar").onclick = cerrarVisor;
  setInterval(procesarCola, 60000);

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return verLogin();
  await cargarPerfil(session.user);
}

function actualizarRed() { $("#net").hidden = online(); }

async function cargarPerfil(user) {
  let p = null;
  if (online()) {
    const { data, error } = await sb.from("perfiles").select("id,email,nombre,rol,guia_id,guias(nombre)").eq("id", user.id).maybeSingle();
    if (!error && data) {
      p = { id: data.id, email: data.email, nombre: data.nombre, rol: data.rol, guia_id: data.guia_id, guia_nombre: data.guias ? data.guias.nombre : "" };
      store.set("perfil", p);
    }
  }
  if (!p) { const c = store.get("perfil", null); if (c && c.id === user.id) p = c; }
  if (!p) { main.innerHTML = `<div class="card"><p>No se pudo cargar tu cuenta. Abrí la app con señal la primera vez.</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`; return; }
  perfil = p;
  $("#who").hidden = false; $("#who-name").textContent = p.guia_nombre || p.nombre || p.email;
  if (p.rol === "pendiente") return verPendiente();
  armarTabs();
  procesarCola();
}

async function salir() {
  const cola = await idb.keys("cola");
  if (cola.length && !confirm("Hay planillas sin enviar en este teléfono. Si salís, se borran. ¿Salir igual?")) return;
  await sb.auth.signOut().catch(() => {});
  store.del("perfil"); location.reload();
}

function verLogin(modo = "entrar") {
  $("#tabs").hidden = true; $("#who").hidden = true;
  const crear = modo === "crear";
  main.innerHTML = `
  <div class="card">
    <h2>${crear ? "Crear cuenta" : "Entrar"}</h2>
    ${crear ? `<label for="l-nombre">Nombre y apellido</label><input id="l-nombre" autocomplete="name">` : ""}
    <label for="l-mail">Mail</label><input id="l-mail" type="email" autocomplete="email" inputmode="email">
    <label for="l-pass">Contraseña</label><input id="l-pass" type="password" autocomplete="${crear ? "new-password" : "current-password"}">
    ${crear ? `<p class="hint">Mínimo 6 caracteres. Después de crearla, el administrador te habilita.</p>` : ""}
    <p class="err" id="l-err" hidden></p>
    <button class="btn" id="l-go">${crear ? "Crear cuenta" : "Entrar"}</button>
    <button class="btn secondary" id="l-alt">${crear ? "Ya tengo cuenta" : "Crear una cuenta nueva"}</button>
  </div>`;
  $("#l-alt").onclick = () => verLogin(crear ? "entrar" : "crear");
  $("#l-go").onclick = async () => {
    const mail = $("#l-mail").value.trim(), pass = $("#l-pass").value, err = $("#l-err");
    err.hidden = true;
    if (!mail || !pass) { err.textContent = "Completá el mail y la contraseña."; err.hidden = false; return; }
    if (!online()) { err.textContent = "Para entrar la primera vez hace falta señal."; err.hidden = false; return; }
    $("#l-go").disabled = true;
    let res;
    if (crear) {
      const nombre = $("#l-nombre").value.trim();
      if (!nombre) { err.textContent = "Escribí tu nombre."; err.hidden = false; $("#l-go").disabled = false; return; }
      res = await sb.auth.signUp({ email: mail, password: pass, options: { data: { nombre } } });
    } else {
      res = await sb.auth.signInWithPassword({ email: mail, password: pass });
    }
    $("#l-go").disabled = false;
    if (res.error) {
      const m = res.error.message || "";
      err.textContent = /Invalid login/i.test(m) ? "Mail o contraseña incorrectos." :
        /already registered/i.test(m) ? "Ese mail ya tiene cuenta. Tocá «Ya tengo cuenta»." :
        /Password should be/i.test(m) ? "La contraseña debe tener al menos 6 caracteres." :
        /Email not confirmed/i.test(m) ? "Falta confirmar el mail: revisá tu correo." : m;
      err.hidden = false; return;
    }
    if (!res.data.session) { main.innerHTML = `<div class="card"><h2>Revisá tu mail</h2><p>Te mandamos un enlace para confirmar la cuenta. Después volvé a entrar.</p><button class="btn" onclick="location.reload()">Volver</button></div>`; return; }
    await cargarPerfil(res.data.session.user);
  };
}

function verPendiente() {
  $("#tabs").hidden = true;
  main.innerHTML = `<div class="card"><h2>Cuenta creada</h2>
    <p>Falta que el administrador te habilite y te asigne tu rol. Cuando lo haga, tocá el botón.</p>
    <button class="btn" id="p-re">Ya me habilitaron</button></div>`;
  $("#p-re").onclick = async () => { const { data } = await sb.auth.getUser(); if (data.user) cargarPerfil(data.user); };
}

/* ---------- pestañas según el rol ---------- */
function armarTabs() {
  const r = perfil.rol, t = [];
  if (perfil.guia_id) t.push(["capturas", "Capturas"], ["dias", "Mis días"]);
  t.push(["licencias", "Licencias"]);
  if (r === "admin" || r === "jefe") t.push(["equipo", "Equipo"]);
  const inn = $("#tabs-in");
  inn.innerHTML = t.map(([k, n]) => `<button data-tab="${k}" role="tab">${n}</button>`).join("");
  inn.onclick = e => { const b = e.target.closest("[data-tab]"); if (b) irA(b.dataset.tab); };
  $("#tabs").hidden = false;
  const pedida = location.hash.replace("#", "");
  irA(t.some(x => x[0] === pedida) ? pedida : t[0][0]);
}
function irA(tab) {
  tabActual = tab;
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  document.querySelectorAll("#tabs-in button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  window.scrollTo(0, 0);
  ({ capturas: verCapturas, dias: verDias, licencias: verLicencias, equipo: verEquipo })[tab]();
}
window.addEventListener("hashchange", () => {
  const t = location.hash.replace("#", "");
  if (perfil && t !== tabActual && document.querySelector(`#tabs-in [data-tab="${t}"]`)) irA(t);
});

/* =====================================================================
   CAPTURAS
   ===================================================================== */
let borr = null; // borrador de la planilla del día
const borrNuevo = () => ({ fecha: hoy(), lugar: "", peces: [], fotos: [] });
const pezNuevo = () => ({ especie: "", otra: "", arte: "", peso: "", hora: horaStr(), lugar: "", notas: "" });
const guardarBorr = () => store.set("borrador", borr);

function verCapturas() {
  borr = store.get("borrador", null) || borrNuevo();
  const lugares = store.get("lugares", []);
  main.innerHTML = `
  <div class="card">
    <h2>Planilla del día</h2>
    <div class="row">
      <div><label for="c-fecha">Fecha</label><input id="c-fecha" type="date" value="${esc(borr.fecha)}"></div>
      <div><label for="c-lugar">Lugar</label><input id="c-lugar" list="dl-lugares" value="${esc(borr.lugar)}" placeholder="Ej.: Isla Pelada"></div>
    </div>
    <datalist id="dl-lugares">${lugares.map(l => `<option value="${esc(l)}">`).join("")}</datalist>
    <div id="peces"></div>
    <button class="btn secondary" id="add-pez">+ Agregar pez</button>
    <label>Fotos del día</label>
    <div class="fotos" id="fotos"></div>
    <div class="addfoto">
      <label>Sacar foto<input type="file" accept="image/*" capture="environment" id="f-cam"></label>
      <label>Desde la galería<input type="file" accept="image/*" multiple id="f-gal"></label>
    </div>
    <p class="err" id="c-err" hidden></p>
    <button class="btn" id="c-enviar">Enviar planilla</button>
  </div>
  <div class="card"><h3>Enviadas desde este teléfono</h3><ul class="list" id="enviadas"></ul></div>`;
  $("#c-fecha").onchange = e => { borr.fecha = e.target.value; guardarBorr(); };
  $("#c-lugar").oninput = e => { borr.lugar = e.target.value; guardarBorr(); };
  $("#add-pez").onclick = () => { borr.peces.push(pezNuevo()); guardarBorr(); pintarPeces(); };
  $("#f-cam").onchange = e => sumarFotos(e.target);
  $("#f-gal").onchange = e => sumarFotos(e.target);
  $("#c-enviar").onclick = enviarPlanilla;
  pintarPeces(); pintarFotos(); pintarEnviadas();
  if (online()) refrescarLugares();
}

function pintarPeces() {
  const box = $("#peces");
  if (!borr.peces.length) { box.innerHTML = `<p class="hint" style="margin-top:14px">Tocá «Agregar pez» por cada pieza. Si solo vas a mandar fotos, no hace falta.</p>`; return; }
  box.innerHTML = borr.peces.map((p, i) => `
  <div class="pez" data-i="${i}">
    <div class="pez-head"><b>Pez ${i + 1}</b><button class="x" data-quitar="${i}">Quitar</button></div>
    <label>Especie</label>
    <div class="chips">${ESPECIES.map(e => `<button class="chip" data-f="especie" data-v="${esc(e)}" aria-pressed="${p.especie === e}">${esc(e)}</button>`).join("")}</div>
    ${p.especie === "Otra" ? `<input data-f="otra" value="${esc(p.otra)}" placeholder="¿Qué especie?" style="margin-top:8px">` : ""}
    <label>Arte</label>
    <div class="chips two">${["Mosca", "Spinning"].map(a => `<button class="chip" data-f="arte" data-v="${a}" aria-pressed="${p.arte === a}">${a}</button>`).join("")}</div>
    <div class="row">
      <div><label>Peso</label><div class="suffix"><input data-f="peso" inputmode="decimal" value="${esc(p.peso)}" placeholder="0,0"><span>kg</span></div></div>
      <div><label>Hora</label><input data-f="hora" type="time" value="${esc(p.hora)}"></div>
    </div>
    <label>Lugar</label><input data-f="lugar" list="dl-lugares" value="${esc(p.lugar)}" placeholder="Si es otro que el del día">
    <label>Notas</label><textarea data-f="notas" placeholder="Opcional">${esc(p.notas)}</textarea>
  </div>`).join("");
  box.onclick = e => {
    const q = e.target.closest("[data-quitar]");
    if (q) { borr.peces.splice(+q.dataset.quitar, 1); guardarBorr(); pintarPeces(); return; }
    const c = e.target.closest(".chip");
    if (c) { const i = +c.closest(".pez").dataset.i; borr.peces[i][c.dataset.f] = c.dataset.v; guardarBorr(); pintarPeces(); }
  };
  box.oninput = e => {
    const f = e.target.dataset.f; if (!f) return;
    const i = +e.target.closest(".pez").dataset.i; borr.peces[i][f] = e.target.value; guardarBorr();
  };
}

async function sumarFotos(input) {
  const files = [...input.files]; input.value = "";
  for (const f of files) {
    try { const b = await comprimir(f); const id = uid(); await idb.put("fotos", id, b); borr.fotos.push(id); guardarBorr(); }
    catch (e) { toast(e.message); }
  }
  pintarFotos();
}
async function pintarFotos() {
  const box = $("#fotos"); if (!box) return;
  const html = [];
  for (const id of borr.fotos) {
    const b = await idb.get("fotos", id);
    if (b) html.push(`<div><img src="${URL.createObjectURL(b)}" alt="Foto del día"><button data-del="${id}" aria-label="Quitar foto">×</button></div>`);
  }
  box.innerHTML = html.join("");
  box.onclick = async e => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    borr.fotos = borr.fotos.filter(x => x !== d.dataset.del); guardarBorr(); await idb.del("fotos", d.dataset.del); pintarFotos();
  };
}

async function enviarPlanilla() {
  const err = $("#c-err"); err.hidden = true;
  const fallo = m => { err.textContent = m; err.hidden = false; };
  if (!borr.fecha) return fallo("Elegí la fecha.");
  if (!borr.peces.length && !borr.fotos.length) return fallo("Agregá al menos un pez o una foto.");
  for (let i = 0; i < borr.peces.length; i++) {
    const p = borr.peces[i];
    if (!p.especie) return fallo(`Falta la especie del pez ${i + 1}.`);
    if (p.especie === "Otra" && !p.otra.trim()) return fallo(`Escribí qué especie es el pez ${i + 1}.`);
    if (p.peso && isNaN(Number(String(p.peso).replace(",", ".")))) return fallo(`El peso del pez ${i + 1} no es un número.`);
  }
  const planillaId = uid();
  const item = {
    id: planillaId, creado: Date.now(),
    planilla: { id: planillaId, guia_id: perfil.guia_id, fecha: borr.fecha, lugar: borr.lugar.trim() || null },
    capturas: borr.peces.map(p => ({
      id: uid(), planilla_id: planillaId, guia_id: perfil.guia_id, fecha: borr.fecha,
      hora: p.hora || null,
      especie: p.especie === "Otra" ? p.otra.trim() : p.especie,
      arte: p.arte || null,
      peso_kg: p.peso ? Number(String(p.peso).replace(",", ".")) : null,
      lugar: (p.lugar || "").trim() || borr.lugar.trim() || null,
      notas: (p.notas || "").trim() || null
    })),
    fotos: borr.fotos.map(id => ({ id, subida: false })),
    lugares: [...new Set([borr.lugar, ...borr.peces.map(p => p.lugar)].map(x => (x || "").trim()).filter(Boolean))]
  };
  await idb.put("cola", item.id, item);
  const hist = store.get("enviadas", []);
  hist.unshift({ id: item.id, fecha: borr.fecha, peces: item.capturas.length, fotos: item.fotos.length, estado: "espera" });
  store.set("enviadas", hist.slice(0, 30));
  borr = borrNuevo(); guardarBorr();
  toast(online() ? "Enviando…" : "Guardada. Se envía sola al volver la señal.");
  verCapturas();
  procesarCola();
}

function pintarEnviadas() {
  const ul = $("#enviadas"); if (!ul) return;
  const h = store.get("enviadas", []);
  ul.innerHTML = h.length ? h.slice(0, 10).map(x => `<li><div><b>${fCorta(x.fecha)}</b><span class="meta">${x.peces} ${x.peces === 1 ? "pez" : "peces"} · ${x.fotos} ${x.fotos === 1 ? "foto" : "fotos"}</span></div>
    <span class="estado ${x.estado === "ok" ? "si" : "no"}">${x.estado === "ok" ? "Enviada" : "Esperando señal"}</span></li>`).join("")
    : `<li class="empty">Todavía no enviaste planillas desde este teléfono.</li>`;
}

async function refrescarLugares() {
  const { data } = await sb.from("lugares").select("nombre").order("nombre");
  if (data) store.set("lugares", data.map(x => x.nombre));
}

/* ---------- cola de envío (funciona sin señal) ---------- */
let enviando = false;
async function procesarCola(manual) {
  const items = (await idb.all("cola")).sort((a, b) => a.creado - b.creado);
  pintarCola(items.length);
  if (!items.length || enviando || !online() || !perfil) return;
  enviando = true;
  let errores = 0;
  for (const it of items) {
    try {
      await enviarItem(it);
      await idb.del("cola", it.id);
      const h = store.get("enviadas", []); const x = h.find(y => y.id === it.id); if (x) { x.estado = "ok"; store.set("enviadas", h); }
    } catch (e) { errores++; console.error(e); }
  }
  enviando = false;
  const quedan = (await idb.keys("cola")).length;
  pintarCola(quedan);
  if (tabActual === "capturas") pintarEnviadas();
  if (manual || (items.length && !quedan)) toast(quedan ? `No se pudo enviar (${quedan} pendiente${quedan > 1 ? "s" : ""}). Se reintenta solo.` : "Planillas enviadas.");
}
async function enviarItem(it) {
  let r = await sb.from("planillas").upsert(it.planilla, { onConflict: "id", ignoreDuplicates: true });
  if (r.error) throw r.error;
  if (it.capturas.length) {
    r = await sb.from("capturas").upsert(it.capturas, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw r.error;
  }
  if (it.lugares && it.lugares.length) {
    await sb.from("lugares").upsert(it.lugares.map(n => ({ nombre: n })), { onConflict: "nombre", ignoreDuplicates: true });
  }
  for (const f of it.fotos) {
    if (f.subida) continue;
    const blob = await idb.get("fotos", f.id);
    const path = `${it.planilla.guia_id}/${it.planilla.fecha}/${f.id}.jpg`;
    if (blob) {
      const up = await sb.storage.from("fotos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error && !/exist|duplicate/i.test(up.error.message || "")) throw up.error;
    }
    r = await sb.from("fotos").upsert({ id: f.id, planilla_id: it.id, guia_id: it.planilla.guia_id, fecha: it.planilla.fecha, path },
      { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw r.error;
    f.subida = true; await idb.put("cola", it.id, it); await idb.del("fotos", f.id);
  }
}
function pintarCola(n) {
  $("#cola").hidden = !n;
  $("#cola-txt").textContent = n === 1 ? "1 planilla sin enviar" : `${n} planillas sin enviar`;
}

/* =====================================================================
   MIS DÍAS
   ===================================================================== */
async function verDias() {
  main.innerHTML = `<p class="loading">Cargando tus días…</p>`;
  let filas = store.get("misdias", null);
  if (online()) {
    const desde = hoy().slice(0, 8) + "01";
    const { data, error } = await sb.from("v_dias_guia").select("fecha,turnos,dias,inicia_bloque")
      .eq("guia_id", perfil.guia_id).gte("fecha", sumaDias(desde, -31)).order("fecha");
    if (!error && data) { filas = data; store.set("misdias", data); store.set("misdias_at", Date.now()); }
  }
  if (tabActual !== "dias") return;
  if (!filas) { main.innerHTML = `<div class="card"><p class="empty">Abrí esta pestaña con señal una vez para guardar tus días.</p></div>`; return; }

  // Bloques de guiadas
  const bloques = [];
  for (const f of filas) { if (f.inicia_bloque || !bloques.length) bloques.push({ inicio: f.fecha, fin: f.fecha, dias: 0 }); const b = bloques[bloques.length - 1]; b.fin = f.fecha; b.dias += Number(f.dias); }
  const h = hoy();
  const actual = bloques.find(b => b.inicio <= h && b.fin >= h);
  const prox = bloques.find(b => b.inicio > h);
  let banner = "";
  if (actual) banner = `<div class="prox"><small>Estás en un bloque de guiadas</small><strong>Hasta el ${fCorta(actual.fin)}</strong><span>Del ${fDM(actual.inicio)} al ${fDM(actual.fin)} · ${fmtDias(actual.dias)}</span></div>`;
  else if (prox) {
    const d = new Date(prox.inicio + "T12:00:00");
    banner = `<div class="prox"><small>Próximo bloque</small><strong>${DIAS_L[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}</strong><span>Del ${fDM(prox.inicio)} al ${fDM(prox.fin)} · ${fmtDias(prox.dias)}</span></div>`;
  } else banner = `<div class="card"><p class="empty" style="padding:8px 0">No tenés días asignados por delante.</p></div>`;
  if (actual && prox) banner += `<div class="card"><b>Después:</b> del ${fDM(prox.inicio)} al ${fDM(prox.fin)} · ${fmtDias(prox.dias)}</div>`;

  // Por mes, desde el mes actual
  const visibles = filas.filter(f => f.fecha >= h.slice(0, 8) + "01");
  const meses = {};
  visibles.forEach(f => { (meses[f.fecha.slice(0, 7)] ||= []).push(f); });
  const listado = Object.entries(meses).map(([ym, fs]) => {
    const [y, m] = ym.split("-").map(Number);
    const tot = fs.reduce((a, f) => a + Number(f.dias), 0);
    return `<div class="mes"><h3>${MESES[m - 1]} ${y}<span>${fmtDias(tot)}</span></h3><ul class="dias">${fs.map(f => {
      const cl = [f.inicia_bloque ? "bloque" : "", f.fecha < h ? "pasado" : "", f.fecha === h ? "hoy" : ""].join(" ");
      const t = f.turnos || "";
      return `<li class="${cl}"><b>${fCorta(f.fecha)}</b><span class="turnos"><span class="${/AM/.test(t) ? "on" : ""}">AM</span><span class="${/PM/.test(t) ? "on" : ""}">PM</span></span></li>`;
    }).join("")}</ul></div>`;
  }).join("");
  const at = store.get("misdias_at", 0);
  main.innerHTML = banner + `<div class="card">${listado || `<p class="empty">Sin días este mes.</p>`}
    <p class="hint">Según el chart del lodge${at ? ` · actualizado ${new Date(at).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}. La línea dorada marca el inicio de cada bloque.</p></div>`;
}
const fmtDias = n => (n === 1 ? "1 día" : String(n).replace(".", ",") + " días");

/* =====================================================================
   LICENCIAS
   ===================================================================== */
async function verLicencias() {
  const gestiona = perfil.rol === "jefe" || perfil.rol === "admin";
  main.innerHTML = `
  <div class="card"><h2>Licencias</h2>
    <p class="hint" style="margin-top:0">Clientes que llegan, están o se fueron hace poco (2 días antes y después). Quedan guardadas en el teléfono para mostrarlas sin señal.</p>
    <ul class="list" id="lic-ver"><li class="empty">Cargando…</li></ul></div>
  ${gestiona ? `<div class="card"><h2>Cargar licencias</h2>
    <input id="lic-buscar" placeholder="Buscar cliente o grupo">
    <ul class="list" id="lic-adm" style="margin-top:8px"><li class="empty">Cargando…</li></ul>
    <button class="btn secondary" id="cli-nuevo">+ Agregar cliente a mano</button>
    <div id="cli-form" hidden>
      <label for="cn-nombre">Nombre</label><input id="cn-nombre">
      <label for="cn-grupo">Grupo</label><input id="cn-grupo" placeholder="Ej.: S16">
      <div class="row"><div><label for="cn-ini">Llega</label><input id="cn-ini" type="date"></div><div><label for="cn-fin">Se va</label><input id="cn-fin" type="date"></div></div>
      <button class="btn" id="cn-ok">Guardar cliente</button>
    </div>
    <input type="file" id="lic-file" accept="application/pdf,image/*" hidden>
  </div>` : ""}`;
  await pintarLicenciasVer();
  if (gestiona) prepararGestionLicencias();
}

async function pintarLicenciasVer() {
  const ul = $("#lic-ver");
  let lista = store.get("lic_lista", null);
  if (online()) {
    const h = hoy();
    const { data, error } = await sb.from("clientes").select("id,nombre,grupo,inicio,fin,licencia_path,licencia_paginas")
      .not("licencia_path", "is", null).lte("inicio", sumaDias(h, 2)).gte("fin", sumaDias(h, -2)).order("grupo").order("nombre");
    if (!error && data) { lista = data; store.set("lic_lista", data); guardarLicenciasOffline(data); }
  }
  if (!ul) return;
  if (!lista) { ul.innerHTML = `<li class="empty">Abrí esta pestaña con señal una vez para guardarlas.</li>`; return; }
  if (!lista.length) { ul.innerHTML = `<li class="empty">No hay licencias cargadas para estos días.</li>`; return; }
  const guardadas = new Set(await idb.keys("lic"));
  ul.innerHTML = lista.map(c => {
    const ok = guardadas.has(c.licencia_path + "/p1.jpg");
    return `<li><div><b>${esc(c.nombre)}</b><span class="meta">${esc(c.grupo || "")} · ${fDM(c.inicio)} al ${fDM(c.fin)}</span>
      <span class="estado ${ok ? "si" : "no"}" style="display:block">${ok ? "Guardada en el teléfono" : "Sin guardar todavía"}</span></div>
      <button class="btn small" data-ver="${c.id}">Ver</button></li>`;
  }).join("");
  ul.onclick = e => { const b = e.target.closest("[data-ver]"); if (b) abrirVisor(lista.find(c => c.id === b.dataset.ver)); };
}

async function guardarLicenciasOffline(lista) {
  const guardadas = new Set(await idb.keys("lic"));
  const necesarias = new Set();
  for (const c of lista) for (let i = 1; i <= (c.licencia_paginas || 1); i++) {
    const k = `${c.licencia_path}/p${i}.jpg`; necesarias.add(k);
    if (!guardadas.has(k)) {
      const { data } = await sb.storage.from("licencias").download(k);
      if (data) await idb.put("lic", k, data);
    }
  }
  for (const k of guardadas) if (!necesarias.has(k)) await idb.del("lic", k);   // libera espacio
  if (tabActual === "licencias" && $("#lic-ver")) {
    const g = new Set(await idb.keys("lic"));
    document.querySelectorAll("#lic-ver [data-ver]").forEach(b => {
      const c = lista.find(x => x.id === b.dataset.ver); const st = b.parentElement.querySelector(".estado");
      if (c && st && g.has(c.licencia_path + "/p1.jpg")) { st.className = "estado si"; st.textContent = "Guardada en el teléfono"; }
    });
  }
}

async function abrirVisor(c) {
  $("#visor-tit").textContent = c.nombre;
  const pags = $("#visor-pags"); pags.innerHTML = "";
  $("#visor").hidden = false; document.body.style.overflow = "hidden";
  for (let i = 1; i <= (c.licencia_paginas || 1); i++) {
    const k = `${c.licencia_path}/p${i}.jpg`;
    let b = await idb.get("lic", k);
    if (!b && online()) { const { data } = await sb.storage.from("licencias").download(k); if (data) { b = data; await idb.put("lic", k, data); } }
    if (b) { const img = new Image(); img.alt = `Licencia de ${c.nombre}, página ${i}`; img.src = URL.createObjectURL(b); pags.appendChild(img); }
    else pags.insertAdjacentHTML("beforeend", `<p style="color:#fff;padding:16px">Esta página no está guardada. Abrila una vez con señal.</p>`);
  }
}
function cerrarVisor() { $("#visor").hidden = true; document.body.style.overflow = ""; $("#visor-pags").innerHTML = ""; }

let clientesAdm = [];
let clienteParaCargar = null;
async function prepararGestionLicencias() {
  const ul = $("#lic-adm");
  if (!online()) { ul.innerHTML = `<li class="empty">Para cargar licencias hace falta señal.</li>`; return; }
  const { data, error } = await sb.from("clientes").select("id,nombre,grupo,inicio,fin,licencia_path,origen")
    .gte("fin", sumaDias(hoy(), -7)).order("inicio").order("grupo").order("nombre").limit(300);
  if (error) { ul.innerHTML = `<li class="empty">No se pudieron leer los clientes: ${esc(error.message)}</li>`; return; }
  clientesAdm = data;
  const pintar = () => {
    const q = $("#lic-buscar").value.trim().toLowerCase();
    const fs = clientesAdm.filter(c => !q || (c.nombre + " " + (c.grupo || "")).toLowerCase().includes(q));
    ul.innerHTML = fs.length ? fs.map(c => `<li><div><b>${esc(c.nombre)}</b><span class="meta">${esc(c.grupo || "")} · ${c.inicio ? fDM(c.inicio) : "?"} al ${c.fin ? fDM(c.fin) : "?"}</span>
      <span class="estado ${c.licencia_path ? "si" : "no"}" style="display:block">${c.licencia_path ? "Licencia cargada" : "Falta la licencia"}</span></div>
      <button class="btn small ${c.licencia_path ? "secondary" : ""}" data-cargar="${c.id}">${c.licencia_path ? "Cambiar" : "Cargar"}</button></li>`).join("")
      : `<li class="empty">${clientesAdm.length ? "Ningún cliente coincide." : "Todavía no hay clientes. Se importan del chart o podés agregarlos a mano."}</li>`;
  };
  pintar();
  $("#lic-buscar").oninput = pintar;
  ul.onclick = e => { const b = e.target.closest("[data-cargar]"); if (!b) return; clienteParaCargar = clientesAdm.find(c => c.id === b.dataset.cargar); $("#lic-file").click(); };
  $("#lic-file").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !clienteParaCargar) return;
    await subirLicencia(clienteParaCargar, f); prepararGestionLicencias(); pintarLicenciasVer();
  };
  $("#cli-nuevo").onclick = () => { $("#cli-form").hidden = !$("#cli-form").hidden; };
  $("#cn-ok").onclick = async () => {
    const c = { nombre: $("#cn-nombre").value.trim(), grupo: $("#cn-grupo").value.trim() || null, inicio: $("#cn-ini").value || null, fin: $("#cn-fin").value || null, origen: "manual" };
    if (!c.nombre || !c.inicio || !c.fin) return toast("Completá nombre, llegada y salida.");
    const { error } = await sb.from("clientes").insert(c);
    if (error) return toast("No se pudo guardar: " + error.message);
    toast("Cliente agregado."); ["#cn-nombre", "#cn-grupo", "#cn-ini", "#cn-fin"].forEach(s => $(s).value = ""); $("#cli-form").hidden = true;
    prepararGestionLicencias();
  };
}

async function subirLicencia(cliente, file) {
  toast("Procesando la licencia…", 4000);
  try {
    const paginas = file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? await pdfAImagenes(file) : [await comprimir(file, 2000, 0.88)];
    if (!paginas.length) throw new Error("El archivo no tiene páginas.");
    const carpeta = `${cliente.id}/${Date.now()}`;
    for (let i = 0; i < paginas.length; i++) {
      const { error } = await sb.storage.from("licencias").upload(`${carpeta}/p${i + 1}.jpg`, paginas[i], { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
    }
    const ext = /\.pdf$/i.test(file.name) || file.type === "application/pdf" ? "pdf" : "jpg";
    await sb.storage.from("licencias").upload(`${carpeta}/original.${ext}`, file, { contentType: file.type || undefined, upsert: true });
    const { error } = await sb.from("clientes").update({ licencia_path: carpeta, licencia_paginas: paginas.length }).eq("id", cliente.id);
    if (error) throw error;
    toast(`Licencia de ${cliente.nombre} cargada (${paginas.length} pág.).`);
  } catch (e) { toast("No se pudo cargar: " + (e.message || e), 5000); }
}

/* =====================================================================
   EQUIPO (jefe y administrador)
   ===================================================================== */
async function verEquipo() {
  const admin = perfil.rol === "admin";
  main.innerHTML = `
  <div class="card"><h2>Guías</h2>
    <ul class="list" id="eq-guias"><li class="empty">Cargando…</li></ul>
    <label for="g-nombre">Nuevo guía</label><input id="g-nombre" placeholder="Nombre (ej.: Pablo)">
    <label for="g-chart">Cómo figura en Chart Guias</label><input id="g-chart" placeholder="Ej.: PABLO" style="text-transform:uppercase">
    <button class="btn" id="g-ok">Agregar guía</button>
  </div>
  ${admin ? `<div class="card"><h2>Usuarios</h2><p class="hint" style="margin-top:0">Cada persona crea su cuenta en la app. Acá le asignás el rol y, si es guía, quién es.</p>
    <ul class="list" id="eq-users"><li class="empty">Cargando…</li></ul></div>` : ""}`;
  if (!online()) { main.insertAdjacentHTML("afterbegin", `<div class="offline">Para editar el equipo hace falta señal.</div>`); return; }
  const { data: guias } = await sb.from("guias").select("id,nombre,nombre_chart,activo").order("nombre");
  const gs = guias || [];
  $("#eq-guias").innerHTML = gs.length ? gs.map(g => `<li><div><b>${esc(g.nombre)}</b><span class="meta">En el chart: ${esc(g.nombre_chart)}</span></div>
    <button class="btn small secondary" data-act="${g.id}">${g.activo ? "Activo" : "Inactivo"}</button></li>`).join("") : `<li class="empty">Todavía no hay guías.</li>`;
  $("#eq-guias").onclick = async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const g = gs.find(x => x.id === b.dataset.act);
    const { error } = await sb.from("guias").update({ activo: !g.activo }).eq("id", g.id);
    if (error) return toast(error.message); verEquipo();
  };
  $("#g-ok").onclick = async () => {
    const nombre = $("#g-nombre").value.trim(), chart = $("#g-chart").value.trim().toUpperCase();
    if (!nombre || !chart) return toast("Completá el nombre y cómo figura en el chart.");
    const { error } = await sb.from("guias").insert({ nombre, nombre_chart: chart });
    if (error) return toast(/duplicate/i.test(error.message) ? "Ya hay un guía con ese nombre en el chart." : error.message);
    toast("Guía agregado."); verEquipo();
  };
  if (!admin) return;
  const { data: us, error } = await sb.from("perfiles").select("id,email,nombre,rol,guia_id").order("creado", { ascending: false });
  if (error) { $("#eq-users").innerHTML = `<li class="empty">${esc(error.message)}</li>`; return; }
  const ROLES = [["pendiente", "Sin habilitar"], ["guia", "Guía"], ["jefe", "Jefe de guías"], ["house_manager", "House manager"], ["admin", "Administrador"]];
  $("#eq-users").innerHTML = us.map(u => `<li style="display:block" data-u="${u.id}">
    <b>${esc(u.nombre || u.email)}</b><span class="meta">${esc(u.email)}</span>
    <div class="row" style="margin-top:8px">
      <select data-f="rol" aria-label="Rol">${ROLES.map(([v, n]) => `<option value="${v}" ${u.rol === v ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select data-f="guia_id" aria-label="Guía">${[`<option value="">No es guía</option>`, ...gs.map(g => `<option value="${g.id}" ${u.guia_id === g.id ? "selected" : ""}>${esc(g.nombre)}</option>`)].join("")}</select>
    </div></li>`).join("");
  $("#eq-users").onchange = async e => {
    const li = e.target.closest("[data-u]"); const f = e.target.dataset.f; if (!li || !f) return;
    const val = e.target.value || null;
    if (li.dataset.u === perfil.id && f === "rol" && val !== "admin" && !confirm("Te vas a quitar el rol de administrador. ¿Seguro?")) { e.target.value = "admin"; return; }
    const { error } = await sb.from("perfiles").update({ [f]: val }).eq("id", li.dataset.u);
    toast(error ? "No se pudo guardar: " + error.message : "Guardado.");
    if (!error && li.dataset.u === perfil.id) cargarPerfil({ id: perfil.id });
  };
}

iniciar();
