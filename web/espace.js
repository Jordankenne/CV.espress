"use strict";
/*
 * « Mon espace » (/compte) : connexion ou création de compte, puis le profil du visiteur :
 * ses documents, les dates de son compte, le changement de mot de passe, ses données.
 * Tout passe par /api/compte… ; le serveur ne renvoie jamais que les données du compte connecté.
 */
const CLE_STOCKAGE = "cv-saas-v1", CLE_SYNCHRO = "cv-saas-synchro";   // les mêmes que l'éditeur (app.js)
const $ = sel => document.querySelector(sel);
const MODELES = { moderne: "Moderne", classique: "Classique", europeen: "Européen", africain: "Africain", epure: "Épurée",
                  elegant: "Élégant", compact: "Compact", elegante: "Élégante" };
const PARTIES = ["accroche", "parcours", "entreprise", "conclusion"];
let documents = [];         // les documents du compte : { doc, nom, modifie_le, donnees (sans la photo) }
let inscription = false;
let vue = "connexion";      // ce que montre la porte d'entrée : "connexion", "oubli" (demander un lien) ou "jeton" (lien reçu)
// Arrivée par le lien reçu par e-mail : /compte?jeton=… Le jeton est aussitôt retiré de la barre
// d'adresse (il ne reste ni dans l'historique, ni dans une capture d'écran).
let jetonRecu = new URLSearchParams(location.search).get("jeton");
if (jetonRecu) { vue = "jeton"; history.replaceState(null, "", location.pathname); }
else if (new URLSearchParams(location.search).get("oubli")) vue = "oubli";

async function api(methode, chemin, corps) {
  try {
    const r = await fetch("/api/compte" + chemin, {
      method: methode, credentials: "same-origin",
      headers: corps ? { "Content-Type": "application/json" } : {},
      body: corps ? JSON.stringify(corps) : undefined,
    });
    return { ok: r.ok, statut: r.status, corps: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, statut: 0, corps: { erreur: "Connexion impossible. Vérifie ta connexion Internet." } };
  }
}
function erreur(sel, message) { $(sel).textContent = message || ""; $(sel).hidden = !message; }
function message(texte) { $("#espace-message").textContent = texte || ""; $("#espace-message").hidden = !texte; }
function date(secondes, avecHeure) {
  if (!secondes) return "—";
  const d = new Date(secondes * 1000);
  // Dans la langue du site (définie par traductions.js) : « 14 novembre 2026 à 20:53 », « 14 November 2026 at 20:53 »…
  return d.toLocaleString(window.LOCALE_SITE || "fr-FR", avecHeure
    ? { dateStyle: "long", timeStyle: "short" } : { dateStyle: "long" });
}
const texte = v => (typeof v === "string" ? v.trim() : "");
const liste = v => (Array.isArray(v) ? v.filter(x => x && typeof x === "object") : []);

