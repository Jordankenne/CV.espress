"use strict";
// Éditeur (page /creer), partie 4/5 : Aperçu, téléchargement (PDF, Word), import d'un CV, exemple, QR code, copie dans une autre langue.
// Les cinq fichiers editeur-*.js se chargent dans l'ordre (voir creer.html) et partagent leurs
// variables : ce qui est déclaré dans un fichier sert dans les suivants.

// ---------- Aperçu et téléchargement ----------
let minuterie = null;
let requete = null;

function montrerErreur(message) {
  const p = $("#erreur");
  p.textContent = message || "";
  p.hidden = !message;
}

function pret() {
  if (etat.type === "plan") return etat.plan.elements.length ? "" : "Dessine ton plan, ou utilise l'assistant itinéraire.";
  if (etat.type === "arbre") return etat.arbre.racine.nom.trim() ? "" : "Indique le nom de l'ancêtre pour voir l'aperçu.";
  if (!etat.cv.nom.trim()) return "Renseigne ton nom pour voir l'aperçu.";
  if (etat.type === "lettre" && !texteLettre(etat.lettre)) return "Écris le texte de la lettre pour voir l'aperçu.";
  if (etat.type === "admin" && !etat.admin.corps.trim()) return "Écris le texte du document pour voir l'aperçu.";
  return "";
}

// Réponses du serveur qui méritent un second essai automatique : serveur occupé (429, 503) ou
// en train de se réveiller (502, 504 : l'hébergeur gratuit met le site en veille).
const A_REESSAYER = new Set([429, 502, 503, 504]);
const pause = ms => new Promise(ok => setTimeout(ok, ms));

/** Envoie le document au serveur. essais > 1 : nouvel essai si le serveur est occupé ou injoignable.
 *  attendu : type de fichier attendu (« application/pdf »…), vérifié avant d'utiliser la réponse. */
async function appeler(chemin, signal, { essais = 1, attendu = "", duree = 0 } = {}) {
  for (let essai = 1; ; essai++) {
    let reponse;
    const minuteur = duree && AbortSignal.timeout ? AbortSignal.timeout(duree) : null;
    try {
      reponse = await fetch(chemin, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: etat.type, cv: etat.cv, lettre: etat.lettre, admin: documentAdmin(), plan: etat.plan, arbre: etat.arbre, options: etat.options }),
        signal: signal && minuteur && AbortSignal.any ? AbortSignal.any([signal, minuteur]) : signal || minuteur,
      });
    } catch (e) {
      if (e.name === "AbortError" && !minuteur?.aborted) throw e;
      const tropLong = e.name === "TimeoutError" || minuteur?.aborted;
      if (!tropLong && essai < essais) { await pause(3000); continue; }   // coupure réseau : un autre essai
      throw new Error(tropLong
        ? "Le serveur met trop de temps à répondre (il vient peut-être de se réveiller). Réessaie dans une minute."
        : "Connexion impossible. Vérifie ta connexion Internet et réessaie.");
    }
    if (reponse.ok) {
      const type = reponse.headers.get("Content-Type") || "";
      if (attendu && !type.startsWith(attendu)) {
        if (essai < essais) { await pause(3000); continue; }
        throw new Error("Le fichier reçu est incomplet. Réessaie dans un instant.");
      }
      return reponse;
    }
    const detail = await reponse.json().catch(() => ({}));
    if (detail.compte_requis) {          // session expirée entre-temps : on se reconnecte
      compte = { connecte: false, email: null };
      afficherCompte();
    }
    if (A_REESSAYER.has(reponse.status) && essai < essais) {
      const attente = Math.min(10, Number(reponse.headers.get("Retry-After")) || 4);
      $("#etat").textContent = `Serveur occupé, nouvel essai dans ${attente} s…`;
      await pause(attente * 1000);
      continue;
    }
    if (detail.erreur) throw new Error(detail.erreur);
    throw new Error(reponse.status === 502 || reponse.status === 504
      ? "Le serveur se réveille (il était en veille). Réessaie dans une minute."
      : `Le document n'a pas pu être fabriqué (erreur ${reponse.status}). Réessaie dans un instant.`);
  }
}

