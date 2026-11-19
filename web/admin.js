"use strict";
/*
 * Tableau de bord de l'administrateur (/admin). Tout passe par /api/admin…, qui n'existe que
 * pour un compte listé dans le réglage ADMINS. Aucune donnée n'est écrite dans la page avec
 * innerHTML : les adresses e-mail viennent des visiteurs, elles sont toujours insérées comme texte.
 */
const $ = sel => document.querySelector(sel);
let page = 1, total = 0, parPage = 50, recherche = "", aSupprimer = null;

async function api(methode, chemin, corps) {
  try {
    const r = await fetch("/api/admin" + chemin, {
      method: methode, credentials: "same-origin",
      headers: corps ? { "Content-Type": "application/json" } : {},
      body: corps ? JSON.stringify(corps) : undefined,
    });
    return { ok: r.ok, statut: r.status, corps: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, statut: 0, corps: { erreur: "Connexion impossible. Vérifie ta connexion Internet." } };
  }
}
const entier = n => Number(n || 0).toLocaleString("fr-FR");
function taille(octets) {
  const mo = (octets || 0) / 1048576;
  return mo < 1 ? `${Math.max(1, Math.round((octets || 0) / 1024))} ko` : `${mo.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}
function date(secondes) {
  return secondes ? new Date(secondes * 1000).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function message(texte) { $("#admin-message").textContent = texte || ""; $("#admin-message").hidden = !texte; }
function element(nom, texte, classe) {
  const e = document.createElement(nom);
  if (texte !== undefined) e.textContent = texte;
  if (classe) e.className = classe;
  return e;
}

// ---------- Chiffres clés et histogramme ----------
async function chargerResume() {
  const r = await api("GET", "/resume");
  if (!r.ok) { message(r.corps.erreur || "Impossible de charger les chiffres."); return; }
  const d = r.corps;
  $("#t-comptes").textContent = entier(d.comptes);
  $("#t-comptes-aide").textContent = `${entier(d.documents)} document${d.documents > 1 ? "s" : ""} enregistré${d.documents > 1 ? "s" : ""}`
    + (d.inscrits_aujourdhui ? ` · ${entier(d.inscrits_aujourdhui)} aujourd'hui` : "");
  $("#t-inscrits").textContent = `${entier(d.inscrits_7j)} · ${entier(d.inscrits_30j)}`;
  $("#t-actifs").textContent = `${entier(d.actifs_7j)} · ${entier(d.actifs_30j)}`;
  $("#t-attente-texte").textContent = d.invitations_en_attente
    ? `${entier(d.invitations_en_attente)} ancien(s) lien(s) d'inscription encore valable(s).` : "";
  $("#t-base").textContent = d.base;
  const pourcent = Math.min(100, 100 * d.taille_base / d.stockage_max);
  $("#t-stockage").textContent = taille(d.taille_base);
  $("#t-stockage-max").textContent = `${pourcent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % des ${taille(d.stockage_max)} gratuits`;
  $("#t-jauge").value = pourcent;
  $("#t-jauge").textContent = `${Math.round(pourcent)} %`;
  dessinerHistogramme(d.inscriptions);
}

