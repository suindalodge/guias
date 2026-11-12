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
  if (perfil.guia_id) t.push(["capturas", "Capturas"], ["entregas", "Entregas"], ["dias", "Días"]);
  else if (r === "admin" || r === "jefe") t.push(["capturas", "Capturas"]);
  t.push(["licencias", "Licencias"]);
  if (["admin", "jefe", "house_manager"].includes(r)) t.push(["cuentas", "Cuentas"]);
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
  document.querySelectorAll("#tabs-in button").forEach(b => {
    b.setAttribute("aria-selected", b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  window.scrollTo(0, 0);
  ({ capturas: verCapturas, entregas: verEntregas, dias: verDias, licencias: verLicencias, cuentas: verCuentas, equipo: verEquipo })[tab]();
}
window.addEventListener("hashchange", () => {
  const t = location.hash.replace("#", "");
  if (perfil && t !== tabActual && document.querySelector(`#tabs-in [data-tab="${t}"]`)) irA(t);
});

/* =====================================================================
   CAPTURAS
   ===================================================================== */
let borr = null; // borrador de la planilla del día
const borrNuevo = () => ({ fecha: hoy(), peces: [], fotos: [] });
const pezNuevo = (lugar = "") => ({ especie: "", otra: "", arte: "", peso: "", hora: horaStr(), lugar, notas: "" });
const guardarBorr = () => store.set("borrador", borr);

const esJefe = () => perfil && (perfil.rol === "admin" || perfil.rol === "jefe");
const selectorCaptura = modo => esJefe() && perfil.guia_id ? `<div class="seg" role="tablist">
  <button data-modo="cargar" aria-selected="${modo === "cargar"}">Cargar</button>
  <button data-modo="resumen" aria-selected="${modo === "resumen"}">Resumen del equipo</button></div>` : "";
function activarSelector() {
  const sg = main.querySelector(".seg"); if (!sg) return;
  sg.onclick = e => { const b = e.target.closest("[data-modo]"); if (!b) return; store.set("cap_modo", b.dataset.modo); verCapturas(); };
}
function verCapturas() {
  if (esJefe() && (!perfil.guia_id || store.get("cap_modo", "cargar") === "resumen")) return verResumen();
  borr = store.get("borrador", null) || borrNuevo();
  const lugares = store.get("lugares", []);
  main.innerHTML = selectorCaptura("cargar") + `
  <div class="card">
    <h2>Planilla del día</h2>
    <label for="c-fecha">Fecha</label><input id="c-fecha" type="date" value="${esc(borr.fecha)}">
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
  $("#add-pez").onclick = () => {   // el pez nuevo arranca con el lugar del anterior (se puede cambiar)
    const ant = borr.peces[borr.peces.length - 1];
    borr.peces.push(pezNuevo(ant ? ant.lugar : "")); guardarBorr(); pintarPeces();
  };
  $("#f-cam").onchange = e => sumarFotos(e.target);
  $("#f-gal").onchange = e => sumarFotos(e.target);
  $("#c-enviar").onclick = enviarPlanilla;
  activarSelector();
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
    <label>Lugar</label><input data-f="lugar" list="dl-lugares" value="${esc(p.lugar)}" placeholder="Ej.: Isla Pelada">
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
    planilla: { id: planillaId, guia_id: perfil.guia_id, fecha: borr.fecha, lugar: null },
    capturas: borr.peces.map(p => ({
      id: uid(), planilla_id: planillaId, guia_id: perfil.guia_id, fecha: borr.fecha,
      hora: p.hora || null,
      especie: p.especie === "Otra" ? p.otra.trim() : p.especie,
      arte: p.arte || null,
      peso_kg: p.peso ? Number(String(p.peso).replace(",", ".")) : null,
      lugar: (p.lugar || "").trim() || null,
      notas: (p.notas || "").trim() || null
    })),
    fotos: borr.fotos.map(id => ({ id, subida: false })),
    lugares: [...new Set(borr.peces.map(p => (p.lugar || "").trim()).filter(Boolean))]
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
      for (const k of ["enviadas", "entregas_hist"]) { const h = store.get(k, []); const x = h.find(y => y.id === it.id); if (x) { x.estado = "ok"; store.set(k, h); } }
    } catch (e) { errores++; console.error(e); }
  }
  enviando = false;
  const quedan = (await idb.keys("cola")).length;
  pintarCola(quedan);
  if (tabActual === "capturas") pintarEnviadas();
  if (tabActual === "entregas") pintarEntregasHist();
  if (manual || (items.length && !quedan)) toast(quedan ? `No se pudo enviar (${quedan} pendiente${quedan > 1 ? "s" : ""}). Se reintenta solo.` : "Todo enviado.");
}
async function enviarItem(it) {
  if (it.tipo === "entrega") {
    const r = await sb.from("entregas").upsert(it.filas, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw r.error;
    return;
  }
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
  $("#cola-txt").textContent = n === 1 ? "1 carga sin enviar" : `${n} cargas sin enviar`;
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
    <p class="hint">Según el chart del lodge${at ? ` · actualizado ${new Date(at).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""} · La línea dorada marca el inicio de cada bloque.</p></div>`;
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
function abrirVisorFotos(titulo, urls, inicio = 0) {
  $("#visor-tit").textContent = titulo;
  const pags = $("#visor-pags"); pags.innerHTML = "";
  $("#visor").hidden = false; document.body.style.overflow = "hidden";
  urls.forEach((u, i) => { const img = new Image(); img.alt = `Foto ${i + 1}`; img.src = u.url; pags.appendChild(img);
    if (u.pie) pags.insertAdjacentHTML("beforeend", `<p style="color:#fff;margin:-4px 14px 14px;font-size:.9rem">${esc(u.pie)}</p>`); });
  setTimeout(() => { const im = pags.querySelectorAll("img")[inicio]; if (im) im.scrollIntoView(); }, 50);
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
  <div class="card"><h2>Chart del lodge</h2>
    <p class="hint" style="margin-top:0" id="ch-ult">Los turnos y los clientes se actualizan solos cada hora.</p>
    <button class="btn" id="ch-ok">Actualizar desde el chart</button>
    <div id="ch-res"></div>
    ${admin ? `<details class="conf"><summary>Configurar la conexión</summary>
      <label for="ch-url">Link del puente (aplicación web del chart)</label>
      <input id="ch-url" placeholder="https://script.google.com/macros/s/…/exec">
      <p class="hint">Se pega una sola vez. Sale de Apps Script del chart → Implementar → Aplicación web.</p></details>` : ""}
  </div>
  <div class="card"><h2>Guías</h2>
    <ul class="list" id="eq-guias"><li class="empty">Cargando…</li></ul>
    <button class="btn secondary" id="inv-gen">Invitar a alguien por WhatsApp</button>
    <label for="g-nombre">Nuevo guía</label><input id="g-nombre" placeholder="Nombre (ej.: Pablo)">
    <label for="g-chart">Cómo figura en Chart Guias</label><input id="g-chart" placeholder="Ej.: PABLO" style="text-transform:uppercase">
    <button class="btn" id="g-ok">Agregar guía</button>
  </div>
  <div class="card"><h2>Artículos</h2>
    <p class="hint" style="margin-top:0">Lo que los guías entregan a los clientes. El precio lo ven solo el jefe de guías y el house manager. Si cambiás un precio, las entregas anteriores mantienen el suyo.</p>
    <div id="eq-arts"><p class="empty">Cargando…</p></div>
    <label for="a-nombre">Nuevo artículo</label><input id="a-nombre" placeholder="Ej.: Poppers">
    <div class="row"><div><label for="a-precio">Precio</label><input id="a-precio" inputmode="decimal" placeholder="0"></div>
      <div><label for="a-moneda">Moneda</label><select id="a-moneda"><option value="USD">Dólares</option><option value="ARS">Pesos</option></select></div></div>
    <button class="btn" id="a-ok">Agregar artículo</button>
  </div>
  ${admin ? `<div class="card"><h2>Usuarios</h2><p class="hint" style="margin-top:0">Cada persona crea su cuenta en la app. Acá le asignás el rol y, si es guía, quién es.</p>
    <ul class="list" id="eq-users"><li class="empty">Cargando…</li></ul></div>` : ""}`;
  if (!online()) { main.insertAdjacentHTML("afterbegin", `<div class="offline">Para editar el equipo hace falta señal.</div>`); return; }
  pintarArticulosEquipo();
  prepararChart(admin);
  $("#inv-gen").onclick = () => invitar("");

  const [{ data: guias }, rus] = await Promise.all([
    sb.from("guias").select("id,nombre,nombre_chart,activo").order("nombre"),
    admin ? sb.from("perfiles").select("id,email,nombre,rol,guia_id").order("creado", { ascending: false }) : Promise.resolve({ data: null })
  ]);
  const gs = guias || [], us = rus.data;
  const conCuenta = new Set((us || []).map(u => u.guia_id).filter(Boolean));
  $("#eq-guias").innerHTML = gs.length ? gs.map(g => `<li><div><b>${esc(g.nombre)}</b><span class="meta">En el chart: ${esc(g.nombre_chart)}${us ? (conCuenta.has(g.id) ? " · tiene cuenta" : " · sin cuenta") : ""}</span></div>
    <span class="acciones">${us && !conCuenta.has(g.id) && g.activo ? `<button class="btn small" data-inv="${g.id}">Invitar</button>` : ""}
    <button class="btn small secondary" data-act="${g.id}">${g.activo ? "Activo" : "Inactivo"}</button></span></li>`).join("") : `<li class="empty">Todavía no hay guías.</li>`;
  $("#eq-guias").onclick = async e => {
    const inv = e.target.closest("[data-inv]");
    if (inv) return invitar(gs.find(x => x.id === inv.dataset.inv).nombre);
    const b = e.target.closest("[data-act]"); if (!b) return;
    const g = gs.find(x => x.id === b.dataset.act);
    const { error } = await sb.from("guias").update({ activo: !g.activo }).eq("id", g.id);
    if (error) return toast(error.message); verEquipo();
  };
  $("#g-ok").onclick = async () => {
    const nombre = $("#g-nombre").value.trim(), chart = normChart($("#g-chart").value);
    if (!nombre || !chart) return toast("Completá el nombre y cómo figura en el chart.");
    const { error } = await sb.from("guias").insert({ nombre, nombre_chart: chart });
    if (error) return toast(/duplicate/i.test(error.message) ? "Ya hay un guía con ese nombre en el chart." : error.message);
    toast("Guía agregado."); verEquipo();
  };
  if (!admin) return;
  if (!us) { $("#eq-users").innerHTML = `<li class="empty">${esc(rus.error ? rus.error.message : "No se pudieron leer los usuarios.")}</li>`; return; }
  const ROLES = [["pendiente", "Sin habilitar"], ["guia", "Guía"], ["admin", "Jefe de guías"], ["house_manager", "House manager"]];
  $("#eq-users").innerHTML = us.map(u => `<li style="display:block" data-u="${u.id}">
    <b>${esc(u.nombre || u.email)}</b><span class="meta">${esc(u.email)}</span>
    <div class="row" style="margin-top:8px">
      <select data-f="rol" aria-label="Rol">${ROLES.map(([v, n]) => `<option value="${v}" ${(u.rol === "jefe" ? "admin" : u.rol) === v ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select data-f="guia_id" aria-label="Guía">${[`<option value="">No es guía</option>`, ...gs.map(g => `<option value="${g.id}" ${u.guia_id === g.id ? "selected" : ""}>${esc(g.nombre)}</option>`)].join("")}</select>
    </div></li>`).join("");
  $("#eq-users").onchange = async e => {
    const li = e.target.closest("[data-u]"); const f = e.target.dataset.f; if (!li || !f) return;
    const val = e.target.value || null;
    if (li.dataset.u === perfil.id && f === "rol" && val !== "admin" && !confirm("Te vas a quitar el perfil de jefe de guías y ya no vas a poder habilitar cuentas. ¿Seguro?")) { e.target.value = "admin"; return; }
    const { error } = await sb.from("perfiles").update({ [f]: val }).eq("id", li.dataset.u);
    toast(error ? "No se pudo guardar: " + error.message : "Guardado.");
    if (!error && li.dataset.u === perfil.id) cargarPerfil({ id: perfil.id });
    if (!error && f === "guia_id") verEquipo();
  };
}
const normChart = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

function invitar(nombre) {
  const link = location.origin + location.pathname;
  const t = `Hola${nombre ? " " + nombre : ""}! Te paso la app de guías de Suindá para cargar capturas, entregas y ver tus días:\n${link}\n\n` +
    `1. Abrila y tocá «Crear una cuenta nueva» con tu mail y una contraseña.\n` +
    `2. Avisame cuando la tengas, así te habilito.\n` +
    `3. Instalala en el celu: en Chrome, menú ⋮ → «Agregar a la pantalla principal». En iPhone, Safari → Compartir → «Agregar a inicio».`;
  window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank");
}

async function prepararChart(admin) {
  const { data } = await sb.from("config").select("clave,valor").in("clave", ["puente_url", "ultima_importacion"]);
  const conf = Object.fromEntries((data || []).map(x => [x.clave, x.valor]));
  const ult = $("#ch-ult"); if (!ult) return;
  if (conf.ultima_importacion) ult.textContent = "Última actualización: " + new Date(conf.ultima_importacion).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) + ". Se actualiza sola cada hora.";
  const inp = $("#ch-url");
  if (inp) {
    inp.value = conf.puente_url || "";
    if (!conf.puente_url) inp.closest("details").open = true;
    inp.onchange = async () => {
      const v = inp.value.trim();
      if (v && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(v)) return toast("El link tiene que empezar con https://script.google.com y terminar en /exec");
      const { error } = await sb.from("config").upsert({ clave: "puente_url", valor: v });
      toast(error ? "No se pudo guardar: " + error.message : "Link guardado."); conf.puente_url = v;
    };
  }
  $("#ch-ok").onclick = async () => {
    const url = conf.puente_url;
    if (!url) return toast(admin ? "Primero pegá el link del puente en «Configurar la conexión»." : "Falta configurar la conexión con el chart.");
    const btn = $("#ch-ok"); btn.disabled = true; btn.textContent = "Actualizando… (puede tardar unos segundos)";
    try {
      const r = await (await fetch(url + "?t=" + Date.now())).json();
      if (!r.ok) throw new Error(r.error || "error desconocido");
      const sin = (r.nombres_sin_guia || []).filter(n => !/^\?+$/.test(n));
      const hayIncognita = (r.nombres_sin_guia || []).some(n => /^\?+$/.test(n));
      $("#ch-res").innerHTML = `<div class="ch-res"><p class="okmsg">Chart actualizado.</p>
        <p class="meta">Clientes nuevos: ${r.clientes_nuevos} · actualizados: ${r.clientes_actualizados} · quitados: ${r.clientes_quitados}. Turnos de guías: ${r.turnos}.</p>
        ${hayIncognita ? `<p class="err">Hay turnos con «???» en Chart Guias: no se cuentan para nadie hasta que los completes.</p>` : ""}
        ${sin.length ? `<p class="lbl">Nombres de Chart Guias que no son guías de la app:</p>
          <ul class="list">${sin.map(n => `<li><b>${esc(n)}</b><button class="btn small" data-nuevo="${esc(n)}">Agregar como guía</button></li>`).join("")}</ul>
          <p class="hint">Si es un error de tipeo en el chart, corregilo ahí y volvé a actualizar.</p>` : ""}</div>`;
      $("#ch-res").onclick = async e => {
        const b = e.target.closest("[data-nuevo]"); if (!b) return;
        const n = b.dataset.nuevo; const nombre = n.charAt(0) + n.slice(1).toLowerCase();
        const { error } = await sb.from("guias").insert({ nombre, nombre_chart: normChart(n) });
        if (error) return toast(error.message);
        toast(`${nombre} agregado.`); b.closest("li").remove(); verEquipoGuiasSolo();
      };
      prepararChart(admin);
    } catch (e) {
      toast("No se pudo actualizar: " + (e.message || e), 5000);
    } finally { btn.disabled = false; btn.textContent = "Actualizar desde el chart"; }
  };
}
async function verEquipoGuiasSolo() {   // refresca la lista sin perder el resultado del chart
  const res = $("#ch-res") ? $("#ch-res").innerHTML : "";
  await verEquipo(); if ($("#ch-res")) $("#ch-res").innerHTML = res;
}

/* =====================================================================
   ENTREGAS (guías)
   ===================================================================== */
const plata = (m, n) => (m === "ARS" ? "$ " : "USD ") + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });

async function refrescarArticulos() {
  if (!online()) return store.get("articulos", []);
  const { data } = await sb.from("articulos").select("id,nombre,orden,activo").order("orden").order("nombre");
  if (data) store.set("articulos", data);
  return data || store.get("articulos", []);
}
async function refrescarClientesCache() {
  if (!online()) return store.get("clientes_cache", []);
  const h = hoy();
  const { data } = await sb.from("clientes").select("id,nombre,grupo,inicio,fin")
    .lte("inicio", sumaDias(h, 3)).gte("fin", sumaDias(h, -3)).order("grupo").order("nombre");
  if (data) store.set("clientes_cache", data);
  return data || store.get("clientes_cache", []);
}

let entCant = {};
async function verEntregas() {
  main.innerHTML = `
  <div class="card"><h2>Entrega a un cliente</h2>
    <label for="e-fecha">Fecha</label><input id="e-fecha" type="date" value="${hoy()}">
    <label for="e-cli">Cliente</label><select id="e-cli"><option value="">Cargando…</option></select>
    <label>Qué le diste</label><div id="e-arts"></div>
    <p class="err" id="e-err" hidden></p>
    <button class="btn" id="e-ok">Guardar entrega</button>
  </div>
  <div class="card"><h3>Cargadas desde este teléfono</h3><ul class="list" id="e-hist"></ul></div>`;
  entCant = {};
  const [arts, clis] = await Promise.all([refrescarArticulos(), refrescarClientesCache()]);
  if (tabActual !== "entregas") return;
  const pintarClientes = () => {
    const f = $("#e-fecha").value || hoy();
    const lista = clis.filter(c => c.inicio <= sumaDias(f, 1) && c.fin >= sumaDias(f, -1));
    const grupos = {};
    lista.forEach(c => (grupos[c.grupo || "Sin grupo"] ||= []).push(c));
    $("#e-cli").innerHTML = lista.length
      ? `<option value="">Elegí el cliente</option>` + Object.entries(grupos).map(([g, cs]) =>
          `<optgroup label="${esc(g)}">${cs.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</optgroup>`).join("")
      : `<option value="">No hay clientes en el lodge para esa fecha</option>`;
  };
  pintarClientes();
  $("#e-fecha").onchange = pintarClientes;
  const activos = arts.filter(a => a.activo);
  const pintarArts = () => {
    $("#e-arts").innerHTML = activos.length ? activos.map(a => `
      <div class="paso"><span>${esc(a.nombre)}</span>
        <div class="stepper"><button data-a="${a.id}" data-d="-1" aria-label="Menos">−</button><b>${entCant[a.id] || 0}</b><button data-a="${a.id}" data-d="1" aria-label="Más">+</button></div>
      </div>`).join("") : `<p class="hint">No hay artículos cargados. El jefe de guías los agrega en Equipo.</p>`;
  };
  pintarArts();
  $("#e-arts").onclick = e => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    entCant[b.dataset.a] = Math.max(0, (entCant[b.dataset.a] || 0) + Number(b.dataset.d)); pintarArts();
  };
  $("#e-ok").onclick = async () => {
    const err = $("#e-err"); err.hidden = true;
    const cli = $("#e-cli").value, fecha = $("#e-fecha").value;
    const filas = activos.filter(a => entCant[a.id] > 0).map(a => ({
      id: uid(), guia_id: perfil.guia_id, cliente_id: cli, fecha, articulo_id: a.id, insumo: a.nombre, cantidad: entCant[a.id] }));
    if (!cli) { err.textContent = "Elegí el cliente."; err.hidden = false; return; }
    if (!filas.length) { err.textContent = "Marcá al menos un artículo."; err.hidden = false; return; }
    const id = uid();
    await idb.put("cola", id, { id, tipo: "entrega", creado: Date.now(), filas });
    const c = clis.find(x => x.id === cli);
    const h = store.get("entregas_hist", []);
    h.unshift({ id, fecha, cliente: c ? c.nombre : "", detalle: filas.map(f => f.cantidad + " " + f.insumo).join(", "), estado: "espera" });
    store.set("entregas_hist", h.slice(0, 30));
    toast(online() ? "Guardando…" : "Guardada. Se envía sola al volver la señal.");
    entCant = {}; pintarArts(); $("#e-cli").value = "";
    pintarEntregasHist(); procesarCola();
  };
  pintarEntregasHist();
}
function pintarEntregasHist() {
  const ul = $("#e-hist"); if (!ul) return;
  const h = store.get("entregas_hist", []);
  ul.innerHTML = h.length ? h.slice(0, 15).map(x => `<li><div><b>${esc(x.cliente)}</b><span class="meta">${fCorta(x.fecha)} · ${esc(x.detalle)}</span></div>
    <span class="estado ${x.estado === "ok" ? "si" : "no"}">${x.estado === "ok" ? "Enviada" : "Esperando señal"}</span></li>`).join("")
    : `<li class="empty">Todavía no cargaste entregas desde este teléfono.</li>`;
}

/* =====================================================================
   CUENTAS (jefe de guías y house manager)
   ===================================================================== */
let ctaClientes = [], ctaEntregas = [], ctaSel = new Set();
async function verCuentas() {
  main.innerHTML = `<p class="loading">Cargando cuentas…</p>`;
  if (!online()) { main.innerHTML = `<div class="card"><p class="empty">Para ver las cuentas hace falta señal.</p></div>`; return; }
  const desde = sumaDias(hoy(), -30);
  const [rc, re] = await Promise.all([
    sb.from("clientes").select("id,nombre,grupo,inicio,fin").gte("fin", desde).order("fin").order("grupo").order("nombre"),
    sb.from("entregas").select("id,cliente_id,fecha,insumo,cantidad,precio_unit,moneda,anulada,guias(nombre)").eq("anulada", false).gte("fecha", sumaDias(desde, -30)).order("fecha")
  ]);
  if (tabActual !== "cuentas") return;
  if (rc.error || re.error) { main.innerHTML = `<div class="card"><p class="err">${esc((rc.error || re.error).message)}</p></div>`; return; }
  ctaEntregas = re.data;
  const conEntregas = new Set(ctaEntregas.map(e => e.cliente_id));
  ctaClientes = rc.data.filter(c => conEntregas.has(c.id) || c.fin >= hoy());
  ctaSel = new Set([...ctaSel].filter(id => ctaClientes.some(c => c.id === id)));
  const grupos = [...new Set(ctaClientes.map(c => c.grupo).filter(Boolean))];
  main.innerHTML = `
  <div class="card"><h2>Cuentas de clientes</h2>
    <div class="chips" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr))">
      <button class="chip" data-atajo="hoy">Terminan hoy</button>
      ${grupos.map(g => `<button class="chip" data-atajo="g:${esc(g)}">${esc(g)}</button>`).join("")}
      <button class="chip" data-atajo="nada">Limpiar</button>
    </div>
    <ul class="list checks" id="cta-lista" style="margin-top:10px"></ul>
  </div>
  <div id="cta-detalle"></div>`;
  pintarCtaLista(); pintarCtaDetalle();
  main.querySelector(".chips").onclick = e => {
    const b = e.target.closest("[data-atajo]"); if (!b) return;
    const a = b.dataset.atajo;
    if (a === "nada") ctaSel.clear();
    else if (a === "hoy") ctaClientes.filter(c => c.fin === hoy()).forEach(c => ctaSel.add(c.id));
    else ctaClientes.filter(c => c.grupo === a.slice(2)).forEach(c => ctaSel.add(c.id));
    pintarCtaLista(); pintarCtaDetalle();
  };
  $("#cta-lista").onchange = e => {
    const id = e.target.dataset.c; if (!id) return;
    e.target.checked ? ctaSel.add(id) : ctaSel.delete(id); pintarCtaDetalle();
  };
}
function totalesDe(es) {
  const t = {}; es.forEach(e => { if (e.precio_unit != null) t[e.moneda || "USD"] = (t[e.moneda || "USD"] || 0) + e.cantidad * Number(e.precio_unit); });
  return t;
}
const textoTotales = t => Object.keys(t).length ? Object.entries(t).map(([m, n]) => plata(m, n)).join(" + ") : "Sin cargo";
function pintarCtaLista() {
  $("#cta-lista").innerHTML = ctaClientes.length ? ctaClientes.map(c => {
    const n = ctaEntregas.filter(e => e.cliente_id === c.id).length;
    return `<li><label class="check"><input type="checkbox" data-c="${c.id}" ${ctaSel.has(c.id) ? "checked" : ""}>
      <span><b>${esc(c.nombre)}</b><span class="meta">${esc(c.grupo || "")} · se va el ${fDM(c.fin)} · ${n ? n + (n === 1 ? " entrega" : " entregas") : "sin entregas"}</span></span></label></li>`;
  }).join("") : `<li class="empty">No hay clientes recientes.</li>`;
}
function pintarCtaDetalle() {
  const box = $("#cta-detalle"); if (!box) return;
  const sel = ctaClientes.filter(c => ctaSel.has(c.id));
  if (!sel.length) { box.innerHTML = ""; return; }
  const anula = perfil.rol === "admin" || perfil.rol === "jefe";
  const todas = [];
  const bloques = sel.map(c => {
    const es = ctaEntregas.filter(e => e.cliente_id === c.id); todas.push(...es);
    return `<div class="cta"><h3>${esc(c.nombre)} <span class="meta">${esc(c.grupo || "")}</span></h3>
      ${es.length ? `<ul class="list">${es.map(e => `<li><div><b>${e.cantidad} × ${esc(e.insumo)}</b>
        <span class="meta">${fCorta(e.fecha)}${e.guias ? " · " + esc(e.guias.nombre) : ""}${e.precio_unit != null ? " · " + plata(e.moneda, e.precio_unit) + " c/u" : ""}</span></div>
        <span class="monto">${e.precio_unit != null ? plata(e.moneda, e.cantidad * e.precio_unit) : "—"}${anula ? `<button class="x" data-anular="${e.id}" aria-label="Anular">Anular</button>` : ""}</span></li>`).join("")}</ul>`
        : `<p class="hint">Sin entregas.</p>`}
      <p class="total">Total: ${textoTotales(totalesDe(es))}</p></div>`;
  }).join("");
  box.innerHTML = `<div class="card"><h2>Detalle</h2>${bloques}
    ${sel.length > 1 ? `<p class="total grande">Total de los ${sel.length} clientes: ${textoTotales(totalesDe(todas))}</p>` : ""}
    <button class="btn" id="cta-wa">Enviar por WhatsApp</button></div>`;
  box.onclick = async e => {
    const b = e.target.closest("[data-anular]"); if (!b) return;
    if (!confirm("¿Anular esta entrega? Deja de sumarse en la cuenta.")) return;
    const { error } = await sb.from("entregas").update({ anulada: true }).eq("id", b.dataset.anular);
    if (error) return toast("No se pudo anular: " + error.message);
    ctaEntregas = ctaEntregas.filter(x => x.id !== b.dataset.anular); toast("Entrega anulada.");
    pintarCtaLista(); pintarCtaDetalle();
  };
  $("#cta-wa").onclick = () => {
    let t = "*Cuenta de artículos · Suindá*\n";
    sel.forEach(c => {
      const es = ctaEntregas.filter(e => e.cliente_id === c.id);
      t += `\n*${c.nombre}*${c.grupo ? " (" + c.grupo + ")" : ""}\n`;
      const agrup = {};
      es.forEach(e => { const k = e.insumo + "|" + (e.precio_unit ?? "") + "|" + (e.moneda || ""); (agrup[k] ||= { ...e, cantidad: 0 }).cantidad += e.cantidad; });
      Object.values(agrup).forEach(e => t += `• ${e.cantidad} × ${e.insumo}${e.precio_unit != null ? " — " + plata(e.moneda, e.cantidad * e.precio_unit) : ""}\n`);
      if (!es.length) t += "• Sin entregas\n";
      t += `Total: ${textoTotales(totalesDe(es))}\n`;
    });
    if (sel.length > 1) t += `\n*Total general: ${textoTotales(totalesDe(todas))}*`;
    window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank");
  };
}

/* ---------- Equipo: artículos y precios ---------- */
async function pintarArticulosEquipo() {
  const box = $("#eq-arts"); if (!box) return;
  const [ra, rp] = await Promise.all([
    sb.from("articulos").select("id,nombre,orden,activo").order("orden").order("nombre"),
    sb.from("articulo_precios").select("articulo_id,precio,moneda")
  ]);
  if (ra.error) { box.innerHTML = `<p class="err">${esc(ra.error.message)}</p>`; return; }
  const precios = Object.fromEntries((rp.data || []).map(p => [p.articulo_id, p]));
  const arts = ra.data;
  box.innerHTML = arts.length ? arts.map(a => {
    const p = precios[a.id] || { precio: 0, moneda: "USD" };
    return `<div class="art ${a.activo ? "" : "off"}" data-art="${a.id}">
      <input data-f="nombre" value="${esc(a.nombre)}" aria-label="Nombre">
      <div class="row3">
        <input data-f="precio" inputmode="decimal" value="${String(p.precio).replace(".", ",")}" aria-label="Precio">
        <select data-f="moneda" aria-label="Moneda"><option value="USD" ${p.moneda === "USD" ? "selected" : ""}>USD</option><option value="ARS" ${p.moneda === "ARS" ? "selected" : ""}>$</option></select>
        <button class="btn small secondary" data-act>${a.activo ? "Activo" : "Inactivo"}</button>
      </div></div>`;
  }).join("") : `<p class="empty">Todavía no hay artículos.</p>`;
  const guardar = async el => {
    const fila = el.closest("[data-art]"); const id = fila.dataset.art;
    const nombre = fila.querySelector('[data-f="nombre"]').value.trim();
    const precio = Number(fila.querySelector('[data-f="precio"]').value.replace(",", "."));
    const moneda = fila.querySelector('[data-f="moneda"]').value;
    if (!nombre) return toast("El nombre no puede quedar vacío.");
    if (isNaN(precio) || precio < 0) return toast("Revisá el precio.");
    const r1 = await sb.from("articulos").update({ nombre }).eq("id", id);
    const r2 = await sb.from("articulo_precios").upsert({ articulo_id: id, precio, moneda, actualizado: new Date().toISOString() });
    toast(r1.error || r2.error ? "No se pudo guardar: " + (r1.error || r2.error).message : "Guardado.");
  };
  box.onchange = e => { if (e.target.dataset.f) guardar(e.target); };
  box.onclick = async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = arts.find(x => x.id === b.closest("[data-art]").dataset.art);
    const { error } = await sb.from("articulos").update({ activo: !a.activo }).eq("id", a.id);
    if (error) return toast(error.message); pintarArticulosEquipo();
  };
  $("#a-ok").onclick = async () => {
    const nombre = $("#a-nombre").value.trim(), precio = Number(($("#a-precio").value || "0").replace(",", ".")), moneda = $("#a-moneda").value;
    if (!nombre) return toast("Escribí el nombre del artículo.");
    if (isNaN(precio) || precio < 0) return toast("Revisá el precio.");
    const orden = arts.reduce((m, a) => Math.max(m, a.orden || 0), 0) + 1;
    const { data, error } = await sb.from("articulos").insert({ nombre, orden }).select("id").single();
    if (error) return toast("No se pudo agregar: " + error.message);
    await sb.from("articulo_precios").upsert({ articulo_id: data.id, precio, moneda });
    $("#a-nombre").value = ""; $("#a-precio").value = ""; toast("Artículo agregado."); pintarArticulosEquipo();
  };
}

/* =====================================================================
   RESUMEN DE CAPTURAS (jefe de guías)
   ===================================================================== */
const kg = n => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
function rangoResumen(clave) {
  const h = hoy(), d = new Date(h + "T12:00:00");
  if (clave === "ayer") return [sumaDias(h, -1), sumaDias(h, -1)];
  if (clave === "semana") { const dow = (d.getDay() + 6) % 7; return [sumaDias(h, -dow), h]; }
  if (clave === "temporada") return [sumaDias(h, -365), h];
  return [h, h];
}
async function verResumen() {
  const conf = store.get("res_rango", { clave: "hoy" });
  let [desde, hasta] = conf.clave === "otro" ? [conf.desde, conf.hasta] : rangoResumen(conf.clave);
  main.innerHTML = selectorCaptura("resumen") + `
  <div class="card"><h2>Resumen de capturas</h2>
    <div class="chips cuatro" id="r-rango">
      ${[["hoy", "Hoy"], ["ayer", "Ayer"], ["semana", "Semana"], ["otro", "Fechas"]].map(([k, n]) =>
        `<button class="chip" data-r="${k}" aria-pressed="${conf.clave === k}">${n}</button>`).join("")}
    </div>
    <div class="row" id="r-fechas" ${conf.clave === "otro" ? "" : "hidden"}>
      <div><label for="r-desde">Desde</label><input id="r-desde" type="date" value="${desde}"></div>
      <div><label for="r-hasta">Hasta</label><input id="r-hasta" type="date" value="${hasta}"></div>
    </div>
  </div>
  <div id="r-cuerpo"><p class="loading">Cargando…</p></div>`;
  activarSelector();
  $("#r-rango").onclick = e => {
    const b = e.target.closest("[data-r]"); if (!b) return;
    const k = b.dataset.r;
    store.set("res_rango", k === "otro" ? { clave: "otro", desde, hasta } : { clave: k }); verResumen();
  };
  const cambiarFechas = () => { store.set("res_rango", { clave: "otro", desde: $("#r-desde").value, hasta: $("#r-hasta").value }); verResumen(); };
  $("#r-desde").onchange = cambiarFechas; $("#r-hasta").onchange = cambiarFechas;
  if (!online()) { $("#r-cuerpo").innerHTML = `<div class="card"><p class="empty">Para ver el resumen hace falta señal.</p></div>`; return; }
  if (desde > hasta) [desde, hasta] = [hasta, desde];

  const [rc, rf] = await Promise.all([
    sb.from("capturas").select("id,fecha,hora,especie,arte,peso_kg,lugar,notas,rio_dia,rio_anterior,fase_lunar,iluminacion,guias(nombre)")
      .gte("fecha", desde).lte("fecha", hasta).order("fecha").order("hora"),
    sb.from("fotos").select("id,fecha,path,guias(nombre)").gte("fecha", desde).lte("fecha", hasta).order("fecha")
  ]);
  if (tabActual !== "capturas") return;
  if (rc.error) { $("#r-cuerpo").innerHTML = `<div class="card"><p class="err">${esc(rc.error.message)}</p></div>`; return; }
  const caps = rc.data, fotos = rf.data || [];
  const titulo = desde === hasta ? fCorta(desde) : `del ${fDM(desde)} al ${fDM(hasta)}`;

  // Por especie
  const esp = {};
  caps.forEach(c => {
    const e = (esp[c.especie] ||= { n: 0, mosca: 0, spin: 0, pesos: [] });
    e.n++; if (c.arte === "Mosca") e.mosca++; if (c.arte === "Spinning") e.spin++;
    if (c.peso_kg != null) e.pesos.push(Number(c.peso_kg));
  });
  const orden = Object.entries(esp).sort((a, b) => b[1].n - a[1].n);
  const statsEsp = orden.map(([nombre, e]) => {
    const prom = e.pesos.length ? e.pesos.reduce((a, b) => a + b, 0) / e.pesos.length : null;
    const max = e.pesos.length ? Math.max(...e.pesos) : null;
    return { nombre, ...e, prom, max };
  });
  // Río y luna (del último día del rango con datos)
  const ult = [...caps].reverse().find(c => c.rio_dia != null || c.fase_lunar);
  const rioTxt = ult && ult.rio_dia != null ? `${kg(ult.rio_dia)} m${ult.rio_anterior != null ? ` (día anterior ${kg(ult.rio_anterior)} m)` : ""}` : "sin cargar";
  const lunaTxt = ult && ult.fase_lunar ? `${ult.fase_lunar} (${ult.iluminacion}%)` : "";

  const resumenHtml = caps.length ? `
    <p class="grande-num">${caps.length} <span>${caps.length === 1 ? "pieza" : "piezas"}</span></p>
    ${statsEsp.map(e => `<div class="esp"><h3>${esc(e.nombre)} <span>${e.n}</span></h3>
      <p class="meta">Mosca ${e.mosca} · Spinning ${e.spin}${e.pesos.length ? ` · promedio ${kg(e.prom)} kg · máximo ${kg(e.max)} kg` : ""}</p>
      ${e.pesos.length ? `<p class="pesos">${e.pesos.map(kg).join(" · ")} kg</p>` : ""}</div>`).join("")}
    <p class="hint">Río: ${rioTxt}${lunaTxt ? ` · Luna: ${esc(lunaTxt)}` : ""}</p>`
    : `<p class="empty">No hay capturas ${desde === hasta ? "ese día" : "en esas fechas"}.</p>`;

  // Detalle por día y guía
  const porDia = {};
  caps.forEach(c => { ((porDia[c.fecha] ||= {})[c.guias ? c.guias.nombre : "—"] ||= []).push(c); });
  const detalleHtml = Object.entries(porDia).reverse().map(([f, gs]) => `
    <div class="dia-det"><h3>${fCorta(f)}</h3>${Object.entries(gs).map(([g, cs]) => `
      <p class="guia-det">${esc(g)} · ${cs.length} ${cs.length === 1 ? "pieza" : "piezas"}</p>
      <ul class="list">${cs.map(c => `<li><div><b>${esc(c.especie)}${c.peso_kg != null ? " · " + kg(c.peso_kg) + " kg" : ""}</b>
        <span class="meta">${[c.hora ? c.hora.slice(0, 5) : "", c.arte, c.lugar].filter(Boolean).map(esc).join(" · ")}${c.notas ? " · " + esc(c.notas) : ""}</span></div></li>`).join("")}</ul>`).join("")}
    </div>`).join("");

  $("#r-cuerpo").innerHTML = `
    <div class="card"><h2>${esc(titulo)}</h2>${resumenHtml}</div>
    ${fotos.length ? `<div class="card"><h2>Fotos <span class="meta">${fotos.length}</span></h2><div class="fotos" id="r-fotos"></div></div>` : ""}
    ${caps.length ? `<div class="card"><h2>Detalle por guía</h2>${detalleHtml}</div>` : ""}`;



  if (fotos.length) {
    const { data: firmadas } = await sb.storage.from("fotos").createSignedUrls(fotos.map(f => f.path), 3600);
    const urls = (firmadas || []).map((x, i) => ({ url: x.signedUrl, pie: `${fCorta(fotos[i].fecha)} · ${fotos[i].guias ? fotos[i].guias.nombre : ""}` })).filter(x => x.url);
    const box = $("#r-fotos"); if (!box) return;
    box.innerHTML = urls.map((u, i) => `<div><img src="${u.url}" alt="Foto ${i + 1}" loading="lazy" data-i="${i}"></div>`).join("");
    box.onclick = e => { const im = e.target.closest("[data-i]"); if (im) abrirVisorFotos(`Fotos · ${titulo}`, urls, Number(im.dataset.i)); };
  }
}

iniciar();