// ---------- Porte d'entrée : connexion / création de compte ----------
function afficherPorte() {
  $("#porte-form").hidden = vue !== "connexion";
  $("#oubli-form").hidden = vue !== "oubli";
  $("#jeton-form").hidden = vue !== "jeton";
  $("#porte-oubli-ligne").hidden = inscription;
  if (vue !== "connexion") {
    $("#porte-titre").textContent = vue === "oubli" ? "Mot de passe oublié" : "Choisis ton mot de passe";
    return;
  }
  // Inscription : seulement l'adresse e-mail. Le mot de passe se choisit en ouvrant le lien reçu,
  // ce qui prouve que l'adresse est bien la sienne.
  $("#porte-titre").textContent = inscription ? "Créer un compte" : "Se connecter";
  $("#porte-valider").textContent = inscription ? "Recevoir le lien d'inscription" : "Se connecter";
  $("#porte-question").textContent = inscription ? "Déjà un compte ?" : "Pas encore de compte ?";
  $("#porte-bascule").textContent = inscription ? "Se connecter" : "Créer un compte";
  $("#porte-mdp-ligne").hidden = inscription;
  $("#porte-info").hidden = !inscription;
  $("#porte-envoye").hidden = true;
  $("#porte-valider").hidden = false;
}
$("#porte-bascule").addEventListener("click", () => { inscription = !inscription; erreur("#porte-erreur", ""); afficherPorte(); });
// ---------- Mot de passe oublié ----------
function montrer(nouvelleVue) {
  vue = nouvelleVue;
  for (const sel of ["#porte-erreur", "#oubli-erreur", "#jeton-erreur"]) erreur(sel, "");
  $("#oubli-envoye").hidden = true;
  $("#oubli-valider").hidden = false;
  afficherPorte();
}
$("#porte-oubli").addEventListener("click", () => { $("#oubli-email").value = $("#porte-email").value; montrer("oubli"); });
$("#oubli-retour").addEventListener("click", () => montrer("connexion"));
$("#jeton-retour").addEventListener("click", () => montrer("oubli"));

$("#oubli-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#oubli-email").value.trim();
  if (!email) return erreur("#oubli-erreur", "Renseigne ton adresse e-mail.");
  $("#oubli-valider").disabled = true;
  const r = await api("POST", "/mot-de-passe-oublie", { email, langue: window.LANGUE_SITE || "fr" });
  $("#oubli-valider").disabled = false;
  if (!r.ok) return erreur("#oubli-erreur", r.corps.erreur || "Une erreur est survenue. Réessaie.");
  erreur("#oubli-erreur", "");
  $("#oubli-envoye").hidden = false;
  $("#oubli-valider").hidden = true;
});

$("#jeton-form").addEventListener("submit", async e => {
  e.preventDefault();
  const mdp = $("#jeton-mdp").value;
  if (mdp.length < 8) return erreur("#jeton-erreur", "Le mot de passe doit contenir au moins 8 caractères.");
  $("#jeton-valider").disabled = true;
  const r = await api("POST", "/nouveau-mot-de-passe", { jeton: jetonRecu, mot_de_passe: mdp });
  $("#jeton-valider").disabled = false;
  $("#jeton-mdp").value = "";
  if (!r.ok) return erreur("#jeton-erreur", r.corps.erreur || "Une erreur est survenue. Réessaie.");
  jetonRecu = null; vue = "connexion";
  try { localStorage.removeItem(CLE_SYNCHRO); } catch { /* stockage indisponible */ }
  if (r.corps.nouveau_compte) await envoyerLocal();   // un CV commencé sur cet appareil rejoint le compte
  await charger();
  message(r.corps.nouveau_compte ? "Ton compte est créé. Ton CV sera enregistré automatiquement."
                                 : "Ton mot de passe a été changé. Tes autres appareils ont été déconnectés.");
});

$("#porte-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#porte-email").value.trim(), mdp = $("#porte-mdp").value;
  if (inscription) {
    if (!email) return erreur("#porte-erreur", "Renseigne ton adresse e-mail.");
    $("#porte-valider").disabled = true;
    const r = await api("POST", "/inscription", { email, langue: window.LANGUE_SITE || "fr" });
    $("#porte-valider").disabled = false;
    if (!r.ok) return erreur("#porte-erreur", r.corps.erreur || "Une erreur est survenue. Réessaie.");
    erreur("#porte-erreur", "");
    $("#porte-envoye").hidden = false;
    $("#porte-valider").hidden = true;
    return;
  }
  if (!email || !mdp) return erreur("#porte-erreur", "Renseigne ton adresse e-mail et ton mot de passe.");
  $("#porte-valider").disabled = true;
  const r = await api("POST", "/connexion", { email, mot_de_passe: mdp });
  $("#porte-valider").disabled = false;
  $("#porte-mdp").value = "";
  if (!r.ok) return erreur("#porte-erreur", r.corps.erreur || "Une erreur est survenue. Réessaie.");
  // Autre compte possible sur cet appareil : l'éditeur refera le point à sa prochaine ouverture.
  try { localStorage.removeItem(CLE_SYNCHRO); } catch { /* stockage indisponible */ }
  await envoyerLocal();        // un CV déjà commencé sur cet appareil rejoint le compte s'il est vide
  await charger();
});

