// Vérification du site dans un vrai navigateur (Chrome sans fenêtre), comme un visiteur.
//
//   node tests/navigateur/verifier.mjs http://127.0.0.1:5077 /chemin/vers/chrome
//
// Le serveur doit tourner avec ses réglages normaux (compte obligatoire pour télécharger) et une
// base JETABLE : le parcours crée un compte. Aucune dépendance : Node 22 parle directement à
// Chrome (protocole DevTools, par WebSocket).
//
// 1. Parcours complet : remplir un CV, voir l'aperçu, Télécharger -> créer un compte dans la
//    fenêtre -> le PDF arrive, puis le Word ; le document est dans « Mon espace ».
// 2. Chaque page, à 5 largeurs d'écran : rien ne dépasse sur le côté, aucune erreur JavaScript,
//    aucun fichier introuvable, bases d'accessibilité (textes alternatifs, champs nommés, un titre).
// Code de sortie 1 s'il y a un problème.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [ADRESSE = "http://127.0.0.1:5077", CHROME = "chrome"] = process.argv.slice(2);
const problemes = [];
const noter = (ou, quoi) => { problemes.push(`${ou} : ${quoi}`); console.log(`  ✗ [${ou}] ${quoi}`); };
const attendre = ms => new Promise(ok => setTimeout(ok, ms));