/** Fabrication d'un fichier à télécharger : deux essais, deux minutes au plus. */
const FORMATS = {
  pdf: { chemin: "/api/pdf", type: "application/pdf", extension: "pdf" },
  docx: { chemin: "/api/docx", extension: "docx",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};
const fichierDuServeur = (format = "pdf") =>
  appeler(FORMATS[format].chemin, undefined, { essais: 2, attendu: FORMATS[format].type, duree: 120_000 })
    .then(r => r.blob());

// Suivi anonyme du parcours dans l'éditeur (combien commencent, voient l'aperçu, téléchargent…) :
// chaque étape est comptée au plus une fois par onglet. Rien de personnel n'est envoyé.
function signaler(etape) {
  try {
    const deja = JSON.parse(sessionStorage.getItem("cv-parcours") || "[]");
    if (deja.includes(etape)) return;
    sessionStorage.setItem("cv-parcours", JSON.stringify([...deja, etape]));
  } catch { /* stockage indisponible : on compte quand même */ }
  fetch("/api/evenement", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ etape }) }).catch(() => {});
}

async function actualiser() {
  clearTimeout(minuterie);
  const manque = pret();
  $("#btn-telecharger").disabled = !!manque;
  $("#btn-ouvrir").disabled = !!manque;
  $("#btn-partager").disabled = !!manque;
  $("#btn-telecharger-bas").disabled = !!manque;
  $("#btn-word").disabled = !!manque;
  if (manque) {
    $("#etat").textContent = manque;
    $("#vide").hidden = etat.type === "plan" && !window.planVoirPdf;     // la zone de dessin occupe la place
    $("#pages").replaceChildren();
    return;
  }
  // Plan de localisation : pendant qu'on dessine, l'aperçu PDF n'est fabriqué qu'à la demande.
  if (etat.type === "plan" && !window.planVoirPdf) { $("#etat").textContent = ""; return; }
  requete?.abort();
  requete = new AbortController();
  $("#etat").textContent = "Mise à jour…";
  try {
    const { pages } = await (await appeler("/api/apercu", requete.signal)).json();
    const images = pages.map((src, i) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = `Aperçu, page ${i + 1}`;
      return img;
    });
    $("#pages").replaceChildren(...images);
    $("#vide").hidden = true;
    montrerErreur("");
    $("#etat").textContent = pages.length > 1 ? `${pages.length} pages` : "1 page";
    signaler("apercu");
  } catch (e) {
    if (e.name === "AbortError") return;
    $("#etat").textContent = "";
    montrerErreur(e.message);
  }
}

/** Télécharger demande un compte : sans compte, on ouvre l'inscription, puis on reprend. */
function compteAvant(action) {
  if (compte.connecte || !compteRequisPourPdf) return true;
  signaler("compte_demande");
  ouvrirCompte(action, true);
  return false;
}

async function telecharger(bouton, format = "pdf") {
  signaler("telecharger");
  if (!compteAvant(() => telecharger(bouton, format))) return;
  const texte = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = "Préparation…";
  try {
    const fichier = await fichierDuServeur(format);
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(fichier);
    lien.download = nomFichier(FORMATS[format].extension);
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
    montrerErreur("");
    signaler(format === "docx" ? "telecharge_word" : "telecharge");
  } catch (e) {
    signaler("echec_telechargement");
    montrerErreur(e.message);
  } finally {
    bouton.textContent = texte;
    bouton.disabled = false;
    if ($("#etat").textContent.startsWith("Serveur occupé")) $("#etat").textContent = "";
  }
}
function nomFichier(extension = "pdf") {
  const nom = etat.cv.nom.trim().normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (etat.type === "plan") return "Plan_de_localisation.pdf";
  if (etat.type === "arbre") return "Arbre_genealogique.pdf";
  return `${{ lettre: "Lettre", admin: "Document", plan: "Plan" }[etat.type] || "CV"}_${nom || "document"}.${extension}`;
}