/** Si le compte n'a encore aucun CV et que cet appareil en contient un, on l'y enregistre. */
async function envoyerLocal() {
  let local;
  try { local = JSON.parse(localStorage.getItem(CLE_STOCKAGE)); } catch { return; }
  if (!local || !local.cv || !texte(local.cv.nom)) return;
  const r = await api("GET", "/donnees");
  if (!r.ok || r.corps.donnees) return;
  const e = await api("PUT", "/donnees", { donnees: local, nouveau: true });
  if (e.ok) {
    try {
      localStorage.setItem(CLE_SYNCHRO, JSON.stringify({ doc: e.corps.doc, vu: e.corps.modifie_le, version: e.corps.version, sale: false }));
    } catch { /* idem */ }
  }
}

/** Enregistre ce qui est sur cet appareil sans jamais écraser une version plus récente :
 *  si le document a changé ailleurs entre-temps (409), on en fait un nouveau document. */
async function enregistrerSansEcraser(local, s) {
  const corps = { donnees: local, nouveau: !s.doc };
  if (s.doc && Number.isInteger(s.version)) corps.version = s.version;
  const r = await api("PUT", "/donnees" + (s.doc ? "?doc=" + s.doc : ""), corps);
  if (r.statut === 404 || (r.statut === 409 && r.corps.conflit)) {
    return api("PUT", "/donnees", { donnees: local, nouveau: true,
      nom: (window.tr || (t => t))("Version modifiée sur cet appareil") });
  }
  return r;
}

// ---------- Espace du visiteur connecté ----------
function progression(cv) {
  const etapes = [texte(cv.nom), texte(cv.titre), texte(cv.email), texte(cv.telephone), texte(cv.ville), texte(cv.profil),
    liste(cv.experiences).some(x => texte(x.poste) || texte(x.entreprise)),
    liste(cv.formations).some(x => texte(x.diplome) || texte(x.ecole)),
    liste(cv.competences).some(x => texte(x.liste)),
    liste(cv.langues).some(x => texte(x.langue))];
  return Math.round(100 * etapes.filter(Boolean).length / etapes.length);
}
function texteLettre(lettre) {
  const parties = lettre && typeof lettre.parties === "object" && lettre.parties ? lettre.parties : {};
  return PARTIES.map(c => texte(parties[c])).filter(Boolean).join("\n") || texte(lettre && lettre.corps);
}

function afficherEspace(compte) {
  $("#espace-initiale").textContent = compte.email[0].toUpperCase();
  $("#espace-email").textContent = compte.email;
  $("#profil-email").textContent = compte.email;
  $("#profil-cree").textContent = date(compte.cree_le);
  $("#profil-vu").textContent = date(compte.vu_le, true);

  dessinerDocuments();
}

/** Petit fabricant d'éléments : el("button", { className: "bouton" }, "Texte"). */
function el(balise, proprietes, ...enfants) {
  const e = Object.assign(document.createElement(balise), proprietes || {});
  e.append(...enfants);
  return e;
}

function dessinerDocuments() {
  const remplis = documents.filter(d => d.donnees && d.donnees.cv && texte(d.donnees.cv.nom));
  $("#docs-vide").hidden = documents.length > 0;
  $("#docs-creer").hidden = documents.length > 0;
  $("#donnees-copie").disabled = !documents.length;
  $("#docs").replaceChildren(...documents.map(dessinerDocument));
  return remplis.length;
}