function jourLisible(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function dessinerHistogramme(jours) {
  const zone = $("#histogramme"), bulle = $("#infobulle");
  zone.replaceChildren();
  const max = Math.max(1, ...jours.map(j => j.nombre));
  const totalJours = jours.reduce((s, j) => s + j.nombre, 0);
  zone.setAttribute("aria-label", `Inscriptions par jour sur 30 jours : ${totalJours} au total, ${max} au maximum en un jour.`);
  for (const j of jours) {
    // Zone de survol sur toute la hauteur (plus grande que la barre), barre ancrée en bas.
    const colonne = element("div", undefined, "histo-colonne");
    const barre = element("div", undefined, "histo-barre");
    barre.style.height = j.nombre ? `${Math.max(4, 100 * j.nombre / max)}%` : "0";
    colonne.append(barre);
    const texte = `${jourLisible(j.jour)} : ${j.nombre} inscription${j.nombre > 1 ? "s" : ""}`;
    colonne.tabIndex = 0;
    colonne.setAttribute("aria-label", texte);
    const montrer = () => {
      bulle.textContent = texte; bulle.hidden = false;
      zone.querySelectorAll(".actif").forEach(e => e.classList.remove("actif"));
      colonne.classList.add("actif");
    };
    colonne.addEventListener("mouseenter", montrer);
    colonne.addEventListener("focus", montrer);
    zone.append(colonne);
  }
  zone.addEventListener("mouseleave", () => { bulle.hidden = true; zone.querySelectorAll(".actif").forEach(e => e.classList.remove("actif")); });
  $("#axe-debut").textContent = jourLisible(jours[0].jour);
  $("#axe-fin").textContent = "aujourd'hui";
}

// ---------- Liste des comptes ----------
async function chargerComptes() {
  const r = await api("GET", `/comptes?page=${page}&q=${encodeURIComponent(recherche)}`);
  if (!r.ok) { message(r.corps.erreur || "Impossible de charger les comptes."); return; }
  ({ total, par_page: parPage } = r.corps);
  const corps = $("#comptes");
  corps.replaceChildren();
  for (const c of r.corps.comptes) {
    const ligne = document.createElement("tr");
    const email = element("td", undefined, "email");
    const nomComplet = [c.prenom, c.nom].filter(Boolean).join(" ");
    email.append(element("strong", nomComplet || "(sans nom)", nomComplet ? "personne-nom" : "personne-nom vide"),
                 element("span", c.email, "personne-email"));
    if (c.admin) email.querySelector(".personne-nom").append(" ", element("span", "admin", "puce-modele"));
    ligne.append(email, element("td", date(c.cree_le)), element("td", date(c.vu_le)),
                 element("td", entier(c.documents), "nombre"), element("td", c.volume ? taille(c.volume) : "—", "nombre"));
    const action = element("td", undefined, "actions");
    const ouvrir = element("button", "Ouvrir", "bouton petit");
    ouvrir.type = "button";
    ouvrir.addEventListener("click", () => ouvrirFiche(c.id));
    action.append(ouvrir);
    if (!c.admin) {
      const bouton = element("button", "Supprimer", "bouton petit");
      bouton.type = "button";
      bouton.addEventListener("click", () => demanderSuppression(c));
      action.append(bouton);
    }
    ligne.append(action);
    corps.append(ligne);
  }
  $("#comptes-vide").hidden = total > 0;
  const pages = Math.max(1, Math.ceil(total / parPage));
  $("#page-info").textContent = `${entier(total)} compte${total > 1 ? "s" : ""} · page ${page} sur ${pages}`;
  $("#page-prec").disabled = page <= 1;
  $("#page-suiv").disabled = page >= pages;
}

let minuterie;
$("#recherche").addEventListener("input", e => {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => { recherche = e.target.value.trim(); page = 1; chargerComptes(); }, 300);
});
$("#page-prec").addEventListener("click", () => { page--; chargerComptes(); });
$("#page-suiv").addEventListener("click", () => { page++; chargerComptes(); });

// ---------- Suppression d'un compte ----------
function erreurSuppr(texte) { $("#suppr-erreur").textContent = texte || ""; $("#suppr-erreur").hidden = !texte; }
function demanderSuppression(compte) {
  aSupprimer = compte;
  $("#suppr-email").textContent = compte.email;
  $("#suppr-mdp").value = "";
  erreurSuppr("");
  $("#suppr-dialogue").showModal();
  $("#suppr-mdp").focus();
}
$("#suppr-annuler").addEventListener("click", () => $("#suppr-dialogue").close());
$("#suppr-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!$("#suppr-mdp").value) { erreurSuppr("Indique ton mot de passe."); return; }
  $("#suppr-valider").disabled = true;
  const r = await api("DELETE", `/comptes/${aSupprimer.id}`, { mot_de_passe: $("#suppr-mdp").value });
  $("#suppr-valider").disabled = false;
  if (!r.ok) { erreurSuppr(r.corps.erreur || "Suppression impossible."); return; }
  $("#suppr-dialogue").close();
  message(`Le compte ${aSupprimer.email} a été supprimé.`);
  chargerResume();
  chargerComptes();
});

