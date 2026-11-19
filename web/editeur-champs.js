"use strict";
// Éditeur (page /creer), partie 2/5 : Champs du formulaire : champs simples, listes répétables, dates, photo.
// Les cinq fichiers editeur-*.js se chargent dans l'ordre (voir creer.html) et partagent leurs
// variables : ce qui est déclaré dans un fichier sert dans les suivants.

// ---------- Champs simples : data-k="cv.etat_civil.permis" ----------
function lire(chemin) {
  return chemin.split(".").reduce((o, c) => (o == null ? undefined : o[c]), etat);
}
function ecrire(chemin, valeur) {
  const cles = chemin.split(".");
  const derniere = cles.pop();
  let o = etat;
  for (const c of cles) o = o[c] ??= {};
  o[derniere] = valeur;
}
function remplirChamps() {
  for (const el of $$("[data-k]")) {
    const v = lire(el.dataset.k);
    if (el.type === "checkbox") el.checked = v === true;
    else if (el.type === "radio") el.checked = v === el.value;
    else el.value = v ?? "";
  }
}

// ---------- Listes répétables ----------
function dessinerListe(nom) {
  const conteneur = $(`[data-liste="${nom}"]`);
  const { nom: libelle, champs } = LISTES[nom];
  const elements = etat.cv[nom];
  conteneur.replaceChildren();

  elements.forEach((element, i) => {
    const carte = document.createElement("div");
    carte.className = "element";

    const tete = document.createElement("div");
    tete.className = "element-tete";
    const titre = document.createElement("span");
    titre.textContent = `${libelle} ${i + 1}`;
    const actions = document.createElement("div");
    const bouton = (texte, aide, action, inactif) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "mini"; b.textContent = texte;
      b.title = aide; b.setAttribute("aria-label", `${aide} : ${libelle} ${i + 1}`);
      b.disabled = !!inactif;
      b.addEventListener("click", () => { action(); dessinerListe(nom); modifie(); });
      actions.append(b);
    };
    bouton("↑", "Monter", () => elements.splice(i - 1, 0, elements.splice(i, 1)[0]), i === 0);
    bouton("↓", "Descendre", () => elements.splice(i + 1, 0, elements.splice(i, 1)[0]), i === elements.length - 1);
    bouton("Supprimer", "Supprimer", () => elements.splice(i, 1));
    tete.append(titre, actions);

    const grille = document.createElement("div");
    grille.className = "grille";
    for (const [champ, texte, type] of champs) {
      const label = document.createElement("label");
      label.textContent = texte;
      const [genre, liste] = (type || "").split(":");
      if (genre === "periode") {
        label.className = "large";
        label.append(champPeriode(element, champ));
        grille.append(label);
        continue;
      }
      const saisie = document.createElement(genre === "textarea" ? "textarea" : genre === "choix" ? "select" : "input");
      if (genre === "textarea") { saisie.rows = 4; label.className = "large"; }
      if (genre === "choix") {
        remplirMenu(saisie, liste, element[champ]);
      } else {
        saisie.maxLength = genre === "textarea" ? 3000 : 300;
        saisie.value = element[champ] ?? "";
        if (genre === "suggere") brancherSuggestions(saisie, liste);
      }
      saisie.addEventListener("input", () => { element[champ] = saisie.value; modifie(genre === "choix" ? 0 : 1200); });
      label.append(saisie);
      grille.append(label);
    }
    carte.append(tete, grille);
    conteneur.append(carte);
  });

  const ajouter = document.createElement("button");
  ajouter.type = "button"; ajouter.className = "ajouter";
  ajouter.textContent = `+ Ajouter : ${libelle.toLowerCase()}`;
  ajouter.addEventListener("click", () => {
    elements.push({});
    dessinerListe(nom);
    conteneur.querySelector(".element:last-of-type input")?.focus();
  });
  conteneur.append(ajouter);
}

