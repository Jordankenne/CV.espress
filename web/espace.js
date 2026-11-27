"use strict";
// Textes des fenêtres confirm() et alert() : le traducteur de la page ne les voit pas.
const traduit = texte => (window.tr || (x => x))(texte);
/*
 * « Mon espace » (/compte) : connexion ou création de compte, puis le profil du visiteur :
 * ses documents, les dates de son compte, le changement de mot de passe, ses données.
 * Tout passe par /api/compte… ; le serveur ne renvoie jamais que les données du compte connecté.
 */
const CLE_STOCKAGE = "cv-saas-v1", CLE_SYNCHRO = "cv-saas-synchro";   // les mêmes que l'éditeur (editeur-etat.js)
const $ = sel => document.querySelector(sel);
const MODELES = { moderne: "Moderne", classique: "Classique", europeen: "Européen", africain: "Africain", epure: "Épurée",
                  elegant: "Élégant", compact: "Compact", elegante: "Élégante", minimal: "Minimaliste", creatif: "Créatif" };
const PARTIES = ["accroche", "parcours", "entreprise", "conclusion"];
let documents = [];         // les documents du compte : { doc, nom, modifie_le, donnees (sans la photo) }
let inscription = false;
let vue = "connexion";      // ce que montre la porte d'entrée : "connexion", "oubli" (demander un lien) ou "jeton" (lien reçu)
// Arrivée par le lien reçu par e-mail : /compte?jeton=… Le jeton est aussitôt retiré de la barre
// d'adresse (il ne reste ni dans l'historique, ni dans une capture d'écran).
let jetonRecu = new URLSearchParams(location.search).get("jeton");
if (jetonRecu) { vue = "jeton"; history.replaceState(null, "", location.pathname); }
else if (new URLSearchParams(location.search).get("oubli")) vue = "oubli";
// Arrivée par le lien de confirmation de l'adresse (e-mail de bienvenue) : /compte?confirmer=…
const confirmationRecue = new URLSearchParams(location.search).get("confirmer");
if (confirmationRecue) history.replaceState(null, "", location.pathname);
// Arrivée par « Créer mon compte » (/compte?inscription=1) : le formulaire d'inscription d'emblée.
if (new URLSearchParams(location.search).get("inscription")) inscription = true;

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
  // Inscription en une étape : prénom, nom, e-mail, mot de passe et confirmation.
  $("#porte-titre").textContent = inscription ? "Créer mon compte gratuit" : "Se connecter";
  $("#porte-valider").textContent = inscription ? "Créer mon compte" : "Se connecter";
  $("#porte-question").textContent = inscription ? "Déjà un compte ?" : "Pas encore de compte ?";
  $("#porte-bascule").textContent = inscription ? "Se connecter" : "Créer un compte";
  $("#porte-chapeau").textContent = inscription
    ? "Un compte gratuit pour télécharger tes documents et les retrouver sur tous tes appareils."
    : "Retrouve tes documents depuis n'importe quel appareil. Le compte est gratuit.";
  for (const sel of ["#porte-noms", "#porte-confirmation-ligne", "#porte-mdp-aide"]) $(sel).hidden = !inscription;
  $("#porte-mdp").autocomplete = inscription ? "new-password" : "current-password";
  $("#porte-info").hidden = !inscription;
  $("#porte-robot-ligne").hidden = !inscription;
  if (inscription) window.AntiRobot?.preparer($("#porte-robot"));
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
  annoncerConnexion();
  message(r.corps.nouveau_compte ? "Ton compte est créé. Ton CV sera enregistré automatiquement."
                                 : "Ton mot de passe a été changé. Tes autres appareils ont été déconnectés.");
});

const CHAMPS_PORTE = { prenom: "#porte-prenom", nom: "#porte-nom", email: "#porte-email",
                       mot_de_passe: "#porte-mdp", confirmation: "#porte-confirmation" };