/** Partage le PDF vers une autre application (WhatsApp, e-mail…), surtout utile sur téléphone. */
const partagePossible = (() => {
  try {
    return !!navigator.canShare && navigator.canShare({
      files: [new File([""], "essai.pdf", { type: "application/pdf" })] });
  } catch { return false; }
})();
$("#btn-partager").hidden = !partagePossible;

async function partager(bouton) {
  if (!compteAvant(() => partager(bouton))) return;
  bouton.disabled = true;
  try {
    const pdf = await fichierDuServeur("pdf");
    const fichier = new File([pdf], nomFichier(), { type: "application/pdf" });
    await navigator.share({ files: [fichier], title: fichier.name });
    montrerErreur("");
  } catch (e) {
    // AbortError : la personne a fermé le menu de partage, ce n'est pas une erreur.
    if (e.name === "NotAllowedError") montrerErreur("Le partage a été bloqué par le navigateur. Utilise « Télécharger le PDF ».");
    else if (e.name !== "AbortError") montrerErreur(e.message);
  } finally {
    bouton.disabled = false;
  }
}
$("#btn-partager").addEventListener("click", e => partager(e.currentTarget));

/** Ouvre le PDF dans un nouvel onglet (au lieu de le télécharger). */
async function ouvrir(bouton) {
  // Après l'inscription, l'onglet ne pourrait plus s'ouvrir (bloqué par le navigateur) : on télécharge.
  if (!compteAvant(() => telecharger($("#btn-telecharger")))) return;
  // L'onglet est ouvert TOUT DE SUITE, pendant le clic : ouvert plus tard (après la
  // réponse du serveur), le navigateur le bloquerait comme une fenêtre publicitaire.
  const onglet = window.open("", "_blank");
  bouton.disabled = true;
  try {
    const pdf = await fichierDuServeur("pdf");
    const url = URL.createObjectURL(pdf);
    if (onglet) onglet.location = url;
    else location.href = url;          // fenêtres bloquées : on ouvre dans l'onglet actuel
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    montrerErreur("");
  } catch (e) {
    onglet?.close();
    montrerErreur(e.message);
  } finally {
    bouton.disabled = false;
  }
}
$("#btn-ouvrir").addEventListener("click", e => ouvrir(e.currentTarget));
$("#btn-telecharger").addEventListener("click", e => telecharger(e.currentTarget));
$("#btn-telecharger-bas").addEventListener("click", e => telecharger(e.currentTarget));
$("#btn-word").addEventListener("click", e => telecharger(e.currentTarget, "docx"));
$("#btn-voir").addEventListener("click", () => $("#apercu").scrollIntoView({ behavior: "smooth" }));

/** À appeler après chaque modification : sauvegarde, puis aperçu différé (on attend la fin de la frappe). */
function modifie(delai = 1200) {
  sauvegarder();
  afficherProgres();
  clearTimeout(minuterie);
  minuterie = setTimeout(actualiser, delai);
}

signaler("editeur");
$("#formulaire").addEventListener("input", e => {
  signaler("commence");
  const el = e.target;
  if (!el.dataset.k) return;   // les champs des listes ont leur propre écouteur
  ecrire(el.dataset.k, el.type === "checkbox" ? el.checked : el.value);
  // Texte de l'offre : seulement l'analyse des mots-clés, pas de nouvel aperçu du PDF.
  if (el.dataset.k === "offre") { sauvegarder(); afficherProgres(); return; }
  if (el.dataset.k === "options.qr") { changerQr(el.checked); return; }
  if (el.dataset.k === "options.modele") afficherType();
  if (el.dataset.k === "cv.interets") dessinerInterets();
  if (etat.type === "admin") {
    if (el.dataset.k === "admin.corps") etat.admin.auto = false;      // corrigé à la main : on n'y touche plus
    else redigerAdmin();
    afficherAdmin();
  }
  if (el.dataset.k === "options.langue") {
    // Les listes de choix suivent la langue du document, et les choix déjà faits sont convertis.
    convertirChoix(langueDocument, el.value);
    langueDocument = el.value;
    adapterLangueLettre(el.value);
    toutDessiner();
  }
  const immediat = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio";
  modifie(immediat ? 0 : 1200);
});
$("#formulaire").addEventListener("submit", e => e.preventDefault());