function dessinerDocument(d) {
  const donnees = d.donnees && typeof d.donnees === "object" ? d.donnees : {};
  const cv = donnees.cv && typeof donnees.cv === "object" ? donnees.cv : {};
  const options = donnees.options && typeof donnees.options === "object" ? donnees.options : {};
  const lettre = donnees.lettre && typeof donnees.lettre === "object" ? donnees.lettre : {};
  const aUnCv = !!texte(cv.nom);
  const corps = texteLettre(lettre);
  const mots = corps.split(/\s+/).filter(Boolean).length;
  const pourcent = progression(cv);
  const ouvrir = (window.PREFIXE_SITE || "") + "/creer?doc=" + d.doc;
  const bouton = (libelle, action, classe) => {
    const b = el("button", { type: "button", className: classe || "mini" }, libelle);
    b.addEventListener("click", () => action(b));
    return b;
  };

  const nom = el("strong", { className: "dossier-nom" }, d.nom);
  nom.setAttribute("translate", "no");                    // nom choisi par l'utilisateur : jamais traduit
  const resume = el("p", { className: "cv-resume" }, aUnCv ? [texte(cv.nom), texte(cv.titre)].filter(Boolean).join(" · ") : "");
  resume.setAttribute("translate", "no");
  const resumeLettre = el("p", { className: "lettre-resume" });
  if (corps) {
    const objet = el("span", null, texte(lettre.objet));
    objet.setAttribute("translate", "no");
    resumeLettre.append(...(texte(lettre.objet) ? [objet, " · "] : []), `${mots} mots`);
  } else resumeLettre.append("Pas encore écrite.");

  const pdfCv = bouton("Télécharger le PDF", b => telechargerPdf(d.doc, "cv", b), "bouton cv-pdf");
  pdfCv.disabled = !aUnCv;
  const pdfLettre = bouton("Télécharger le PDF", b => telechargerPdf(d.doc, "lettre", b), "bouton lettre-pdf");
  pdfLettre.disabled = !corps || !aUnCv;

  return el("section", { className: "dossier" },
    el("div", { className: "dossier-tete" },
      el("div", null, nom, el("p", { className: "note dossier-date" }, `Dernier enregistrement : ${date(d.modifie_le, true)}`)),
      el("div", { className: "dossier-actions" },
        bouton("Renommer", () => renommer(d)), bouton("Dupliquer", () => dupliquer(d)), bouton("Supprimer", () => supprimer(d)))),
    el("div", { className: "doc" },
      el("div", null,
        el("strong", null, "CV"), " ",
        el("span", { className: "puce-modele cv-modele" }, aUnCv ? "Modèle " + (MODELES[options.modele] || "Classique") : ""),
        aUnCv ? resume : el("p", { className: "cv-resume" }, "Pas encore rempli."),
        el("div", { className: "jauge-espace" },
          el("progress", { max: 100, value: pourcent }),
          el("span", { className: "cv-progres-texte" }, pourcent === 100 ? "CV complet" : `Complété à ${pourcent} %`))),
      el("div", { className: "doc-actions" }, el("a", { className: "bouton principal", href: ouvrir }, "Modifier"), pdfCv)),
    el("div", { className: "doc" },
      el("div", null,
        el("strong", null, "Lettre de motivation"), " ",
        el("span", { className: "puce-modele lettre-modele" }, corps ? "Modèle " + (MODELES[options.modele_lettre] || "Classique") : ""),
        resumeLettre),
      el("div", { className: "doc-actions" }, el("a", { className: "bouton principal", href: ouvrir + "&type=lettre" }, "Modifier"), pdfLettre)));
}

async function chargerDocuments() {
  const r = await api("GET", "/documents");
  documents = r.ok ? r.corps.documents : [];
  if (r.ok) $("#docs-maximum").textContent = r.corps.maximum;
  dessinerDocuments();
}