$("#porte-voir-mdp").addEventListener("change", e => {
  for (const sel of ["#porte-mdp", "#porte-confirmation"]) $(sel).type = e.target.checked ? "text" : "password";
});
$("#porte-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#porte-email").value.trim(), mdp = $("#porte-mdp").value;
  const refuser = (texte, champ) => { erreur("#porte-erreur", texte); if (champ) $(CHAMPS_PORTE[champ]).focus(); };
  if (inscription) {
    const prenom = $("#porte-prenom").value.trim(), nom = $("#porte-nom").value.trim(), confirmation = $("#porte-confirmation").value;
    if (!prenom || !nom) return refuser("Indique ton prénom et ton nom.", prenom ? "nom" : "prenom");
    if (!email) return refuser("Renseigne ton adresse e-mail.", "email");
    if (mdp.length < 8) return refuser("Le mot de passe doit contenir au moins 8 caractères.", "mot_de_passe");
    if (mdp !== confirmation) return refuser("Les deux mots de passe ne sont pas identiques.", "confirmation");
    $("#porte-valider").disabled = true;
    const r = await api("POST", "/inscription", { prenom, nom, email, mot_de_passe: mdp, confirmation, langue: window.LANGUE_SITE || "fr",
                                                  site_web: $("#porte-site").value,
                                                  turnstile: window.AntiRobot?.jeton($("#porte-robot")) || "" });
    $("#porte-valider").disabled = false;
    if (!r.ok) window.AntiRobot?.reinitialiser($("#porte-robot"));
    if (!r.ok) return refuser(r.corps.erreur || "Une erreur est survenue. Réessaie.", r.corps.champ);
    $("#porte-mdp").value = $("#porte-confirmation").value = "";
    erreur("#porte-erreur", "");
    try { localStorage.removeItem(CLE_SYNCHRO); } catch { /* stockage indisponible */ }
    await envoyerLocal();        // un CV commencé sur cet appareil rejoint le nouveau compte
    await charger();
    annoncerConnexion();
    message(`Bienvenue ${prenom} ! Ton compte est créé. Un e-mail de confirmation t'a été envoyé.`);
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
  annoncerConnexion();
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
  const prenom = texte(compte.prenom), nom = texte(compte.nom);
  $("#espace-initiale").textContent = (prenom || compte.email)[0].toUpperCase();
  $("#espace-bonjour").textContent = prenom ? `Bonjour ${prenom}` : "Mon espace";
  $("#espace-bonjour").setAttribute("translate", prenom ? "no" : "yes");
  $("#profil-nom").textContent = [prenom, nom].filter(Boolean).join(" ") || "—";
  $("#profil-prenom-champ").value = prenom;
  $("#profil-nom-champ").value = nom;
  $("#espace-email").textContent = compte.email;
  $("#profil-email").textContent = compte.email;
  $("#profil-cree").textContent = date(compte.cree_le);
  $("#profil-vu").textContent = date(compte.vu_le, true);
  afficherConfirmation(!!compte.adresse_confirmee);

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

  // Copie dans une autre langue : la copie s'ouvre dans l'éditeur, déjà convertie.
  const langueDoc = LANGUES_DOC[options.langue] ? options.langue : "fr";
  const copieLangue = el("select", { className: "mini copie-langue" },
    el("option", { value: "" }, "Copier en…"),
    ...Object.entries(LANGUES_DOC).filter(([code]) => code !== langueDoc).map(([code, nomLangue]) => el("option", { value: code }, nomLangue)));
  copieLangue.setAttribute("aria-label", "Copier ce document dans une autre langue");
  copieLangue.addEventListener("change", () => { if (copieLangue.value) copierEnLangue(d, copieLangue.value); copieLangue.value = ""; });

  return el("section", { className: "dossier" },
    el("div", { className: "dossier-tete" },
      el("div", null, nom, el("p", { className: "note dossier-date" }, `Dernier enregistrement : ${date(d.modifie_le, true)}`)),
      el("div", { className: "dossier-actions" },
        bouton("Renommer", () => renommer(d)), bouton("Dupliquer", () => dupliquer(d)), copieLangue,
        bouton("Supprimer", () => supprimer(d)))),
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
      el("div", { className: "doc-actions" }, el("a", { className: "bouton principal", href: ouvrir + "&type=lettre" }, "Modifier"), pdfLettre)),
    ...dessinerAutres(d, donnees, ouvrir),
    dessinerPartage(d, aUnCv));
}