// ---------- Fiche d'un compte ----------
let ficheCourante = null;
function messageDans(sel, texte) { $(sel).textContent = texte || ""; $(sel).hidden = !texte; }
for (const bouton of document.querySelectorAll("[data-fermer]")) {
  bouton.addEventListener("click", () => bouton.closest("dialog").close());
}

const LIBELLES_PDF = { cv: "CV", lettre: "Lettre", admin: "Document admin.", plan: "Plan", arbre: "Arbre" };

async function ouvrirFiche(numero, garderMessage) {
  const r = await api("GET", `/comptes/${numero}`);
  if (!r.ok) { message(r.corps.erreur || "Impossible d'ouvrir ce compte."); return; }
  const f = ficheCourante = r.corps;
  $("#fiche-numero").textContent = f.id;
  $("#fiche-nom").textContent = [f.prenom, f.nom].filter(Boolean).join(" ") || f.email;
  $("#fiche-email").value = f.email;
  $("#fiche-cree").textContent = date(f.cree_le);
  $("#fiche-vu").textContent = date(f.vu_le);
  if (!garderMessage) messageDans("#fiche-message", f.lien_en_cours ? "Un lien de mot de passe envoyé à ce compte est encore valable." : "");
  const corps = $("#fiche-documents");
  corps.replaceChildren();
  for (const d of f.documents) {
    const ligne = document.createElement("tr");
    const voir = element("button", "Ouvrir", "bouton petit");
    voir.type = "button";
    voir.addEventListener("click", () => ouvrirDocument(d.doc));
    voir.title = "Lire et corriger les données du document";
    const actions = element("td", undefined, "actions");
    actions.append(voir);
    // Les PDF que ce document peut produire : fabriqués à la demande, ouverts dans un nouvel onglet.
    const pdfs = element("td", undefined, "pdfs");
    for (const genre of d.pdf || []) {
      const lien = element("a", LIBELLES_PDF[genre], "bouton petit pdf");
      lien.href = `/api/admin/documents/${d.doc}/pdf?type=${genre}`;
      lien.target = "_blank"; lien.rel = "noopener";
      lien.title = `Ouvrir le PDF (${LIBELLES_PDF[genre]})`;
      pdfs.append(lien);
    }
    if (!(d.pdf || []).length) pdfs.append(element("span", "aucun", "note"));
    ligne.append(element("td", d.nom, "email"), element("td", date(d.modifie_le)), element("td", String(d.version), "nombre"),
                 element("td", taille(d.volume), "nombre"), pdfs, actions);
    corps.append(ligne);
  }
  $("#fiche-vide").hidden = f.documents.length > 0;
  if (!$("#fiche").open) $("#fiche").showModal();
}

$("#fiche-email-form").addEventListener("submit", async e => {
  e.preventDefault();
  const r = await api("PATCH", `/comptes/${ficheCourante.id}`, { email: $("#fiche-email").value });
  messageDans("#fiche-message", r.ok ? "Adresse e-mail enregistrée. Le titulaire se connecte désormais avec celle-ci."
                                      : r.corps.erreur || "Modification impossible.");
  if (r.ok) chargerComptes();
});
$("#fiche-lien").addEventListener("click", async () => {
  if (!confirm(`Envoyer à ${ficheCourante.email} un lien pour choisir un nouveau mot de passe ?`)) return;
  const r = await api("POST", `/comptes/${ficheCourante.id}/lien`, {});
  messageDans("#fiche-message", r.ok ? "Lien envoyé (valable 30 minutes)." : r.corps.erreur || "Envoi impossible.");
});