// ---------- Dates : mois et année choisis dans des listes ----------
// Le texte enregistré reste une simple chaîne (« janv. 2024 – aujourd'hui »), dans la langue du
// document : les modèles l'impriment tel quel. Un texte non reconnu (importé, ou écrit à la main)
// est gardé et reste modifiable en saisie libre.
const MOIS = {
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  it: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
};
const AUJOURDHUI = { fr: "aujourd'hui", en: "Present", it: "oggi" };
const simplifier = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\./g, "");
// Noms de mois reconnus (abrégés et complets, trois langues) -> numéro du mois.
const NUMERO_MOIS = (() => {
  const complets = {
    fr: ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"],
    en: ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"],
    it: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  };
  const table = {};
  for (const l of ["fr", "en", "it"]) {
    MOIS[l].forEach((m, i) => { table[simplifier(m)] = i + 1; });
    complets[l].forEach((m, i) => { table[m] = i + 1; });
  }
  Object.assign(table, { janv: 1, fevr: 2, juil: 7, sept: 9, sep: 9 });
  return table;
})();
const MOT_AUJOURDHUI = /^(aujourd'?hui|present|en cours|actuel(lement)?|ce jour|now|today|current|oggi|in corso|attuale|presente)$/;

/** « 03/2021 », « mars 2021 », « 2021 » -> { mois, annee } ; null si non reconnu. */
function lireDate(texte) {
  let m = texte.trim().match(/^(\d{1,2})[/.-](\d{4})$/);      // avant simplifier(), qui retire les points
  const t = simplifier(texte.trim());
  if (m && +m[1] >= 1 && +m[1] <= 12) return { mois: +m[1], annee: +m[2] };
  m = t.match(/^([a-z]+)\s+(\d{4})$/);
  if (m && NUMERO_MOIS[m[1]]) return { mois: NUMERO_MOIS[m[1]], annee: +m[2] };
  m = t.match(/^(\d{4})$/);
  return m ? { mois: 0, annee: +m[1] } : null;
}
/** Texte d'une période -> { debut, fin, enCours } ; null si non reconnu. Vide -> période vide. */
function lirePeriode(texte) {
  const vide = { debut: { mois: 0, annee: 0 }, fin: { mois: 0, annee: 0 }, enCours: false };
  if (!(texte || "").trim()) return vide;
  const t = texte.trim().replace(/^(depuis|since|dal|da)\s+/i, "");
  // Séparateurs : tiret long, tiret entouré d'espaces ou placé juste après une année, « à », « au », « to », « al ».
  const morceaux = t.split(/\s*[–—]\s*|\s+-\s+|(?<=\d{4})\s*-\s*|\s+(?:à|au|a|to|al|until)\s+/i).filter(Boolean);
  if (morceaux.length === 0 || morceaux.length > 2) return null;
  const debut = lireDate(morceaux[0]);
  if (!debut) return null;
  if (morceaux.length === 1) return { ...vide, debut, enCours: /^(depuis|since|dal|da)\s/i.test(texte.trim()) };
  if (MOT_AUJOURDHUI.test(simplifier(morceaux[1]))) return { ...vide, debut, enCours: true };
  const fin = lireDate(morceaux[1]);
  return fin ? { debut, fin, enCours: false } : null;
}
function ecrireDate(d, langue) {
  if (!d.annee) return "";
  return d.mois ? `${MOIS[langue][d.mois - 1]} ${d.annee}` : String(d.annee);
}
function ecrirePeriode(p, langue) {
  const debut = ecrireDate(p.debut, langue);
  const fin = p.enCours ? AUJOURDHUI[langue] : ecrireDate(p.fin, langue);
  if (!debut) return fin && !p.enCours ? fin : "";
  return fin && fin !== debut ? `${debut} – ${fin}` : debut;
}

function champPeriode(element, champ) {
  const langue = () => (MOIS[etat.options.langue] ? etat.options.langue : "fr");
  const t = window.tr || (x => x);
  const zone = document.createElement("div");
  zone.className = "periode";
  const libre = document.createElement("input");
  libre.maxLength = 120; libre.value = element[champ] ?? ""; libre.className = "periode-libre";
  libre.placeholder = t("Ex. : de 2019 à 2021, été 2023…");
  const menu = (options, valeur, aide) => {
    const s = document.createElement("select");
    s.setAttribute("aria-label", aide); s.setAttribute("translate", "no");
    s.replaceChildren(...options.map(([v, texte]) => new Option(texte, v)));
    s.value = String(valeur);
    return s;
  };
  const maintenant = new Date().getFullYear();
  const annees = [[0, t("Année")], ...Array.from({ length: maintenant + 6 - 1960 }, (_, i) => [maintenant + 5 - i, String(maintenant + 5 - i)])];
  const mois = () => [[0, t("Mois")], ...MOIS[langue()].map((m, i) => [i + 1, m])];
  const p = lirePeriode(element[champ]) || null;
  const lu = p || lirePeriode("");
  const dm = menu(mois(), lu.debut.mois, t("Mois de début")), da = menu(annees, lu.debut.annee, t("Année de début"));
  const fm = menu(mois(), lu.fin.mois, t("Mois de fin")), fa = menu(annees, lu.fin.annee, t("Année de fin"));
  const encours = document.createElement("input"); encours.type = "checkbox"; encours.checked = lu.enCours;
  const caseEnCours = document.createElement("label"); caseEnCours.className = "case periode-encours";
  caseEnCours.append(encours, " " + t("en cours"));
  const ligne = (texte, ...enfants) => {
    const span = document.createElement("span"); span.className = "periode-ligne";
    const mot = document.createElement("span"); mot.className = "periode-mot"; mot.textContent = texte;
    span.append(mot, ...enfants); return span;
  };
  const choisir = document.createElement("div"); choisir.className = "periode-choix";
  const finLigne = ligne(t("à"), fm, fa, caseEnCours);
  choisir.append(ligne(t("De"), dm, da), finLigne);
  const bascule = document.createElement("button");
  bascule.type = "button"; bascule.className = "lien periode-bascule";
  let modeLibre = !p;            // texte non reconnu : on ne le transforme pas
  const afficher = () => {
    choisir.hidden = modeLibre; libre.hidden = !modeLibre;
    bascule.textContent = modeLibre ? t("Choisir dans les listes") : t("Écrire librement");
    fm.disabled = fa.disabled = encours.checked;
  };
  const depuisListes = () => {
    element[champ] = ecrirePeriode({ debut: { mois: +dm.value, annee: +da.value }, fin: { mois: +fm.value, annee: +fa.value },
                                     enCours: encours.checked }, langue());
    libre.value = element[champ];
    fm.disabled = fa.disabled = encours.checked;
    modifie(0);
  };
  for (const s of [dm, da, fm, fa, encours]) s.addEventListener("change", depuisListes);
  libre.addEventListener("input", () => { element[champ] = libre.value; modifie(1200); });
  bascule.addEventListener("click", () => {
    if (modeLibre) {
      const relu = lirePeriode(libre.value);
      if (!relu && libre.value.trim() && !confirm(t("Ce texte ne peut pas être converti en mois et années : l'effacer pour choisir dans les listes ?"))) return;
      const q = relu || lirePeriode("");
      [dm.value, da.value, fm.value, fa.value] = [q.debut.mois, q.debut.annee, q.fin.mois, q.fin.annee].map(String);
      encours.checked = q.enCours;
      modeLibre = false; depuisListes();
    } else {
      modeLibre = true;
    }
    afficher();
  });
  afficher();
  zone.append(choisir, libre, bascule);
  return zone;
}

// ---------- Photo : réduite dans le navigateur avant envoi ----------
function afficherPhoto() {
  const img = $("#photo-apercu");
  img.hidden = !etat.cv.photo;
  $("#photo-retirer").hidden = $("#photo-recadrer").hidden = !etat.cv.photo;
  if (etat.cv.photo) img.src = etat.cv.photo;
}

// Recadrage : la photo est cadrée au format portrait 4:5 (celui des modèles), puis enregistrée
// en 480 × 600 pixels. On peut la déplacer à la souris, au doigt ou avec les flèches, et zoomer.
const RECADRAGE = { image: null, zoom: 1, x: 0, y: 0 };
const TOILE = $("#recadrage-toile");
function echelleMin() {
  return Math.max(TOILE.width / RECADRAGE.image.width, TOILE.height / RECADRAGE.image.height);
}
function borner() {
  const e = echelleMin() * RECADRAGE.zoom;
  const largeur = RECADRAGE.image.width * e, hauteur = RECADRAGE.image.height * e;
  RECADRAGE.x = Math.min(0, Math.max(TOILE.width - largeur, RECADRAGE.x));
  RECADRAGE.y = Math.min(0, Math.max(TOILE.height - hauteur, RECADRAGE.y));
}
function dessinerRecadrage(guide = true) {
  const ctx = TOILE.getContext("2d");
  const e = echelleMin() * RECADRAGE.zoom;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, TOILE.width, TOILE.height);
  ctx.drawImage(RECADRAGE.image, RECADRAGE.x, RECADRAGE.y, RECADRAGE.image.width * e, RECADRAGE.image.height * e);
  if (!guide) return;
  // Repères : le cercle du modèle Moderne et l'ovale où placer le visage.
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.arc(TOILE.width / 2, TOILE.height / 2, TOILE.width / 2 - 4, 0, 2 * Math.PI); ctx.stroke();
  ctx.restore();
}
function ouvrirRecadrage(image) {
  Object.assign(RECADRAGE, { image, zoom: 1 });
  const e = echelleMin();
  RECADRAGE.x = (TOILE.width - image.width * e) / 2;
  RECADRAGE.y = (TOILE.height - image.height * e) / 2;
  $("#recadrage-zoom").value = 100;
  dessinerRecadrage();
  $("#dlg-photo").showModal();
}
function zoomer(nouveau) {
  // Le zoom garde le centre de la photo au centre du cadre.
  const avant = echelleMin() * RECADRAGE.zoom;
  const cx = (TOILE.width / 2 - RECADRAGE.x) / avant, cy = (TOILE.height / 2 - RECADRAGE.y) / avant;
  RECADRAGE.zoom = nouveau;
  const apres = echelleMin() * nouveau;
  RECADRAGE.x = TOILE.width / 2 - cx * apres;
  RECADRAGE.y = TOILE.height / 2 - cy * apres;
  borner(); dessinerRecadrage();
}
$("#recadrage-zoom").addEventListener("input", e => zoomer(e.target.value / 100));
let glisse = null;
TOILE.addEventListener("pointerdown", e => { glisse = { x: e.clientX, y: e.clientY }; TOILE.setPointerCapture(e.pointerId); });
TOILE.addEventListener("pointermove", e => {
  if (!glisse) return;
  const facteur = TOILE.width / TOILE.getBoundingClientRect().width;      // la toile est affichée plus petite
  RECADRAGE.x += (e.clientX - glisse.x) * facteur; RECADRAGE.y += (e.clientY - glisse.y) * facteur;
  glisse = { x: e.clientX, y: e.clientY };
  borner(); dessinerRecadrage();
});
TOILE.addEventListener("pointerup", () => { glisse = null; });
TOILE.addEventListener("wheel", e => {
  e.preventDefault();
  const z = Math.min(4, Math.max(1, RECADRAGE.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  $("#recadrage-zoom").value = Math.round(z * 100); zoomer(z);
}, { passive: false });
TOILE.addEventListener("keydown", e => {
  const pas = { ArrowLeft: [20, 0], ArrowRight: [-20, 0], ArrowUp: [0, 20], ArrowDown: [0, -20] }[e.key];
  if (!pas) return;
  e.preventDefault();
  RECADRAGE.x += pas[0]; RECADRAGE.y += pas[1]; borner(); dessinerRecadrage();
});
$("#recadrage-annuler").addEventListener("click", () => $("#dlg-photo").close());
$("#recadrage-valider").addEventListener("click", () => {
  dessinerRecadrage(false);                           // sans les repères
  etat.cv.photo = TOILE.toDataURL("image/jpeg", 0.88);
  $("#dlg-photo").close();
  afficherPhoto(); modifie();
});

$("#photo-fichier").addEventListener("change", async e => {
  const fichier = e.target.files[0];
  e.target.value = "";
  if (!fichier) return;
  try {
    ouvrirRecadrage(await createImageBitmap(fichier));
  } catch {
    montrerErreur("Impossible de lire cette image (JPEG ou PNG uniquement).");
  }
});
$("#photo-recadrer").addEventListener("click", async () => {
  try {
    const image = new Image();
    image.src = etat.cv.photo;
    await image.decode();
    ouvrirRecadrage(await createImageBitmap(image));
  } catch {
    montrerErreur("Impossible de recadrer cette photo : choisis-la à nouveau.");
  }
});
$("#photo-retirer").addEventListener("click", () => { etat.cv.photo = ""; afficherPhoto(); modifie(); });