// Les autres documents du même dossier : document administratif, plan de localisation, arbre
// généalogique. Une ligne n'apparaît que si ce document a été commencé.
const CHAMPS_ADMIN = ["declaration", "motif", "precision", "conteste", "arguments", "demarche", "piece_numero"];
function adminCommence(donnees) {
  const a = donnees.admin && typeof donnees.admin === "object" ? donnees.admin : null;
  if (!a) return false;
  const rempli = v => typeof v === "string" && v.trim() !== "";
  return donnees.type === "admin" || a.auto === false || CHAMPS_ADMIN.some(c => rempli(a[c]))
    || ["destinataire", "mandataire", "beneficiaire"].some(c => a[c] && rempli(a[c].nom));
}
function compterPersonnes(p, profondeur = 0) {
  if (!p || typeof p !== "object" || profondeur > 12) return 0;
  return 1 + liste(p.unions).reduce((n, u) => n + (u.conjoint ? 1 : 0)
    + liste(u.enfants).reduce((m, e) => m + compterPersonnes(e, profondeur + 1), 0), 0);
}
function dessinerAutres(d, donnees, ouvrir) {
  const lignes = [];
  // resume : texte saisi par l'utilisateur (jamais traduit) ; detail : texte du site (traduit).
  const ligne = (titre, resume, type, peutTelecharger, detail) => {
    const saisi = el("span", null, resume);
    saisi.setAttribute("translate", "no");
    const r = el("p", null, saisi, ...(detail ? [resume ? " · " : "", el("span", null, detail)] : []));
    const pdf = el("button", { type: "button", className: "bouton" }, "Télécharger le PDF");
    pdf.disabled = !peutTelecharger;
    pdf.addEventListener("click", () => telechargerPdf(d.doc, type, pdf));
    lignes.push(el("div", { className: "doc" },
      el("div", null, el("strong", null, titre), r),
      el("div", { className: "doc-actions" }, el("a", { className: "bouton principal", href: `${ouvrir}&type=${type}` }, "Modifier"), pdf)));
  };
  const a = donnees.admin;
  if (adminCommence(donnees)) {
    ligne("Document administratif", texte(a.titre) || texte(a.objet) || "", "admin", !!texte(a.corps) && !!texte((donnees.cv || {}).nom));
  }
  const p = donnees.plan && typeof donnees.plan === "object" ? donnees.plan : null;
  if (p && liste(p.elements).length) ligne("Plan de localisation", texte(p.sous_titre) || texte(p.titre), "plan", true);
  const racine = donnees.arbre && donnees.arbre.racine;
  if (racine && texte(racine.nom)) {
    const n = compterPersonnes(racine);
    ligne("Arbre généalogique", texte(racine.nom), "arbre", true, n > 1 ? `${n} personnes` : "1 personne");
  }
  return lignes;
}

/** Ce qui part au serveur pour un document administratif (comme documentAdmin() dans l'éditeur). */
function documentAdmin(a) {
  if (!a || typeof a !== "object") return {};
  return ["demande", "reclamation"].includes(a.genre) ? a : { ...a, destinataire: {}, pj: "" };
}