// ---------- Lecture et correction d'un document ----------
// Formulaire construit d'après le contenu du document : chaque texte devient un champ.
const LIBELLES = {
  cv: "CV", lettre: "Lettre de motivation", options: "Options", nom: "Nom", titre: "Titre", email: "E-mail",
  telephone: "Téléphone", ville: "Ville", profil: "Profil", experiences: "Expériences", poste: "Poste",
  entreprise: "Entreprise", lieu: "Lieu", dates: "Dates", points: "Missions", formations: "Formation",
  diplome: "Diplôme", ecole: "École", details: "Détails", competences: "Compétences", categorie: "Catégorie",
  liste: "Liste", langues: "Langues", langue: "Langue", niveau: "Niveau", interets: "Centres d'intérêt",
  references: "Références", fonction: "Fonction", contact: "Contact", certifications: "Certifications",
  organisme: "Organisme", date: "Date", projets: "Projets", liens: "Liens", label: "Libellé", url: "Adresse web",
  etat_civil: "État civil", date_naissance: "Date de naissance", lieu_naissance: "Lieu de naissance",
  nationalite: "Nationalité", situation: "Situation de famille", permis: "Permis", photo: "Photo",
  objet: "Objet", salutation: "Formule d'appel", formule: "Formule de politesse", pj: "Pièces jointes",
  destinataire: "Destinataire", parties: "Paragraphes", accroche: "Accroche", parcours: "Parcours",
  conclusion: "Conclusion", modele: "Modèle", couleur: "Couleur", certifier: "Mention « Je certifie… »",
};
// Ordre d'affichage des champs : celui du formulaire de l'éditeur (le serveur trie les clés par ordre alphabétique).
const ORDRE = ["cv", "lettre", "options", "nom", "titre", "email", "telephone", "ville", "etat_civil", "date_naissance",
  "lieu_naissance", "nationalite", "situation", "permis", "photo", "profil", "experiences", "poste", "entreprise", "lieu",
  "dates", "points", "formations", "diplome", "ecole", "details", "competences", "categorie", "liste", "langues", "langue",
  "niveau", "certifications", "organisme", "date", "projets", "liens", "label", "url", "interets", "references", "fonction",
  "contact", "destinataire", "objet", "salutation", "parties", "accroche", "parcours", "conclusion", "formule", "pj",
  "modele", "couleur", "certifier"];
function clesOrdonnees(objet) {
  const rang = k => { const i = ORDRE.indexOf(k); return i < 0 ? ORDRE.length : i; };
  return Object.keys(objet).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b));
}
let docCourant = null, brouillon = null;