// ---------- Gérer ses documents ----------
$("#docs-nouveau").addEventListener("click", async () => {
  message("");
  const nom = prompt("Nom du nouveau document (par exemple le poste visé) :", "");
  if (nom === null) return;
  const r = await api("POST", "/documents", { nom });
  if (!r.ok) return message(r.corps.erreur || "Création impossible. Réessaie.");
  location.href = (window.PREFIXE_SITE || "") + "/creer?doc=" + r.corps.doc;
});

async function renommer(d) {
  const nom = prompt("Nouveau nom du document :", d.nom);
  if (nom === null || !nom.trim() || nom.trim() === d.nom) return;
  const r = await api("PATCH", "/documents/" + d.doc, { nom });
  message(r.ok ? "" : r.corps.erreur || "Changement de nom impossible. Réessaie.");
  await chargerDocuments();
}

async function dupliquer(d) {
  const r = await api("POST", "/documents", { copie_de: d.doc });
  message(r.ok ? "Le document a été dupliqué. Tu peux maintenant adapter la copie à une autre offre."
               : r.corps.erreur || "Copie impossible. Réessaie.");
  await chargerDocuments();
}

async function supprimer(d) {
  if (!confirm("Supprimer définitivement ce document (son CV et sa lettre) ?")) return;
  const r = await api("DELETE", "/documents/" + d.doc, {});
  if (r.ok) {
    // Si c'était le document ouvert dans l'éditeur sur cet appareil, on l'en retire aussi.
    try {
      const sync = JSON.parse(localStorage.getItem(CLE_SYNCHRO)) || {};
      if (sync.doc === d.doc) { localStorage.removeItem(CLE_STOCKAGE); localStorage.removeItem(CLE_SYNCHRO); }
    } catch { /* stockage indisponible */ }
  }
  message(r.ok ? "Le document a été supprimé." : r.corps.erreur || "Suppression impossible. Réessaie.");
  await chargerDocuments();
}

async function charger() {
  const r = await api("GET", "");
  $("#espace-attente").hidden = true;
  // Lien reçu par e-mail : on l'utilise, même si un compte est déjà connecté sur cet appareil
  // (sinon le lien serait ignoré et le mot de passe ne pourrait pas être changé).
  const connecte = r.ok && r.corps.connecte && !jetonRecu;
  $("#espace-porte").hidden = connecte;
  $("#espace").hidden = !connecte;
  if (!connecte) { afficherPorte(); return; }
  afficherEspace(r.corps);
  await chargerDocuments();
  // L'en-tête (entete.js) a pu être dessiné avant la connexion : on le met à jour.
  for (const lien of document.querySelectorAll("a[data-lien-compte]")) {
    const pastille = document.createElement("span");
    pastille.className = "initiale";
    pastille.textContent = r.corps.email[0].toUpperCase();
    lien.replaceChildren(pastille, "Mon espace");
  }
}

// ---------- Télécharger un PDF directement depuis l'espace ----------
async function telechargerPdf(numero, type, bouton) {
  bouton.disabled = true; message("");
  try {
    const d = await api("GET", "/donnees?doc=" + numero);
    if (!d.ok) throw new Error(d.corps.erreur || "Ce document n'a pas pu être chargé.");
    const donnees = d.corps.donnees;
    const r = await fetch("/api/pdf", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, cv: donnees.cv, lettre: donnees.lettre, options: donnees.options }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erreur || "La génération du document a échoué.");
    enregistrer(await r.blob(), `${type === "lettre" ? "Lettre" : "CV"}_${texte(donnees.cv.nom).replace(/[^A-Za-z0-9]+/g, "_") || "document"}.pdf`);
  } catch (e) { message(e.message); }
  bouton.disabled = false;
}
function enregistrer(blob, nom) {
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(blob);
  lien.download = nom;
  document.body.append(lien); lien.click(); lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 1000);
}
// Copie de toutes les données du compte : chaque document en entier, photo comprise.
$("#donnees-copie").addEventListener("click", async () => {
  const copie = [];
  for (const d of documents) {
    const r = await api("GET", "/donnees?doc=" + d.doc);
    if (r.ok) copie.push({ nom: r.corps.nom, modifie_le: r.corps.modifie_le, ...r.corps.donnees });
  }
  enregistrer(new Blob([JSON.stringify({ documents: copie }, null, 2)], { type: "application/json" }), "mes-donnees-cv.json");
});