/** Ligne « CV en ligne » d'un document : lien public, QR code, nombre de visites. */
function dessinerPartage(d, aUnCv) {
  const p = d.partage;
  const bouton = (libelle, action, classe) => {
    const b = el("button", { type: "button", className: classe || "mini" }, libelle);
    b.addEventListener("click", () => action(b));
    return b;
  };
  const infos = el("div", null, el("strong", null, "CV en ligne"), " ");
  const actions = el("div", { className: "doc-actions" });
  if (!p) {
    infos.append(el("p", null, "Un lien vers ton CV, à donner à un recruteur ou à imprimer en QR code sur le CV."));
    const activer = bouton("Activer le lien", () => activerPartage(d), "bouton");
    activer.disabled = !aUnCv;
    actions.append(activer);
  } else {
    const lien = el("a", { href: p.url, target: "_blank", rel: "noopener" }, p.url);
    lien.setAttribute("translate", "no");
    infos.append(el("span", { className: "puce-modele partage-actif" }, "Activé"),
      el("p", { className: "partage-lien" }, lien),
      el("p", null, p.vues ? (p.vues > 1 ? `Vu ${p.vues} fois` : "Vu 1 fois") : "Pas encore consulté."));
    // L'image n'est demandée qu'au premier clic (le serveur la fabrique à ce moment-là).
    const qr = el("img", { className: "partage-qr", alt: "QR code du CV en ligne", hidden: true });
    infos.append(qr);
    actions.append(
      bouton("Copier le lien", b => copierLien(p.url, b), "bouton"),
      bouton("QR code", () => { if (!qr.src) qr.src = `/cv/${p.code}/qr`; qr.hidden = !qr.hidden; }, "bouton"),
      el("a", { className: "bouton", href: `/cv/${p.code}/qr`, download: `QR_CV_${p.code}.jpg` }, "Télécharger le QR code"),
      bouton("Désactiver", () => desactiverPartage(d), "bouton"));
  }
  return el("div", { className: "doc doc-partage" }, infos, actions);
}

async function activerPartage(d) {
  if (!confirm(traduit("Ton CV sera visible en ligne par toute personne qui a le lien ou scanne le QR code (nom, coordonnées, photo, parcours). Tu pourras désactiver le lien à tout moment. Continuer ?"))) return;
  const r = await api("POST", `/documents/${d.doc}/partage`, {});
  message(r.ok ? "Le lien est activé. Pour imprimer le QR code sur ton CV, coche la case « Imprimer un QR code » dans l'éditeur (rubrique Apparence)."
               : r.corps.erreur || "Le lien n'a pas pu être créé. Réessaie.");
  await chargerDocuments();
}

async function desactiverPartage(d) {
  if (!confirm(traduit("Désactiver le lien ? La page de ton CV en ligne et le QR code cesseront aussitôt de fonctionner, y compris sur les CV déjà envoyés."))) return;
  const r = await api("DELETE", `/documents/${d.doc}/partage`, {});
  message(r.ok ? "Le lien est désactivé." : r.corps.erreur || "Une erreur est survenue. Réessaie.");
  await chargerDocuments();
}

async function copierLien(url, bouton) {
  try {
    await navigator.clipboard.writeText(url);
    const texte = bouton.textContent;
    bouton.textContent = (window.tr || (t => t))("Lien copié");
    setTimeout(() => { bouton.textContent = texte; }, 2000);
  } catch {
    prompt(traduit("Copie ce lien :"), url);
  }
}

const LANGUES_DOC = { fr: "Français", en: "English", it: "Italiano" };
const SUFFIXES_LANGUE = { fr: "FR", en: "EN", it: "IT" };
async function copierEnLangue(d, langue) {
  message("");
  const nom = `${d.nom.replace(/\s*\((FR|EN|IT)\)$/, "")} (${SUFFIXES_LANGUE[langue]})`.slice(0, 60);
  const r = await api("POST", "/documents", { copie_de: d.doc, nom });
  if (!r.ok) return message(r.corps.erreur || "Copie impossible. Réessaie.");
  location.href = `${window.PREFIXE_SITE || ""}/creer?doc=${r.corps.doc}&langue=${langue}`;
}

async function chargerDocuments() {
  const r = await api("GET", "/documents");
  documents = r.ok ? r.corps.documents : [];
  if (r.ok) $("#docs-maximum").textContent = r.corps.maximum;
  dessinerDocuments();
  if (candidatures.length) dessinerCandidatures();     // noms des documents envoyés
}