function champsPour(parent, cle) {
  const valeur = parent[cle];
  const nom = LIBELLES[cle] ?? (/^\d+$/.test(String(cle)) ? `n°${Number(cle) + 1}` : String(cle));
  if (valeur && typeof valeur === "object") {
    const groupe = element("fieldset");
    groupe.append(element("legend", nom));
    if (Array.isArray(valeur)) {
      valeur.forEach((_, i) => {
        const sous = champsPour(valeur, i);
        const retirer = element("button", "Retirer", "bouton petit");
        retirer.type = "button";
        retirer.addEventListener("click", () => { valeur.splice(i, 1); dessinerEditeur(); });
        sous.querySelector("legend")?.append(" ", retirer);
        groupe.append(sous);
      });
      if (valeur.length && typeof valeur[0] === "object") {
        const ajouter = element("button", "Ajouter", "bouton petit");
        ajouter.type = "button";
        ajouter.addEventListener("click", () => {
          valeur.push(Object.fromEntries(Object.keys(valeur[0]).map(k => [k, ""]))); dessinerEditeur();
        });
        groupe.append(ajouter);
      }
    } else {
      for (const k of clesOrdonnees(valeur)) groupe.append(champsPour(valeur, k));
    }
    return groupe;
  }
  const etiquette = element("label", nom);
  if (typeof valeur === "string" && valeur.startsWith("data:image/")) {
    const image = document.createElement("img");
    image.src = valeur; image.alt = "Photo"; image.className = "photo-admin";
    const retirer = element("button", "Retirer la photo", "bouton petit");
    retirer.type = "button";
    retirer.addEventListener("click", () => { parent[cle] = ""; dessinerEditeur(); });
    etiquette.append(image, retirer);
    return etiquette;
  }
  let saisie;
  if (typeof valeur === "boolean") {
    saisie = document.createElement("input"); saisie.type = "checkbox"; saisie.checked = valeur;
    saisie.addEventListener("change", () => { parent[cle] = saisie.checked; });
    etiquette.classList.add("case");
  } else if (typeof valeur === "number") {
    saisie = document.createElement("input"); saisie.type = "number"; saisie.value = valeur;
    saisie.addEventListener("input", () => { parent[cle] = Number(saisie.value); });
  } else {
    const texte = valeur == null ? "" : String(valeur);
    saisie = document.createElement(texte.length > 70 || texte.includes("\n") ? "textarea" : "input");
    if (saisie.tagName === "TEXTAREA") saisie.rows = Math.min(8, 2 + texte.split("\n").length);
    saisie.value = texte;
    saisie.addEventListener("input", () => { parent[cle] = saisie.value; });
  }
  etiquette.append(saisie);
  return etiquette;
}

function dessinerEditeur() {
  const zone = $("#editeur-champs");
  zone.replaceChildren(...clesOrdonnees(brouillon).map(k => champsPour(brouillon, k)));
  $("#editeur-json").value = JSON.stringify(brouillon, null, 2);
}

async function ouvrirDocument(numero) {
  const r = await api("GET", `/documents/${numero}`);
  if (!r.ok) { messageDans("#fiche-message", r.corps.erreur || "Impossible d'ouvrir ce document."); return; }
  docCourant = r.corps;
  brouillon = structuredClone(r.corps.donnees);
  $("#editeur-numero").textContent = docCourant.doc;
  $("#editeur-proprio").textContent = `· ${docCourant.email} · version ${docCourant.version}`;
  $("#editeur-nom").value = docCourant.nom;
  messageDans("#editeur-message", "");
  dessinerEditeur();
  $("#editeur").showModal();
}

$("#editeur-json-appliquer").addEventListener("click", () => {
  try {
    const lu = JSON.parse($("#editeur-json").value);
    if (!lu || typeof lu !== "object" || Array.isArray(lu)) throw new Error();
    brouillon = lu; dessinerEditeur();
    messageDans("#editeur-message", "JSON appliqué. Pense à enregistrer.");
  } catch {
    messageDans("#editeur-message", "Ce texte n'est pas un JSON valide : rien n'a été changé.");
  }
});

$("#editeur-enregistrer").addEventListener("click", async () => {
  const r = await api("PUT", `/documents/${docCourant.doc}`,
                      { donnees: brouillon, nom: $("#editeur-nom").value, version: docCourant.version });
  if (!r.ok) { messageDans("#editeur-message", r.corps.erreur || "Enregistrement impossible."); return; }
  docCourant.version = r.corps.version;
  $("#editeur-proprio").textContent = `· ${docCourant.email} · version ${docCourant.version}`;
  messageDans("#editeur-message", "Corrections enregistrées. Le titulaire les verra à sa prochaine ouverture.");
  if (ficheCourante) ouvrirFiche(ficheCourante.id, true);
});