// ---------- Mot de passe, déconnexion, suppression ----------
$("#mdp-form").addEventListener("submit", async e => {
  e.preventDefault();
  const ancien = $("#mdp-ancien").value, nouveau = $("#mdp-nouveau").value;
  if (!ancien || !nouveau) return erreur("#mdp-erreur", "Renseigne les deux mots de passe.");
  if (nouveau.length < 8) return erreur("#mdp-erreur", "Le nouveau mot de passe doit contenir au moins 8 caractères.");
  $("#mdp-valider").disabled = true;
  const r = await api("POST", "/mot-de-passe", { ancien, nouveau });
  $("#mdp-valider").disabled = false;
  if (!r.ok) return erreur("#mdp-erreur", r.corps.erreur || "Changement impossible. Réessaie.");
  $("#mdp-form").reset(); erreur("#mdp-erreur", "");
  message("Ton mot de passe a été changé. Tes autres appareils ont été déconnectés.");
});

// Mot de passe actuel inconnu : un lien pour en choisir un nouveau, envoyé à l'adresse du compte
// (celui qui a seulement accès à l'appareil, sans la boîte e-mail, ne peut donc pas le changer).
$("#mdp-par-email").addEventListener("click", async () => {
  $("#mdp-par-email").disabled = true;
  const r = await api("POST", "/mot-de-passe-oublie", { email: $("#profil-email").textContent, langue: window.LANGUE_SITE || "fr" });
  $("#mdp-par-email").disabled = false;
  if (!r.ok) return erreur("#mdp-erreur", r.corps.erreur || "Envoi impossible. Réessaie.");
  erreur("#mdp-erreur", "");
  message("Nous venons de t'envoyer un e-mail. Ouvre le lien qu'il contient pour choisir un nouveau mot de passe (valable 30 minutes). Pense à regarder dans les courriers indésirables.");
});

$("#espace-deconnexion").addEventListener("click", async () => {
  // Des modifications faites dans l'éditeur et pas encore envoyées ? On les enregistre d'abord.
  try {
    const s = JSON.parse(localStorage.getItem(CLE_SYNCHRO)) || {};
    const local = JSON.parse(localStorage.getItem(CLE_STOCKAGE));
    if (s.sale && local) await enregistrerSansEcraser(local, s);
  } catch { /* rien à envoyer */ }
  await api("POST", "/deconnexion", {});
  // Ordinateur partagé : après la déconnexion, il ne reste rien sur cet appareil.
  try { localStorage.removeItem(CLE_STOCKAGE); localStorage.removeItem(CLE_SYNCHRO); } catch { /* idem */ }
  location.href = (window.PREFIXE_SITE || "") + "/";
});

$("#suppr-valider").addEventListener("click", async () => {
  const mdp = $("#suppr-mdp").value;
  if (!mdp) return erreur("#suppr-erreur", "Saisis ton mot de passe pour confirmer.");
  const r = await api("DELETE", "", { mot_de_passe: mdp });
  $("#suppr-mdp").value = "";
  if (!r.ok) return erreur("#suppr-erreur", r.corps.erreur || "Suppression impossible. Réessaie.");
  try { localStorage.removeItem(CLE_SYNCHRO); } catch { /* idem */ }
  alert("Ton compte et les documents enregistrés sur nos serveurs ont été supprimés.");
  location.href = (window.PREFIXE_SITE || "") + "/";
});

charger();