/** Change les formules de la lettre avec la langue, sauf si l'utilisateur les a personnalisées. */
function adapterLangueLettre(langue) {
  const standards = Object.values(TEXTES_LETTRE);
  for (const champ of ["salutation", "formule"]) {
    const actuel = etat.lettre[champ] || "";
    if (!actuel || standards.some(t => t[champ] === actuel)) etat.lettre[champ] = TEXTES_LETTRE[langue][champ];
  }
  remplirChamps();
}

// Lettre : une formule de politesse choisie dans le menu remplace le texte de la case.
$("#choix-formule").addEventListener("change", e => {
  if (!e.target.value) return;
  etat.lettre.formule = e.target.value;
  e.target.value = "";
  remplirChamps(); modifie();
});

$("#btn-trame").addEventListener("click", () => {
  if (texteLettre(etat.lettre) && !confirm((window.tr || (x => x))("Remplacer le texte actuel de la lettre par les phrases à compléter ?"))) return;
  etat.lettre.parties = { ...(TEXTES_LETTRE[etat.options.langue] || TEXTES_LETTRE.fr).trame };
  remplirChamps(); modifie();
});

// ---------- Importer un CV ou une lettre déjà existants (PDF ou Word) ----------
function afficherImport() {
  const lettre = etat.type === "lettre";
  $("#import-titre").textContent = lettre ? "Tu as déjà une lettre ?" : "Tu as déjà un CV ?";
  $("#import-texte").textContent = lettre
    ? "Envoie-la (PDF ou Word) : le texte est réparti dans les cases, tu n'as plus qu'à l'adapter à l'offre."
    : "Envoie-le (PDF ou Word) : le formulaire se remplit tout seul, tu n'as plus qu'à corriger et choisir un modèle.";
  $("#import-libelle").textContent = lettre ? "Importer ma lettre" : "Importer mon CV";
}
function messageImport(texte) {
  $("#import-message").textContent = texte || "";
  $("#import-message").hidden = !texte;
}

$("#import-fichier").addEventListener("change", async e => {
  const fichier = e.target.files[0];
  e.target.value = "";
  if (!fichier) return;
  const lettre = etat.type === "lettre";
  if (fichier.size > 3 * 1024 * 1024) return messageImport("Ce fichier est trop lourd (3 Mo au maximum).");
  if ((lettre ? texteLettre(etat.lettre) : etat.cv.nom.trim())
      && !confirm((window.tr || (x => x))(lettre ? "Remplacer le texte actuel de ta lettre par celui du fichier ?"
                                               : "Remplacer le CV actuel par celui du fichier ?"))) return;
  messageImport("Lecture du fichier…");
  let r, resultat;
  try {
    r = await fetch("/api/importer?type=" + (lettre ? "lettre" : "cv"), {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: fichier });
    resultat = await r.json();
  } catch {
    return messageImport("Connexion impossible. Vérifie ta connexion Internet et réessaie.");
  }
  if (!r.ok) return messageImport(resultat.erreur || "Ce fichier n'a pas pu être lu.");
  if (lettre) {
    // On garde le lieu, la date et le destinataire déjà saisis ; la formule d'appel et la
    // formule de politesse ne sont remplacées que si le fichier en contient.
    const recue = resultat.lettre;
    etat = fusionner({ ...etat, lettre: { ...etat.lettre, parties: recue.parties, objet: recue.objet || etat.lettre.objet,
      pj: recue.pj || etat.lettre.pj, salutation: recue.salutation || etat.lettre.salutation,
      formule: recue.formule || etat.lettre.formule } });
    messageImport("Ta lettre a été importée. Relis chaque case : la répartition automatique n'est pas toujours parfaite.");
  } else {
    etat = fusionner({ ...etat, cv: { ...resultat.cv, photo: etat.cv.photo } });
    const cv = etat.cv;
    const nb = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
    messageImport(`CV importé : ${nb(cv.experiences.length, "expérience")}, ${nb(cv.formations.length, "formation")}, `
      + `${nb(cv.langues.length, "langue")}. Relis chaque rubrique : la lecture automatique n'est pas toujours parfaite.`);
  }
  toutDessiner(); modifie(0);
});