$("#editeur-supprimer").addEventListener("click", async () => {
  if (!confirm(`Supprimer définitivement le document « ${docCourant.nom} » ?`)) return;
  const r = await api("DELETE", `/documents/${docCourant.doc}`, {});
  if (!r.ok) { messageDans("#editeur-message", r.corps.erreur || "Suppression impossible."); return; }
  $("#editeur").close();
  if (ficheCourante) { await ouvrirFiche(ficheCourante.id, true); messageDans("#fiche-message", "Document supprimé."); }
  chargerResume(); chargerComptes();
});

// ---------- Vue brute des tables ----------
let tablePage = 1;
async function chargerTable() {
  const nom = $("#table-choix").value;
  const r = await api("GET", `/tables/${nom}?page=${tablePage}`);
  if (!r.ok) { message(r.corps.erreur || "Impossible de lire cette table."); return; }
  const t = r.corps;
  const tete = document.createElement("tr");
  tete.append(...t.colonnes.map(c => element("th", c)));
  $("#table-tete").replaceChildren(tete);
  const DATES = new Set(["cree_le", "vu_le", "modifie_le", "expire_le"]);
  $("#table-lignes").replaceChildren(...t.lignes.map(ligne => {
    const tr = document.createElement("tr");
    tr.append(...ligne.map((v, i) => {
      const texte = v === null ? "—" : DATES.has(t.colonnes[i]) ? date(v) : String(v);
      return element("td", texte, t.colonnes[i] === "contenu" ? "contenu" : "");
    }));
    return tr;
  }));
  const pages = Math.max(1, Math.ceil(t.total / t.par_page));
  $("#table-info").textContent = `${entier(t.total)} ligne${t.total > 1 ? "s" : ""} · page ${t.page} sur ${pages}`;
  $("#table-prec").disabled = t.page <= 1;
  $("#table-suiv").disabled = t.page >= pages;
}
$("#table-choix").addEventListener("change", () => { tablePage = 1; chargerTable(); });
$("#table-prec").addEventListener("click", () => { tablePage--; chargerTable(); });
$("#table-suiv").addEventListener("click", () => { tablePage++; chargerTable(); });

// ---------- Utilisation du site ----------
const PARCOURS = [["parcours:editeur", "Ont ouvert l'éditeur"], ["parcours:commence", "Ont commencé à remplir"],
                  ["parcours:apercu", "Ont vu l'aperçu"], ["parcours:telecharger", "Ont cliqué sur Télécharger"],
                  ["parcours:compte_demande", "  dont invités à créer un compte"],
                  ["parcours:telecharge", "Ont téléchargé un PDF"], ["parcours:telecharge_word", "Ont téléchargé un fichier Word"],
                  ["parcours:echec_telechargement", "  Ont eu une erreur au téléchargement"]];
let periodeParcours = 7;