// ---------- Gérer ses documents ----------
$("#docs-nouveau").addEventListener("click", async () => {
  message("");
  const nom = prompt(traduit("Nom du nouveau document (par exemple le poste visé) :"), "");
  if (nom === null) return;
  const r = await api("POST", "/documents", { nom });
  if (!r.ok) return message(r.corps.erreur || "Création impossible. Réessaie.");
  location.href = (window.PREFIXE_SITE || "") + "/creer?doc=" + r.corps.doc;
});

async function renommer(d) {
  const nom = prompt(traduit("Nouveau nom du document :"), d.nom);
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
  if (!confirm(traduit("Supprimer définitivement ce document (son CV et sa lettre) ?"))) return;
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

// ---------- Confirmation de l'adresse e-mail ----------
function afficherConfirmation(confirmee) {
  $("#profil-confirmation").textContent = confirmee ? "Confirmée" : "Pas encore confirmée";
  $("#profil-confirmation").className = confirmee ? "statut-ok" : "statut-attente";
  $("#confirmation-renvoyer").hidden = confirmee;
}
$("#confirmation-renvoyer").addEventListener("click", async () => {
  const bouton = $("#confirmation-renvoyer");
  bouton.disabled = true;
  const r = await api("POST", "/confirmation", { langue: window.LANGUE_SITE || "fr" });
  bouton.disabled = false;
  if (r.ok && r.corps.adresse_confirmee) return afficherConfirmation(true);
  message(r.ok ? "Un lien de confirmation vient de t'être envoyé. Pense à regarder dans les courriers indésirables."
               : r.corps.erreur || "Une erreur est survenue. Réessaie.");
});
async function confirmerAdresse() {
  const r = await api("POST", "/confirmer", { jeton: confirmationRecue });
  return r.ok ? "Merci : ton adresse e-mail est confirmée." : r.corps.erreur || "Une erreur est survenue. Réessaie.";
}

async function charger() {
  const confirmation = confirmationRecue ? await confirmerAdresse() : "";
  const r = await api("GET", "");
  $("#espace-attente").hidden = true;
  // Lien reçu par e-mail : on l'utilise, même si un compte est déjà connecté sur cet appareil
  // (sinon le lien serait ignoré et le mot de passe ne pourrait pas être changé).
  const connecte = r.ok && r.corps.connecte && !jetonRecu;
  $("#espace-porte").hidden = connecte;
  $("#espace").hidden = !connecte;
  if (!connecte) {
    afficherPorte();
    if (confirmation) { $("#porte-erreur").textContent = confirmation; $("#porte-erreur").hidden = false; }
    return;
  }
  afficherEspace(r.corps);
  if (confirmation) message(confirmation);
  await chargerDocuments();
  await chargerCandidatures();
  // L'en-tête (entete.js) a pu être dessiné avant la connexion : on le met à jour.
  for (const lien of document.querySelectorAll("a[data-lien-compte]")) {
    const pastille = document.createElement("span");
    pastille.className = "initiale";
    pastille.textContent = r.corps.email[0].toUpperCase();
    lien.replaceChildren(pastille, "Mon espace");
  }
}

// ---------- Suivi des candidatures ----------
const STATUTS = { a_envoyer: "À envoyer", envoyee: "Envoyée", relancee: "Relancée", entretien: "Entretien",
                  acceptee: "Acceptée", refusee: "Refusée" };
const EN_ATTENTE = ["envoyee", "relancee"];            // statuts où une relance a un sens
let candidatures = [];
let candidatureOuverte = null;                         // celle du formulaire (null : nouvelle)

/** Date du jour au format des champs date (AAAA-MM-JJ), à l'heure locale. */
function aujourdhui(decalageJours = 0) {
  const d = new Date();
  d.setDate(d.getDate() + decalageJours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateCourte(iso) {
  if (!iso) return "";
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a, m - 1, j).toLocaleDateString(window.LOCALE_SITE || "fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
const aRelancer = c => EN_ATTENTE.includes(c.statut) && c.relance_le && c.relance_le <= aujourdhui();

async function chargerCandidatures() {
  const r = await api("GET", "/candidatures");
  candidatures = r.ok ? r.corps.candidatures : [];
  dessinerCandidatures();
}

function dessinerCandidatures() {
  const filtre = $("#cand-filtre").value;
  const visibles = candidatures.filter(c => !filtre
    || (filtre === "relancer" && aRelancer(c))
    || (filtre === "en_cours" && !["acceptee", "refusee"].includes(c.statut))
    || (filtre === "terminees" && ["acceptee", "refusee"].includes(c.statut)));
  // À relancer d'abord, puis les plus récentes.
  visibles.sort((a, b) => aRelancer(b) - aRelancer(a) || (b.envoye_le || "").localeCompare(a.envoye_le || "") || b.id - a.id);
  $("#cand-vide").hidden = candidatures.length > 0;
  $("#cand-filtres").hidden = !candidatures.length;
  const nb = statut => candidatures.filter(c => c.statut === statut).length;
  const relances = candidatures.filter(aRelancer).length;
  const morceaux = [candidatures.length > 1 ? `${candidatures.length} candidatures` : "1 candidature"];
  if (nb("entretien")) morceaux.push(nb("entretien") > 1 ? `${nb("entretien")} entretiens` : "1 entretien");
  if (relances) morceaux.push(relances > 1 ? `${relances} à relancer` : "1 à relancer");
  $("#cand-resume").replaceChildren(...morceaux.flatMap((m, i) => (i ? [" · ", el("span", null, m)] : [el("span", null, m)])));
  $("#cand-liste").replaceChildren(...visibles.map(dessinerCandidature));
}

function dessinerCandidature(c) {
  const document_ = documents.find(d => d.doc === c.doc_id);
  const titre = el("strong", { className: "cand-entreprise" }, c.entreprise || c.poste);
  titre.setAttribute("translate", "no");
  const poste = el("span", { className: "cand-poste" }, c.entreprise && c.poste ? c.poste : "");
  poste.setAttribute("translate", "no");
  const details = [];
  if (c.envoye_le) details.push(el("span", null, `Envoyée le ${dateCourte(c.envoye_le)}`));
  if (c.relance_le && EN_ATTENTE.includes(c.statut)) {
    details.push(el("span", { className: aRelancer(c) ? "cand-relance urgente" : "cand-relance" },
      aRelancer(c) ? "À relancer" : `Relance le ${dateCourte(c.relance_le)}`));
  }
  if (document_) {
    const nom = el("span", null, document_.nom);
    nom.setAttribute("translate", "no");
    details.push(el("span", null, "Document : ", nom));
  }
  const ligne = el("div", { className: "cand-details" });
  details.forEach((d, i) => ligne.append(...(i ? [" · ", d] : [d])));
  const tete = el("div", { className: "cand-tete" }, titre, poste);
  if (c.lien) {
    const a = el("a", { href: c.lien, target: "_blank", rel: "noopener nofollow" }, "Voir l'offre");
    tete.append(a);
  }
  const modifier = el("button", { type: "button", className: "mini" }, "Modifier");
  modifier.addEventListener("click", () => ouvrirCandidature(c));
  // Changer le statut d'un geste, sans ouvrir le formulaire.
  const statut = el("select", { className: `mini cand-statut statut-${c.statut}` },
    ...Object.entries(STATUTS).map(([v, libelle]) => el("option", { value: v, selected: v === c.statut }, libelle)));
  statut.setAttribute("aria-label", "Statut de la candidature");
  statut.addEventListener("change", () => enregistrerCandidature({ ...c, statut: statut.value }, c.id));
  const notes = c.notes ? el("p", { className: "cand-notes" }, c.notes) : "";
  if (notes) notes.setAttribute("translate", "no");
  return el("div", { className: "cand" + (aRelancer(c) ? " a-relancer" : "") },
    el("div", { className: "cand-infos" }, tete, ligne, notes),
    el("div", { className: "cand-actions" }, statut, modifier));
}

function ouvrirCandidature(c) {
  candidatureOuverte = c || null;
  const v = c || { entreprise: "", poste: "", lien: "", envoye_le: aujourdhui(), relance_le: aujourdhui(7),
                   statut: "envoyee", doc_id: documents[0] ? documents[0].doc : null, notes: "" };
  $("#cand-titre").textContent = c ? "Modifier la candidature" : "Nouvelle candidature";
  $("#cand-entreprise").value = v.entreprise; $("#cand-poste").value = v.poste; $("#cand-lien").value = v.lien;
  $("#cand-envoye").value = v.envoye_le; $("#cand-relance").value = v.relance_le;
  $("#cand-statut").value = v.statut; $("#cand-notes").value = v.notes;
  const choixDoc = $("#cand-doc");
  choixDoc.replaceChildren(el("option", { value: "" }, "Aucun"), ...documents.map(d => {
    const o = el("option", { value: String(d.doc) }, d.nom);
    o.setAttribute("translate", "no");
    return o;
  }));
  choixDoc.value = v.doc_id ? String(v.doc_id) : "";
  $("#cand-supprimer").hidden = !c;
  erreur("#cand-erreur", "");
  $("#dlg-cand").showModal();
  $("#cand-entreprise").focus();
}

/** Envoie une candidature (nouvelle si « numero » est absent) ; renvoie true si c'est fait. */
async function enregistrerCandidature(valeurs, numero) {
  const corps = { entreprise: valeurs.entreprise, poste: valeurs.poste, lien: valeurs.lien, envoye_le: valeurs.envoye_le,
                  relance_le: valeurs.relance_le, statut: valeurs.statut, notes: valeurs.notes, doc_id: valeurs.doc_id || null };
  const r = numero ? await api("PUT", `/candidatures/${numero}`, corps) : await api("POST", "/candidatures", corps);
  if (!r.ok) {
    if ($("#dlg-cand").open) erreur("#cand-erreur", r.corps.erreur || "Enregistrement impossible. Réessaie.");
    else message(r.corps.erreur || "Enregistrement impossible. Réessaie.");
    return false;
  }
  await chargerCandidatures();
  return true;
}

// Date d'envoi choisie, relance pas encore remplie : on propose 7 jours plus tard.
$("#cand-envoye").addEventListener("change", () => {
  const envoi = $("#cand-envoye").value;
  if (!envoi || $("#cand-relance").value) return;
  const [a, m, j] = envoi.split("-").map(Number);
  const d = new Date(a, m - 1, j + 7);
  $("#cand-relance").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});
$("#cand-nouvelle").addEventListener("click", () => ouvrirCandidature(null));
$("#cand-annuler").addEventListener("click", () => $("#dlg-cand").close());
$("#cand-filtre").addEventListener("change", dessinerCandidatures);
$("#cand-form").addEventListener("submit", async e => {
  e.preventDefault();
  const valeurs = {
    entreprise: $("#cand-entreprise").value.trim(), poste: $("#cand-poste").value.trim(), lien: $("#cand-lien").value.trim(),
    envoye_le: $("#cand-envoye").value, relance_le: $("#cand-relance").value, statut: $("#cand-statut").value,
    notes: $("#cand-notes").value, doc_id: Number($("#cand-doc").value) || null,
  };
  if (!valeurs.entreprise && !valeurs.poste) return erreur("#cand-erreur", "Indique au moins l'entreprise ou le poste.");
  $("#cand-valider").disabled = true;
  const fait = await enregistrerCandidature(valeurs, candidatureOuverte && candidatureOuverte.id);
  $("#cand-valider").disabled = false;
  if (fait) $("#dlg-cand").close();
});
$("#cand-supprimer").addEventListener("click", async () => {
  if (!candidatureOuverte || !confirm(traduit("Supprimer cette candidature de ton suivi ?"))) return;
  const r = await api("DELETE", `/candidatures/${candidatureOuverte.id}`, {});
  if (!r.ok) return erreur("#cand-erreur", r.corps.erreur || "Suppression impossible. Réessaie.");
  $("#dlg-cand").close();
  await chargerCandidatures();
});

// ---------- Télécharger un PDF directement depuis l'espace ----------
async function telechargerPdf(numero, type, bouton) {
  bouton.disabled = true; message("");
  try {
    const d = await api("GET", "/donnees?doc=" + numero);
    if (!d.ok) throw new Error(d.corps.erreur || "Ce document n'a pas pu être chargé.");
    const donnees = d.corps.donnees;
    const r = await fetch("/api/pdf", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, cv: donnees.cv, lettre: donnees.lettre, admin: documentAdmin(donnees.admin),
                             plan: donnees.plan, arbre: donnees.arbre, options: donnees.options }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erreur || "La génération du document a échoué.");
    const nom = texte((donnees.cv || {}).nom).normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "document";
    enregistrer(await r.blob(), { plan: "Plan_de_localisation.pdf", arbre: "Arbre_genealogique.pdf" }[type]
      || `${{ lettre: "Lettre", admin: "Document" }[type] || "CV"}_${nom}.pdf`);
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
// Copie de toutes les données du compte (profil, documents avec photo, liens publics, candidatures) :
// fabriquée par le serveur (GET /api/compte/export), le seul à tout connaître.
$("#donnees-copie").addEventListener("click", async () => {
  const bouton = $("#donnees-copie");
  bouton.disabled = true;
  try {
    const r = await fetch("/api/compte/export", { credentials: "same-origin" });
    if (!r.ok) {
      const corps = await r.json().catch(() => ({}));
      return message(corps.erreur || "Une erreur est survenue. Réessaie.");
    }
    enregistrer(await r.blob(), "mes-donnees-moncvexpress.json");
  } catch {
    message("Connexion impossible. Vérifie ta connexion Internet.");
  } finally {
    bouton.disabled = false;
  }
});

// ---------- Prénom et nom ----------
$("#profil-form").addEventListener("submit", async e => {
  e.preventDefault();
  const prenom = $("#profil-prenom-champ").value.trim(), nom = $("#profil-nom-champ").value.trim();
  if (!prenom || !nom) return erreur("#profil-erreur", "Indique ton prénom et ton nom.");
  const r = await api("PATCH", "/profil", { prenom, nom });
  if (!r.ok) return erreur("#profil-erreur", r.corps.erreur || "Une erreur est survenue. Réessaie.");
  erreur("#profil-erreur", "");
  $("#profil-modifier").open = false;
  const etat = await api("GET", "");
  if (etat.ok) afficherEspace(etat.corps);
  message("Ton prénom et ton nom ont été enregistrés.");
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
  alert(traduit("Ton compte et les documents enregistrés sur nos serveurs ont été supprimés."));
  location.href = (window.PREFIXE_SITE || "") + "/";
});

// ---------- Plusieurs onglets ----------
// Sur ordinateur, le lien reçu par e-mail s'ouvre dans un NOUVEL onglet : c'est lui qui crée le
// compte. Il prévient alors les autres onglets du site (même navigateur), qui se mettent à jour
// au lieu de rester sur « C'est presque fini ». On revérifie aussi quand on revient sur l'onglet.
const CLE_CONNEXION = "cv-saas-connexion";
const canalCompte = "BroadcastChannel" in window ? new BroadcastChannel("cv-express-compte") : null;
function annoncerConnexion() {
  canalCompte?.postMessage("connecte");
  try { localStorage.setItem(CLE_CONNEXION, String(Date.now())); } catch { /* stockage indisponible */ }
}
let verificationEnCours = false;
async function verifierConnexion() {
  if (!$("#espace").hidden || jetonRecu || verificationEnCours) return;
  verificationEnCours = true;
  const r = await api("GET", "");
  if (r.ok && r.corps.connecte && $("#espace").hidden) {
    await charger();
    message("Ton compte est prêt : tu es connecté.");
  }
  verificationEnCours = false;
}
canalCompte?.addEventListener("message", e => { if (e.data === "connecte") verifierConnexion(); });
window.addEventListener("storage", e => { if (e.key === CLE_CONNEXION) verifierConnexion(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifierConnexion(); });

charger();