// ---------- Exemple / export / import / vider ----------
let langueDocument = etat.options.langue;     // pour convertir les choix quand elle change

function toutDessiner() {
  langueDocument = etat.options.langue;
  redigerAdmin();       // le texte du document administratif suit les réponses (nom, date de naissance…)
  remplirChoix();       // avant remplirChamps : un menu doit contenir la valeur à afficher
  remplirChamps();
  Object.keys(LISTES).forEach(dessinerListe);
  dessinerInterets();
  afficherPhoto();
  afficherType();
  afficherQr();
}

// ---------- QR code vers le CV en ligne ----------
// Le CV en ligne (/cv/<code>) n'existe que pour un document enregistré dans un compte, et
// seulement si son titulaire active le lien. Le serveur n'imprime le QR code que si le code
// existe vraiment : un lien désactivé disparaît donc aussi des prochains PDF.
let partageActuel = null;           // { code, url, vues } du document ouvert, ou null
function afficherQr() {
  const etatQr = $("#qr-etat"), caseQr = $("#qr-case");
  if (!etatQr) return;
  const t = window.tr || (x => x);
  caseQr.checked = etat.options.qr && !!partageActuel;
  caseQr.disabled = !compte.connecte;
  etatQr.replaceChildren();
  if (!compte.connecte) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "lien"; b.textContent = t("Connecte-toi");
    b.addEventListener("click", () => $("#btn-compte").click());
    etatQr.append(b, " ", t("pour mettre ton CV en ligne : le recruteur scanne le QR code et voit ton CV à jour sur son téléphone."));
  } else if (partageActuel) {
    const a = document.createElement("a");
    a.href = partageActuel.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = partageActuel.url;
    a.setAttribute("translate", "no");
    etatQr.append(t("Ton CV en ligne :"), " ", a, ". ", t("Tu peux désactiver ce lien dans « Mon espace »."));
  } else {
    etatQr.append(t("En cochant cette case, tu crées un lien vers ton CV en ligne, visible par toute personne qui a le lien ou scanne le QR code."));
  }
}

/** Le document ouvert a-t-il un lien de partage ? Met l'option « partage » d'accord avec le compte. */
async function verifierPartage() {
  const doc = lireSynchro().doc;
  partageActuel = null;
  if (compte.connecte && doc) {
    const r = await api("GET", `/documents/${doc}/partage`);
    if (r.ok) partageActuel = r.corps.partage;
  }
  const code = partageActuel ? partageActuel.code : "";
  if (etat.options.partage !== code || (etat.options.qr && !code)) {
    etat.options.partage = code;
    if (!code) etat.options.qr = false;
    modifie(0);
  }
  afficherQr();
}

async function changerQr(coche) {
  const t = window.tr || (x => x);
  if (coche && !partageActuel) {
    if (!confirm(t("Ton CV sera visible en ligne par toute personne qui a le lien ou scanne le QR code (nom, coordonnées, photo, parcours). Tu pourras désactiver le lien à tout moment dans « Mon espace ». Continuer ?"))) {
      etat.options.qr = false; afficherQr(); return;
    }
    if (!lireSynchro().doc) await envoyer();           // le document doit d'abord exister dans le compte
    const doc = lireSynchro().doc;
    const r = doc ? await api("POST", `/documents/${doc}/partage`, {}) : { ok: false, corps: {} };
    if (!r.ok) {
      etat.options.qr = false; afficherQr();
      return montrerErreur(r.corps.erreur || "Le lien n'a pas pu être créé. Réessaie.");
    }
    partageActuel = r.corps.partage;
  }
  etat.options.qr = coche && !!partageActuel;
  etat.options.partage = partageActuel ? partageActuel.code : "";
  afficherQr();
  modifie(0);
}