function dessinerParcours() {
  const etapes = PARCOURS.filter(([, l]) => !l.startsWith("  ")).map(([cle, libelle]) => [libelle, somme(compteurs[cle], periodeParcours)]);
  const max = Math.max(1, etapes[0][1]);
  $("#barres-parcours").replaceChildren(...etapes.map(([libelle, n], i) => {
    const li = element("li");
    const barre = element("span", undefined, "barre-remplie");
    barre.style.width = n ? `${Math.max(2, 100 * n / max)}%` : "0";
    const fond = element("span", undefined, "barre-fond");
    fond.append(barre);
    const avant = i && i < 5 ? etapes[i - 1][1] : 0;          // le Word se compare au même « avant » que le PDF
    const avantWord = i === 5 ? etapes[3][1] : avant;
    const pourcent = avantWord ? ` (${Math.round(100 * n / avantWord)} %)` : "";
    li.append(element("span", libelle, "barre-nom"), fond, element("strong", entier(n) + pourcent, "barre-valeur"));
    return li;
  }));
  const demandes = somme(compteurs["parcours:compte_demande"], periodeParcours);
  const echecs = somme(compteurs["parcours:echec_telechargement"], periodeParcours);
  const textes = [];
  if (demandes) textes.push(`${entier(demandes)} visite${demandes > 1 ? "s" : ""} invitée${demandes > 1 ? "s" : ""} à créer un compte avant de télécharger.`);
  if (echecs) textes.push(`${entier(echecs)} visite${echecs > 1 ? "s" : ""} avec une erreur au téléchargement : voir « Échecs de fabrication » dans toutes les statistiques.`);
  $("#parcours-echecs").textContent = textes.join(" ");
  $("#parcours-echecs").hidden = !textes.length;
  for (const b of document.querySelectorAll("[data-periode-parcours]")) b.setAttribute("aria-pressed", String(+b.dataset.periodeParcours === periodeParcours));
}
for (const b of document.querySelectorAll("[data-periode-parcours]")) {
  b.addEventListener("click", () => { periodeParcours = +b.dataset.periodeParcours; dessinerParcours(); });
}
// [titre du groupe, [[clé, libellé], …]] ; les clés inconnues (nouvelles pages…) vont dans « Autres ».
const GROUPES_USAGE = [
  ["PDF fabriqués", [["pdf:cv", "CV"], ["pdf:cv_avec_qr", "  dont avec QR code"], ["pdf:lettre", "Lettres de motivation"],
                     ["pdf:admin", "Documents administratifs"], ["pdf:plan", "Plans de localisation"], ["pdf:arbre", "Arbres généalogiques"]]],
  ["Fichiers Word téléchargés", [["docx:cv", "CV"], ["docx:lettre", "Lettres de motivation"], ["docx:admin", "Documents administratifs"]]],
  ["Parcours dans l'éditeur (une fois par visite)", PARCOURS],
  ["Échecs de fabrication", [["echec:fabriquer_le_pdf:compilation", "PDF : erreur de compilation"],
                             ["echec:fabriquer_le_pdf:occupe", "PDF : serveur occupé"],
                             ["echec:fabriquer_le_pdf:imprevue", "PDF : erreur imprévue"],
                             ["echec:fabriquer_le_docx:imprevue", "Word : erreur imprévue"],
                             ["echec:apercu:compilation", "Aperçu : erreur de compilation"],
                             ["echec:apercu:occupe", "Aperçu : serveur occupé"]]],
  ["Langue des CV et lettres", [["langue_document:fr", "Français"], ["langue_document:en", "Anglais"], ["langue_document:it", "Italien"]]],
  ["Autres actions", [["import:cv", "CV importés"], ["import:lettre", "Lettres importées"], ["cv_en_ligne:vue", "CV en ligne consultés"],
                      ["contact", "Messages de contact"]]],
  ["Visites par langue du site", [["langue_site:fr", "Français"], ["langue_site:en", "Anglais"], ["langue_site:it", "Italien"]]],
];
const TYPES_DOCUMENTS = [["pdf:cv", "CV"], ["pdf:lettre", "Lettres de motivation"], ["pdf:admin", "Documents administratifs"],
                         ["pdf:plan", "Plans de localisation"], ["pdf:arbre", "Arbres généalogiques"]];
let compteurs = {}, periode = 7;
const somme = (serie, n) => (serie || []).slice(-n).reduce((a, b) => a + b, 0);
const sommeCles = (filtre, n) => Object.keys(compteurs).filter(filtre).reduce((s, c) => s + somme(compteurs[c], n), 0);

function dessinerBarres() {
  const valeurs = TYPES_DOCUMENTS.map(([cle, libelle]) => [libelle, somme(compteurs[cle], periode)]);
  const max = Math.max(1, ...valeurs.map(v => v[1]));
  $("#barres-vide").hidden = valeurs.some(v => v[1] > 0);
  $("#barres-documents").replaceChildren(...valeurs.map(([libelle, n]) => {
    const li = element("li");
    const barre = element("span", undefined, "barre-remplie");
    barre.style.width = n ? `${Math.max(2, 100 * n / max)}%` : "0";
    const fond = element("span", undefined, "barre-fond");
    fond.append(barre);
    li.append(element("span", libelle, "barre-nom"), fond, element("strong", entier(n), "barre-valeur"));
    return li;
  }));
  for (const b of document.querySelectorAll("[data-periode]")) b.setAttribute("aria-pressed", String(+b.dataset.periode === periode));
}
for (const b of document.querySelectorAll("[data-periode]")) {
  b.addEventListener("click", () => { periode = +b.dataset.periode; dessinerBarres(); });
}