// ---------- Chrome et protocole DevTools ----------
const profil = mkdtempSync(join(tmpdir(), "cv-navigateur-"));
const telechargements = join(profil, "telechargements");
const chrome = spawn(CHROME, ["--headless", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profil}`,
  "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const adresseWs = await new Promise((ok, echec) => {
  let texte = "";
  chrome.stderr.on("data", d => { texte += d; const m = texte.match(/ws:\/\/\S+/); if (m) ok(m[0]); });
  setTimeout(() => echec(new Error("Chrome ne démarre pas")), 15000);
});
const ws = new WebSocket(adresseWs);
await new Promise(ok => ws.addEventListener("open", ok));
let numero = 0;
const enAttente = new Map(), ecouteurs = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && enAttente.has(m.id)) { const { ok, echec } = enAttente.get(m.id); enAttente.delete(m.id); m.error ? echec(new Error(m.error.message)) : ok(m.result); }
  else for (const f of ecouteurs) f(m);
});
const cdp = (method, params = {}, sessionId) => new Promise((ok, echec) => {
  const id = ++numero; enAttente.set(id, { ok, echec });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: telechargements, eventsEnabled: true });
const fichiersRecus = [];
ecouteurs.push(m => { if (m.method === "Browser.downloadWillBegin") fichiersRecus.push(m.params.suggestedFilename); });

async function nouvelOnglet(largeur = 1280, hauteur = 900, mobile = false) {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const o = { sessionId, erreurs: [], chargee: null };
  const c = (m, p) => cdp(m, p, sessionId);
  ecouteurs.push(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") o.erreurs.push("erreur JavaScript : " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split("\n")[0]);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") o.erreurs.push("console : " + m.params.entry.text + (m.params.entry.url ? ` (${m.params.entry.url})` : ""));
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && !/\/api\//.test(m.params.response.url))
      o.erreurs.push(`fichier introuvable (${m.params.response.status}) : ${m.params.response.url}`);
    if (m.method === "Page.loadEventFired" && o.chargee) o.chargee();
  });
  await Promise.all(["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"].map(x => c(x)));
  await c("Emulation.setDeviceMetricsOverride", { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile });
  if (mobile) await c("Emulation.setTouchEmulationEnabled", { enabled: true });
  o.aller = async chemin => { const fin = new Promise(ok => { o.chargee = ok; }); await c("Page.navigate", { url: ADRESSE + chemin }); await fin; await attendre(600); };
  o.js = async code => {
    const r = await c("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  o.jusqua = async (code, duree = 30000, quoi = code) => {
    for (const debut = Date.now(); Date.now() - debut < duree; await attendre(250)) if (await o.js(code)) return true;
    throw new Error("délai dépassé : " + quoi);
  };
  o.cliquer = async selecteur => {           // vrai clic de souris au centre de l'élément
    const p = await o.js(`(() => { const e = document.querySelector(${JSON.stringify(selecteur)}); if (!e) return null;
      e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!p) throw new Error("introuvable : " + selecteur);
    for (const type of ["mousePressed", "mouseReleased"]) await c("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
  };
  o.taper = async (selecteur, texte) => {    // saisie au clavier dans le champ
    await o.js(`document.querySelector(${JSON.stringify(selecteur)}).focus()`);
    await c("Input.insertText", { text: texte });
  };
  o.fermer = () => cdp("Target.closeTarget", { targetId });
  return o;
}

// ---------- 1. Parcours d'un visiteur ----------
async function parcours() {
  console.log("\nParcours : CV -> aperçu -> compte -> PDF -> Word -> Mon espace");
  const o = await nouvelOnglet(1280, 900);
  const ou = "parcours";
  try {
    await o.aller("/creer");
    await o.taper('[data-k="cv.nom"]', "Awa Essai");
    await o.taper('[data-k="cv.titre"]', "Assistante comptable");
    await o.jusqua(`document.querySelectorAll("#pages img").length > 0`, 45000, "l'aperçu s'affiche");
    console.log("  ✓ aperçu affiché");
    await o.jusqua(`!document.querySelector("#btn-telecharger").disabled`, 5000, "bouton Télécharger actif");
    await o.cliquer("#btn-telecharger");
    await o.jusqua(`document.querySelector("#dlg-compte").open && !document.querySelector("#compte-noms").hidden`, 5000,
                   "la fenêtre d'inscription s'ouvre");
    console.log("  ✓ Télécharger sans compte ouvre l'inscription");
    const email = `essai${Date.now()}@exemple.org`;
    for (const [sel, val] of [["#compte-prenom", "Awa"], ["#compte-nom", "Essai"], ["#compte-email", email],
                              ["#compte-mdp", "Mot-de-passe-42"], ["#compte-confirmation", "Mot-de-passe-42"]]) await o.taper(sel, val);
    await o.cliquer("#compte-valider");
    for (let i = 0; i < 120 && !fichiersRecus.some(f => f.endsWith(".pdf")); i++) await attendre(250);
    fichiersRecus.some(f => f === "CV_Awa_Essai.pdf") ? console.log("  ✓ inscription puis PDF reçu (CV_Awa_Essai.pdf)")
                                                       : noter(ou, `pas de PDF après l'inscription (reçus : ${fichiersRecus.join(", ") || "aucun"})`);
    const erreurCompte = await o.js(`document.querySelector("#compte-erreur").hidden ? "" : document.querySelector("#compte-erreur").textContent`);
    if (erreurCompte) noter(ou, "message d'erreur dans la fenêtre de compte : " + erreurCompte);
    await o.cliquer("#btn-word");
    for (let i = 0; i < 80 && !fichiersRecus.some(f => f.endsWith(".docx")); i++) await attendre(250);
    fichiersRecus.includes("CV_Awa_Essai.docx") ? console.log("  ✓ fichier Word reçu") : noter(ou, "pas de fichier Word");
    await attendre(1500);                       // la sauvegarde dans le compte part après une courte pause
    await o.aller("/compte");
    await o.jusqua(`document.querySelectorAll("#docs > *").length > 0`, 10000, "le document apparaît dans Mon espace")
      .then(() => console.log("  ✓ le CV est dans « Mon espace »"), e => noter(ou, e.message));
    const nonVides = readdirSync(telechargements).length;
    if (nonVides < 2) noter(ou, `fichiers réellement écrits sur le disque : ${nonVides}`);
  } catch (e) { noter(ou, e.message); }
  for (const e of o.erreurs) noter(ou, e);
  await o.fermer();
}

// ---------- 2. Chaque page, à plusieurs largeurs ----------
const PAGES = ["/", "/creer", "/creer?exemple=1", "/creer?type=plan", "/creer?type=arbre", "/creer?type=admin", "/compte",
               "/contact", "/cv-ats", "/modele-cv-afrique", "/plan-de-localisation", "/confidentialite", "/en/", "/en/creer",
               "/it/compte", "/page-qui-n-existe-pas"];
const LARGEURS = [[360, 740, true], [390, 844, true], [768, 1024, true], [1280, 900, false], [1920, 1080, false]];
const CONTROLE = `(() => {
  const r = { debord: [], alt: [], champs: [], boutons: [], h1: [...document.querySelectorAll("h1")].filter(h => h.closest("[hidden]") === null).length, lang: document.documentElement.lang, titre: document.title };
  const L = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > L + 1)
    for (const e of document.body.querySelectorAll("*")) {
      const b = e.getBoundingClientRect(), s = getComputedStyle(e);
      if (b.width && b.right > L + 1 && s.position !== "fixed" && !e.closest("[aria-hidden=true], .vitrine, .onglets, .outils, .une-visuel"))
        r.debord.push((e.id ? "#" + e.id : e.tagName.toLowerCase() + "." + [...e.classList].join(".")) + " (" + Math.round(b.right - L) + " px)");
    }
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
  for (const i of document.querySelectorAll("img")) if (!i.hasAttribute("alt")) r.alt.push(i.getAttribute("src"));
  for (const c of document.querySelectorAll("input, select, textarea")) {
    if (c.type === "hidden" || !visible(c) || c.closest("[aria-hidden=true]")) continue;
    const nom = c.labels?.length || c.getAttribute("aria-label") || c.getAttribute("aria-labelledby") || c.title;
    if (!nom) r.champs.push(c.id || c.name || c.dataset.k || c.outerHTML.slice(0, 60));
  }
  for (const b of document.querySelectorAll("button, a[href]"))
    if (visible(b) && !(b.textContent.trim() || b.getAttribute("aria-label") || b.title || b.querySelector("img[alt]:not([alt=''])")))
      r.boutons.push(b.outerHTML.slice(0, 70));
  r.debord = r.debord.slice(0, 4);
  return r;
})()`;

async function pages() {
  for (const [largeur, hauteur, mobile] of LARGEURS) {
    console.log(`\nPages à ${largeur} px de large${mobile ? " (téléphone/tablette)" : ""}`);
    const o = await nouvelOnglet(largeur, hauteur, mobile);
    for (const chemin of PAGES) {
      const ou = `${chemin} à ${largeur} px`;
      o.erreurs.length = 0;
      try {
        await o.aller(chemin);
        const r = await o.js(CONTROLE);
        const avant = problemes.length;
        if (r.debord.length) noter(ou, "dépasse sur le côté : " + r.debord.join(", "));
        if (largeur === 1280) {                       // le reste ne dépend pas de la largeur
          if (r.alt.length) noter(ou, "images sans texte alternatif : " + r.alt.join(", "));
          if (r.champs.length) noter(ou, "champs sans étiquette : " + r.champs.join(", "));
          if (r.boutons.length) noter(ou, "boutons ou liens sans nom : " + r.boutons.join(" | "));
          if (r.h1 !== 1) noter(ou, `${r.h1} titre(s) principal(aux) <h1> (1 attendu)`);
          if (!r.lang || !r.titre) noter(ou, "langue ou titre de page manquant");
        }
        for (const e of new Set(o.erreurs)) if (!(chemin === "/page-qui-n-existe-pas" && e.includes("404"))) noter(ou, e);
        if (problemes.length === avant) console.log(`  ✓ ${chemin}`);
      } catch (e) { noter(ou, e.message); }
    }
    await o.fermer();
  }
}

try {
  await parcours();
  await pages();
} finally {
  ws.close(); chrome.kill();
  try { rmSync(profil, { recursive: true, force: true }); } catch { /* sans importance */ }
}
console.log(problemes.length ? `\n${problemes.length} problème(s).` : "\nAucun problème.");
process.exit(problemes.length ? 1 : 0);