// ---------- Copie d'un document dans une autre langue (bouton de « Mon espace ») ----------
// Le document arrive par /creer?doc=…&langue=en : on le convertit comme quand on change la langue
// du document (titres des rubriques, listes de choix, mois, formules de la lettre).
const NOTES_LANGUE = {
  fr: "Copie en français prête. Les titres des rubriques, les niveaux de langue, les diplômes, les mois et les formules de la lettre sont déjà traduits. Il te reste à traduire ton propre texte : titre, profil, missions et lettre.",
  en: "Copie en anglais prête. Les titres des rubriques, les niveaux de langue, les diplômes, les mois et les formules de la lettre sont déjà traduits. Il te reste à traduire ton propre texte : titre, profil, missions et lettre.",
  it: "Copie en italien prête. Les titres des rubriques, les niveaux de langue, les diplômes, les mois et les formules de la lettre sont déjà traduits. Il te reste à traduire ton propre texte : titre, profil, missions et lettre.",
};
function traduireDocument(langue) {
  if (!NOTES_LANGUE[langue]) return;
  if (etat.options.langue !== langue) {
    convertirChoix(etat.options.langue, langue);
    etat.options.langue = langue;
    adapterLangueLettre(langue);
    toutDessiner();
    modifie(0);
  }
  const note = $("#note-langue");
  note.textContent = NOTES_LANGUE[langue];
  note.hidden = false;
}

async function chargerExemple() {
  if (etat.cv.nom.trim() && !confirm((window.tr || (x => x))("Remplacer tes données par l'exemple ?"))) return;
  try {
    const exemple = await (await fetch("/exemple.json")).json();
    // L'exemple de lettre va avec l'exemple de CV (même personne) ; on garde la lettre
    // déjà écrite s'il y en a une.
    const lettre = texteLettre(etat.lettre) ? etat.lettre : await (await fetch("/exemple_lettre.json")).json();
    etat = fusionner({ type: etat.type, options: etat.options, lettre, cv: exemple });
    toutDessiner(); modifie(0);
  } catch {
    montrerErreur("Impossible de charger l'exemple.");
  }
}
$("#btn-exemple").addEventListener("click", chargerExemple);
$("#btn-exemple-vide").addEventListener("click", chargerExemple);

$("#btn-vider").addEventListener("click", () => {
  if (!confirm((window.tr || (x => x))(compte.connecte
    ? "Effacer toutes les données du formulaire, sur cet appareil ET dans ton compte ?"
    : "Effacer toutes les données du formulaire ?"))) return;
  etat = etatVide();
  toutDessiner(); sauvegarder(); actualiser();
});

$("#btn-exporter").addEventListener("click", () => {
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob([JSON.stringify(etat, null, 2)], { type: "application/json" }));
  lien.download = "mes-donnees-cv.json";
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
});

$("#btn-importer").addEventListener("change", async e => {
  const fichier = e.target.files[0];
  e.target.value = "";
  if (!fichier) return;
  try {
    etat = fusionner(JSON.parse(await fichier.text()));
    toutDessiner(); modifie(0);
  } catch {
    montrerErreur("Ce fichier n'est pas un export valide (JSON attendu).");
  }
});

toutDessiner();
// Arrivée par « Voir un exemple » : on charge l'exemple, sauf si un CV est déjà en cours.
if (parametres.get("exemple") === "1" && !etat.cv.nom.trim()) chargerExemple();
// Arrivée par « J'ai déjà un CV » (/creer?importer=1) : on met la carte d'import en évidence.
if (parametres.get("importer") === "1") {
  $("#import").classList.add("en-avant");
  $("#import-bouton").focus();
}
else actualiser();
// Arrivée par « Adapter mon CV à une offre » (/creer?offre=1) : la carte s'ouvre, prête à recevoir l'annonce.
if (parametres.get("offre") === "1" && etat.type === "cv") {
  $("#offre").open = true;
  $("#offre").scrollIntoView({ block: "start" });
  $("[data-k='offre']").focus({ preventScroll: true });
}