async function chargerUsage() {
  const r = await api("GET", "/utilisation");
  if (!r.ok) return;
  const { cles } = r.corps;
  compteurs = cles;
  const pdfJour = sommeCles(c => c.startsWith("pdf:") && c !== "pdf:cv_avec_qr", 1);
  $("#t-pdf").textContent = entier(pdfJour);
  $("#t-pdf-aide").textContent = `aujourd'hui · ${entier(sommeCles(c => c.startsWith("pdf:") && c !== "pdf:cv_avec_qr", 7))} sur 7 jours`;
  $("#t-visites").textContent = entier(sommeCles(c => c.startsWith("page:"), 1));
  const robots = sommeCles(c => c.startsWith("robot:"), 1);
  $("#t-visites-aide").textContent = `pages vues par des personnes aujourd'hui · ${entier(sommeCles(c => c.startsWith("page:"), 7))} sur 7 jours`
    + (robots ? ` · ${entier(robots)} visite${robots > 1 ? "s" : ""} de robots en plus` : "");
  dessinerBarres();
  dessinerParcours();
  const lignes = [];
  const ajouter = (libelle, serie, classe) => {
    const tr = element("tr", undefined, classe);
    tr.append(element("th", libelle), ...[1, 7, 30].map(n => element("td", entier(somme(serie, n)))));
    lignes.push(tr);
  };
  const connues = new Set();
  for (const [titre, liste] of GROUPES_USAGE) {
    const tete = element("tr", undefined, "usage-groupe");
    tete.append(Object.assign(element("th", titre), { colSpan: 4 }));
    lignes.push(tete);
    for (const [cle, libelle] of liste) { connues.add(cle); ajouter(libelle, cles[cle], libelle.startsWith("  ") ? "usage-detail" : ""); }
  }
  const pages = Object.keys(cles).filter(c => c.startsWith("page:")).sort((a, b) => somme(cles[b], 30) - somme(cles[a], 30));
  if (pages.length) {
    const tete = element("tr", undefined, "usage-groupe");
    tete.append(Object.assign(element("th", "Pages vues par des personnes"), { colSpan: 4 }));
    lignes.push(tete);
    for (const cle of pages) { connues.add(cle); ajouter(cle.slice(5) === "accueil" ? "Accueil" : cle.slice(5) === "creer" ? "Éditeur" : "/" + cle.slice(5), cles[cle]); }
  }
  const robotsCles = Object.keys(cles).filter(c => c.startsWith("robot:")).sort((a, b) => somme(cles[b], 30) - somme(cles[a], 30));
  if (robotsCles.length) {
    const tete = element("tr", undefined, "usage-groupe");
    tete.append(Object.assign(element("th", "Robots (moteurs de recherche, surveillance, aperçus de liens…)"), { colSpan: 4 }));
    lignes.push(tete);
    for (const cle of robotsCles) { connues.add(cle); ajouter(cle.slice(6), cles[cle]); }
  }
  for (const cle of Object.keys(cles).filter(c => !connues.has(c)).sort()) ajouter(cle, cles[cle]);
  $("#usage").replaceChildren(...lignes);
}

const aujourdhui = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
$("#admin-date").textContent = aujourdhui.charAt(0).toUpperCase() + aujourdhui.slice(1);
$("#admin-actualiser").addEventListener("click", () => { message(""); chargerResume(); chargerUsage(); chargerComptes(); chargerTable(); });

chargerResume();
chargerUsage();
chargerComptes();
chargerTable();
