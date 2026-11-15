"use strict";
/*
 * Éditeur : formulaire -> état (objet JS) -> POST /api/apercu (images) et /api/pdf (téléchargement).
 * L'état est sauvegardé dans le navigateur (localStorage). Si le visiteur a créé un compte
 * (facultatif, voir la fin du fichier), il est aussi enregistré sur le serveur.
 */

const CLE_STOCKAGE = "cv-saas-v1";
// Langue du site (définie par traductions.js d'après l'adresse : /en/…, /it/…) : c'est aussi
// la langue proposée par défaut pour le document.
const LANGUE_SITE = window.LANGUE_SITE || "fr";
// Compte (facultatif, voir la fin du fichier). Déclaré ici car sauvegarder() s'en sert.
const CLE_SYNCHRO = "cv-saas-synchro";   // { vu: date de la version du compte déjà vue ici, sale: modifié depuis }
let compte = { connecte: false, email: null };
let modeInscription = false;
let minuterieEnvoi = null;
const MODELES = ["moderne", "classique", "europeen", "africain"];

// Description des listes répétables : [champ, libellé, type]
const LISTES = {
  experiences: { nom: "Expérience", champs: [
    ["poste", "Poste"], ["entreprise", "Entreprise"], ["lieu", "Lieu"],
    ["dates", "Dates (ex. 08/2026 – 10/2026)"],
    ["points", "Missions et résultats (un par ligne)", "textarea"]] },
  formations: { nom: "Formation", champs: [
    ["diplome", "Diplôme", "suggere:diplomes"], ["ecole", "Établissement"], ["dates", "Dates"],
    ["details", "Détails (mention, matières…)"]] },
  competences: { nom: "Compétence", champs: [
    ["categorie", "Catégorie (ex. Informatique)", "suggere:categories"], ["liste", "Compétences"]] },
  langues: { nom: "Langue", champs: [
    ["langue", "Langue", "suggere:langues"], ["niveau", "Niveau", "choix:niveaux"]] },
  certifications: { nom: "Certification", champs: [
    ["titre", "Intitulé (ex. TOEIC 750, permis cariste)"], ["organisme", "Organisme"], ["date", "Année"]] },
  projets: { nom: "Projet", champs: [
    ["titre", "Nom du projet"], ["dates", "Dates"],
    ["details", "Ce que tu as fait, et le résultat", "textarea"]] },
  liens: { nom: "Lien", champs: [["label", "Texte affiché", "suggere:liens"], ["url", "Adresse (URL)"]] },
  references: { nom: "Référence", champs: [
    ["nom", "Nom"], ["fonction", "Fonction et entreprise"], ["contact", "Téléphone ou e-mail"]] },
};

// Listes de choix proposées dans le formulaire, dans la langue DU DOCUMENT (pas celle du site) :
// ce qui est choisi est imprimé tel quel sur le CV. Les trois langues gardent le même ordre,
// ce qui permet de convertir un choix quand on change la langue du document.
//   « choix:… »   = liste fermée (menu déroulant) ;
//   « suggere:… » = propositions, mais on peut taper autre chose (une langue locale, par exemple).
const CHOIX = {
  fr: {
    niveaux: ["Langue maternelle", "Bilingue", "Courant", "C2 – Maîtrise", "C1 – Autonome", "B2 – Avancé",
              "B1 – Intermédiaire", "A2 – Élémentaire", "A1 – Débutant", "Notions"],
    langues: ["Français", "Anglais", "Italien", "Espagnol", "Portugais", "Allemand", "Arabe", "Chinois", "Russe",
              "Néerlandais", "Turc", "Wolof", "Pulaar (peul)", "Sérère", "Bambara", "Dioula", "Mooré", "Ewe", "Fon",
              "Yoruba", "Haoussa", "Igbo", "Lingala", "Kikongo", "Swahili", "Sango", "Fang", "Ewondo", "Douala",
              "Bassa", "Baoulé", "Bété", "Malgache", "Kinyarwanda", "Kirundi", "Amharique", "Somali", "Tamazight"],
    situations: ["Célibataire", "Marié(e)", "Pacsé(e) / en union libre", "Divorcé(e)", "Veuf / Veuve"],
    permis: ["B", "A", "A et B", "B et C", "C", "D", "Aucun"],
    nationalites: ["Sénégalaise", "Ivoirienne", "Camerounaise", "Malienne", "Burkinabè", "Togolaise", "Béninoise",
                   "Guinéenne", "Nigérienne", "Tchadienne", "Gabonaise", "Congolaise", "Congolaise (RDC)",
                   "Centrafricaine", "Mauritanienne", "Malgache", "Rwandaise", "Burundaise", "Marocaine", "Algérienne",
                   "Tunisienne", "Nigériane", "Ghanéenne", "Française", "Italienne", "Belge", "Suisse", "Canadienne"],
    diplomes: ["CEPE", "BEPC", "CAP", "BEP", "Baccalauréat", "BT (Brevet de technicien)", "BTS", "DUT", "Licence",
               "Licence professionnelle", "Master", "Diplôme d'ingénieur", "Doctorat", "Attestation de formation"],
    categories: ["Informatique", "Bureautique", "Langages", "Outils", "Comptabilité", "Gestion", "Communication",
                 "Commerce et vente", "Techniques", "Qualités personnelles"],
    liens: ["LinkedIn", "GitHub", "Portfolio", "Site web", "Behance"],
    salutations: ["Madame, Monsieur,", "Madame,", "Monsieur,", "Madame la Directrice,", "Monsieur le Directeur,",
                  "Madame la Responsable des ressources humaines,", "Monsieur le Responsable des ressources humaines,"],
    formules: ["Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
               "Dans l'attente de votre réponse, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
               "Veuillez recevoir, Madame, Monsieur, mes salutations respectueuses.",
               "Je vous prie de croire, Madame, Monsieur, à l'assurance de ma considération distinguée."],
    interets: ["Football", "Basket-ball", "Course à pied", "Natation", "Musculation", "Arts martiaux", "Danse",
               "Lecture", "Écriture", "Musique", "Chant", "Cinéma", "Photographie", "Dessin et peinture", "Cuisine",
               "Voyages", "Bénévolat associatif", "Engagement communautaire", "Jeux vidéo", "Échecs", "Jardinage",
               "Informatique et nouvelles technologies", "Entrepreneuriat", "Mode", "Théâtre"],
    pieces: ["Curriculum vitae", "CV et copies des diplômes", "CV, diplômes et attestations de travail"],
  },
  en: {
    niveaux: ["Native speaker", "Bilingual", "Fluent", "C2 – Proficient", "C1 – Advanced", "B2 – Upper intermediate",
              "B1 – Intermediate", "A2 – Elementary", "A1 – Beginner", "Basic knowledge"],
    langues: ["French", "English", "Italian", "Spanish", "Portuguese", "German", "Arabic", "Chinese", "Russian",
              "Dutch", "Turkish", "Wolof", "Pulaar (Fula)", "Serer", "Bambara", "Dioula", "Mooré", "Ewe", "Fon",
              "Yoruba", "Hausa", "Igbo", "Lingala", "Kikongo", "Swahili", "Sango", "Fang", "Ewondo", "Duala",
              "Bassa", "Baoulé", "Bété", "Malagasy", "Kinyarwanda", "Kirundi", "Amharic", "Somali", "Tamazight"],
    situations: ["Single", "Married", "In a civil partnership", "Divorced", "Widowed"],
    permis: ["B", "A", "A and B", "B and C", "C", "D", "None"],
    nationalites: ["Senegalese", "Ivorian", "Cameroonian", "Malian", "Burkinabe", "Togolese", "Beninese",
                   "Guinean", "Nigerien", "Chadian", "Gabonese", "Congolese", "Congolese (DRC)",
                   "Central African", "Mauritanian", "Malagasy", "Rwandan", "Burundian", "Moroccan", "Algerian",
                   "Tunisian", "Nigerian", "Ghanaian", "French", "Italian", "Belgian", "Swiss", "Canadian"],
    diplomes: ["Primary school certificate", "Lower secondary certificate", "Vocational certificate (CAP)",
               "Vocational diploma (BEP)", "High school diploma", "Technician certificate", "Higher National Diploma (BTS)",
               "University diploma of technology (DUT)", "Bachelor's degree", "Vocational bachelor's degree",
               "Master's degree", "Engineering degree", "PhD", "Training certificate"],
    categories: ["IT", "Office software", "Programming languages", "Tools", "Accounting", "Management", "Communication",
                 "Sales", "Technical skills", "Personal qualities"],
    liens: ["LinkedIn", "GitHub", "Portfolio", "Website", "Behance"],
    salutations: ["Dear Sir or Madam,", "Dear Hiring Manager,", "Dear Sir,", "Dear Madam,", "Dear Director,",
                  "Dear Human Resources Manager,", "Dear Recruitment Team,"],
    formules: ["Yours faithfully,", "Yours sincerely,", "Kind regards,",
               "I look forward to hearing from you. Yours faithfully,"],
    interets: ["Football", "Basketball", "Running", "Swimming", "Fitness", "Martial arts", "Dancing",
               "Reading", "Writing", "Music", "Singing", "Cinema", "Photography", "Drawing and painting", "Cooking",
               "Travelling", "Volunteering", "Community involvement", "Video games", "Chess", "Gardening",
               "Technology and IT", "Entrepreneurship", "Fashion", "Theatre"],
    pieces: ["Curriculum vitae", "CV and copies of diplomas", "CV, diplomas and work certificates"],
  },
  it: {
    niveaux: ["Madrelingua", "Bilingue", "Fluente", "C2 – Padronanza", "C1 – Avanzato", "B2 – Intermedio superiore",
              "B1 – Intermedio", "A2 – Elementare", "A1 – Principiante", "Nozioni di base"],
    langues: ["Francese", "Inglese", "Italiano", "Spagnolo", "Portoghese", "Tedesco", "Arabo", "Cinese", "Russo",
              "Olandese", "Turco", "Wolof", "Pulaar (fula)", "Serer", "Bambara", "Dioula", "Mooré", "Ewe", "Fon",
              "Yoruba", "Hausa", "Igbo", "Lingala", "Kikongo", "Swahili", "Sango", "Fang", "Ewondo", "Duala",
              "Bassa", "Baoulé", "Bété", "Malgascio", "Kinyarwanda", "Kirundi", "Amarico", "Somalo", "Tamazight"],
    situations: ["Celibe / Nubile", "Coniugato/a", "Convivente", "Divorziato/a", "Vedovo/a"],
    permis: ["B", "A", "A e B", "B e C", "C", "D", "Nessuna"],
    nationalites: ["Senegalese", "Ivoriana", "Camerunese", "Maliana", "Burkinabé", "Togolese", "Beninese",
                   "Guineana", "Nigerina", "Ciadiana", "Gabonese", "Congolese", "Congolese (RDC)",
                   "Centrafricana", "Mauritana", "Malgascia", "Ruandese", "Burundese", "Marocchina", "Algerina",
                   "Tunisina", "Nigeriana", "Ghanese", "Francese", "Italiana", "Belga", "Svizzera", "Canadese"],
    diplomes: ["Licenza elementare", "Licenza media", "Qualifica professionale (CAP)", "Diploma professionale (BEP)",
               "Diploma di maturità", "Diploma di tecnico", "Diploma tecnico superiore (BTS)",
               "Diploma universitario di tecnologia (DUT)", "Laurea triennale", "Laurea professionalizzante",
               "Laurea magistrale", "Laurea in ingegneria", "Dottorato di ricerca", "Attestato di formazione"],
    categories: ["Informatica", "Pacchetto Office", "Linguaggi", "Strumenti", "Contabilità", "Gestione", "Comunicazione",
                 "Commercio e vendita", "Competenze tecniche", "Qualità personali"],
    liens: ["LinkedIn", "GitHub", "Portfolio", "Sito web", "Behance"],
    salutations: ["Gentili Signori,", "Gentile Signora,", "Egregio Signore,", "Gentile Direttrice,", "Egregio Direttore,",
                  "Gentile Responsabile delle Risorse Umane,", "Spettabile Azienda,"],
    formules: ["In attesa di un Vostro cortese riscontro, porgo distinti saluti.", "Distinti saluti.", "Cordiali saluti.",
               "RingraziandoVi per l'attenzione, porgo cordiali saluti."],
    interets: ["Calcio", "Pallacanestro", "Corsa", "Nuoto", "Palestra", "Arti marziali", "Danza",
               "Lettura", "Scrittura", "Musica", "Canto", "Cinema", "Fotografia", "Disegno e pittura", "Cucina",
               "Viaggi", "Volontariato", "Impegno nella comunità", "Videogiochi", "Scacchi", "Giardinaggio",
               "Informatica e nuove tecnologie", "Imprenditoria", "Moda", "Teatro"],
    pieces: ["Curriculum vitae", "CV e copie dei titoli di studio", "CV, titoli di studio e attestati di lavoro"],
  },
};
function choix(nom) {
  return (CHOIX[etat.options.langue] || CHOIX.fr)[nom] || [];
}

/** Menu déroulant : les choix de la liste, plus la valeur actuelle si elle n'en fait pas partie
 *  (CV importé, ancienne sauvegarde) : rien de ce que l'utilisateur a écrit n'est perdu. */
function remplirMenu(menu, nom, valeur) {
  menu.translate = false; menu.setAttribute("translate", "no");   // contenu dans la langue du document
  const options = [["", (window.tr || (t => t))("Choisir…")], ...choix(nom).map(c => [c, c])];
  if (valeur && !choix(nom).includes(valeur)) options.push([valeur, valeur]);
  menu.replaceChildren(...options.map(([v, texte]) => new Option(texte, v)));
  menu.value = valeur || "";
}

/** Propositions sous un champ de saisie (on peut toujours taper autre chose). */
function brancherSuggestions(saisie, nom) {
  let liste = document.getElementById("choix-" + nom);
  if (!liste) {
    liste = document.createElement("datalist");
    liste.id = "choix-" + nom; liste.setAttribute("translate", "no");
    document.body.append(liste);
  }
  liste.replaceChildren(...choix(nom).map(c => new Option(c)));
  saisie.setAttribute("list", liste.id);
  saisie.autocomplete = "off";
}

/** Champs fixes du formulaire (état civil) : data-choix="situations", data-suggere="nationalites". */
function remplirChoix() {
  remplirMenu($("#choix-formule"), "formules", "");    // lettre : formules de politesse toutes prêtes
  for (const menu of $$("select[data-choix]")) remplirMenu(menu, menu.dataset.choix, lire(menu.dataset.k));
  for (const saisie of $$("input[data-suggere]")) brancherSuggestions(saisie, saisie.dataset.suggere);
}

/** La langue du document change : un choix fait dans une liste est converti (« Courant » -> « Fluent »). */
function convertirChoix(ancienne, nouvelle) {
  const a = CHOIX[ancienne], n = CHOIX[nouvelle];
  if (!a || !n || ancienne === nouvelle) return;
  const convertir = (nom, valeur) => {
    const i = typeof valeur === "string" ? a[nom].indexOf(valeur) : -1;
    return i >= 0 ? n[nom][i] : valeur;
  };
  for (const l of etat.cv.langues) { l.langue = convertir("langues", l.langue); l.niveau = convertir("niveaux", l.niveau); }
  for (const f of etat.cv.formations) f.diplome = convertir("diplomes", f.diplome);
  for (const c of etat.cv.competences) c.categorie = convertir("categories", c.categorie);
  for (const l of etat.cv.liens) l.label = convertir("liens", l.label);
  etat.cv.interets = separerInterets(etat.cv.interets).map(i => convertir("interets", i)).join(", ");
  const ec = etat.cv.etat_civil;
  ec.situation = convertir("situations", ec.situation);
  ec.nationalite = convertir("nationalites", ec.nationalite);
  ec.permis = convertir("permis", ec.permis);
}

// ---------- Centres d'intérêt : un champ libre + des propositions à ajouter d'un clic ----------
function separerInterets(texte) {
  return (texte || "").split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean);
}
function dessinerInterets() {
  const zone = $("#interets-choix");
  if (!zone) return;
  const choisis = separerInterets(etat.cv.interets).map(x => x.toLowerCase());
  zone.setAttribute("translate", "no");          // dans la langue du document, comme les autres listes
  zone.replaceChildren(...choix("interets").map(nom => {
    const puce = document.createElement("button");
    puce.type = "button"; puce.className = "puce-choix"; puce.textContent = nom;
    puce.setAttribute("aria-pressed", choisis.includes(nom.toLowerCase()));
    puce.addEventListener("click", () => {
      const actuels = separerInterets(etat.cv.interets);
      const i = actuels.findIndex(x => x.toLowerCase() === nom.toLowerCase());
      if (i >= 0) actuels.splice(i, 1); else actuels.push(nom);
      const texte = actuels.join(", ");
      if (texte.length > 500) return;              // même limite que le champ
      etat.cv.interets = texte;
      $("#interets").value = texte;
      dessinerInterets();
      modifie(0);
    });
    return puce;
  }));
}

const CONSEILS = {
  moderne: "Bandeau de couleur et photo ronde : un CV qui se remarque, idéal pour les métiers de contact, du commerce et du numérique.",
  classique: "Une colonne, sans fioritures : le plus sûr pour les logiciels de tri de candidatures (ATS). En Europe, la photo et l'état civil sont en général facultatifs.",
  europeen: "Présentation inspirée d'Europass : libellés à gauche, expériences de la plus récente à la plus ancienne, langues avec niveau CECRL (A1 à C2).",
  africain: "Présentation courante en Afrique : bloc d'état civil complet, photo, références et mention de certification sur l'honneur.",
};

// Ce qui compte dans la jauge « CV complété à … % » : [test, conseil si manquant]
const ETAPES = [
  [cv => cv.nom.trim(), "ton nom"],
  [cv => cv.titre.trim(), "le poste visé"],
  [cv => cv.email.trim(), "ton e-mail"],
  [cv => cv.telephone.trim(), "ton téléphone"],
  [cv => cv.ville.trim(), "ta ville"],
  [cv => cv.experiences.some(e => (e.poste || "").trim()), "une expérience"],
  [cv => cv.formations.some(f => (f.diplome || "").trim()), "une formation"],
  [cv => cv.competences.some(c => (c.liste || "").trim()), "tes compétences"],
  [cv => cv.langues.some(l => (l.langue || "").trim()), "les langues que tu parles"],
  [cv => cv.profil.trim(), "quelques lignes de profil"],
];

const PARTIES_LETTRE = ["accroche", "parcours", "entreprise", "conclusion"];
const MODELES_LETTRE = ["classique", "moderne", "epure"];
const TEXTES_LETTRE = {
  fr: { salutation: "Madame, Monsieur,",
        formule: "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
        trame: {
          accroche: "Actuellement [ta situation], je vous adresse ma candidature au poste de [poste] au sein de [entreprise].",
          parcours: "[Ce que tu as fait : formation, expériences, résultats concrets en lien avec le poste.]",
          entreprise: "[Pourquoi cette entreprise, et ce que tu peux lui apporter.]",
          conclusion: "Je me tiens à votre disposition pour un entretien afin de vous exposer plus en détail ma motivation." } },
  en: { salutation: "Dear Sir or Madam,",
        formule: "Yours faithfully,",
        trame: {
          accroche: "I am writing to apply for the position of [position] at [company].",
          parcours: "[What you have done: education, experience, concrete results relevant to the role.]",
          entreprise: "[Why this company, and what you can bring to it.]",
          conclusion: "I would welcome the opportunity to discuss my application with you in an interview." } },
  it: { salutation: "Gentili Signori,",
        formule: "In attesa di un Vostro cortese riscontro, porgo distinti saluti.",
        trame: {
          accroche: "Con la presente desidero candidarmi per la posizione di [posizione] presso [azienda].",
          parcours: "[Cosa hai fatto: formazione, esperienze, risultati concreti legati al ruolo.]",
          entreprise: "[Perché questa azienda e cosa puoi offrirle.]",
          conclusion: "Resto a disposizione per un colloquio conoscitivo." } },
};

function etatVide() {
  return {
    type: "cv",
    options: { modele: "moderne", modele_lettre: "classique", langue: LANGUE_SITE, couleur: "1F4E79", certifier: false },
    cv: { nom: "", titre: "", email: "", telephone: "", ville: "", etat_civil: {}, profil: "",
          experiences: [{}], formations: [{}], competences: [{}], langues: [{}], liens: [],
          certifications: [], projets: [],
          interets: "", references: [], photo: "" },
    lettre: { destinataire: {}, lieu: "", objet: "", pj: "",
              parties: { accroche: "", parcours: "", entreprise: "", conclusion: "" },
              date: new Date().toLocaleDateString(window.LOCALE_SITE || "fr-FR", { day: "numeric", month: "long", year: "numeric" }),
              salutation: TEXTES_LETTRE[LANGUE_SITE].salutation, formule: TEXTES_LETTRE[LANGUE_SITE].formule },
  };
}

/** Fusionne des données (import, sauvegarde) dans un état propre, sans faire confiance à leur forme. */
function fusionner(source) {
  const e = etatVide();
  if (!source || typeof source !== "object") return e;
  // Un cv.json « nu » (sans enveloppe cv/lettre/options) est accepté aussi.
  const s = source.cv || source.lettre || source.options ? source : { cv: source };
  if (s.type === "lettre") e.type = "lettre";
  for (const bloc of ["options", "cv", "lettre"]) {
    if (s[bloc] && typeof s[bloc] === "object") Object.assign(e[bloc], s[bloc]);
  }
  // Un champ texte doit rester une chaîne, quoi que contienne le fichier importé.
  const modele = etatVide();
  for (const bloc of ["cv", "lettre", "options"]) {
    for (const [cle, defaut] of Object.entries(modele[bloc])) {
      if (typeof defaut === "string" && typeof e[bloc][cle] !== "string") e[bloc][cle] = defaut;
    }
  }
  if (!MODELES.includes(e.options.modele)) e.options.modele = modele.options.modele;
  if (!MODELES_LETTRE.includes(e.options.modele_lettre)) e.options.modele_lettre = modele.options.modele_lettre;
  for (const nom of Object.keys(LISTES)) {
    const liste = Array.isArray(e.cv[nom]) ? e.cv[nom] : [];
    e.cv[nom] = liste.filter(x => x && typeof x === "object").map(x => ({ ...x }));
  }
  // « points » peut arriver sous forme de tableau : la zone de texte veut une chaîne.
  for (const exp of e.cv.experiences) {
    if (Array.isArray(exp.points)) exp.points = exp.points.join("\n");
  }
  for (const [bloc, cle] of [["cv", "etat_civil"], ["lettre", "destinataire"]]) {
    const v = e[bloc][cle];
    e[bloc][cle] = v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {};
  }
  // Texte de la lettre : quatre parties, chacune une chaîne.
  const recues = e.lettre.parties && typeof e.lettre.parties === "object" ? e.lettre.parties : {};
  e.lettre.parties = {};
  for (const cle of PARTIES_LETTRE) e.lettre.parties[cle] = typeof recues[cle] === "string" ? recues[cle] : "";
  // Ancienne sauvegarde : tout le texte était dans un seul champ « corps ». On le répartit
  // (1er paragraphe = accroche, dernier = conclusion, le reste entre les deux).
  if (typeof e.lettre.corps === "string" && e.lettre.corps.trim() && !texteLettre(e.lettre)) {
    const paras = e.lettre.corps.split("\n").map(p => p.trim()).filter(Boolean);
    const p = e.lettre.parties;
    p.accroche = paras.shift() || "";
    if (paras.length >= 2) p.conclusion = paras.pop();
    if (paras.length >= 2) p.entreprise = paras.pop();
    p.parcours = paras.join("\n");
  }
  delete e.lettre.corps;
  return e;
}

/** Le texte de la lettre, parties mises bout à bout ("" si rien n'est écrit). */
function texteLettre(lettre) {
  return PARTIES_LETTRE.map(cle => (lettre.parties[cle] || "").trim()).filter(Boolean).join("\n");
}

let etat = etatVide();
try { etat = fusionner(JSON.parse(localStorage.getItem(CLE_STOCKAGE))); } catch { /* stockage indisponible */ }

// Arrivée depuis la page d'accueil : /creer?modele=africain ou /creer?type=lettre
const parametres = new URLSearchParams(location.search);
if (MODELES.includes(parametres.get("modele"))) { etat.options.modele = parametres.get("modele"); etat.type = "cv"; }
if (parametres.get("type") === "lettre") etat.type = "lettre";

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function sauvegarder() {
  try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat)); } catch { /* quota ou navigation privée */ }
  aEnvoyer();   // compte connecté : la modification partira aussi vers le serveur
}

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

// ---------- Photo : réduite dans le navigateur avant envoi ----------
function afficherPhoto() {
  const img = $("#photo-apercu");
  img.hidden = !etat.cv.photo;
  $("#photo-retirer").hidden = !etat.cv.photo;
  if (etat.cv.photo) img.src = etat.cv.photo;
}
$("#photo-fichier").addEventListener("change", async e => {
  const fichier = e.target.files[0];
  e.target.value = "";
  if (!fichier) return;
  try {
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(1, 600 / Math.max(image.width, image.height));
    const toile = document.createElement("canvas");
    toile.width = Math.round(image.width * echelle);
    toile.height = Math.round(image.height * echelle);
    const ctx = toile.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, toile.width, toile.height);
    ctx.drawImage(image, 0, 0, toile.width, toile.height);
    etat.cv.photo = toile.toDataURL("image/jpeg", 0.88);
    afficherPhoto(); modifie();
  } catch {
    montrerErreur("Impossible de lire cette image (JPEG ou PNG uniquement).");
  }
});
$("#photo-retirer").addEventListener("click", () => { etat.cv.photo = ""; afficherPhoto(); modifie(); });

// ---------- Onglets CV / Lettre, conseil, jauge ----------
function afficherType() {
  for (const b of $$(".onglets button")) b.setAttribute("aria-selected", String(b.dataset.type === etat.type));
  for (const el of $$(".pour-cv")) el.hidden = etat.type !== "cv";
  for (const el of $$(".pour-lettre")) el.hidden = etat.type !== "lettre";
  $("#conseil-modele").textContent = CONSEILS[etat.options.modele] || "";
  afficherImport();
  afficherProgres();
}
for (const b of $$(".onglets button")) {
  b.addEventListener("click", () => { etat.type = b.dataset.type; afficherType(); modifie(0); });
}

/** Sous le texte de la lettre : sa longueur, et ce qu'il reste à écrire. */
function afficherLongueurLettre() {
  const mots = texteLettre(etat.lettre).split(/\s+/).filter(Boolean).length;
  const vides = PARTIES_LETTRE.filter(cle => !(etat.lettre.parties[cle] || "").trim()).length;
  const reste = /\[[^\]]*\]/.test(texteLettre(etat.lettre));
  let avis = "";
  if (!mots) avis = "Vise 150 à 300 mots : assez pour convaincre, et tout tient sur une page.";
  else if (reste) avis = `${mots} mots · remplace les passages entre [crochets] par ton texte.`;
  else if (vides) avis = `${mots} mots · il reste ${vides} partie${vides > 1 ? "s" : ""} à écrire.`;
  else if (mots < 120) avis = `${mots} mots · c'est un peu court : ajoute un exemple concret de ce que tu as réalisé.`;
  else if (mots > 330) avis = `${mots} mots · c'est long : la lettre risque de dépasser une page, raccourcis.`;
  else avis = `${mots} mots · bonne longueur.`;
  $("#longueur-lettre").textContent = avis;
}

function afficherProgres() {
  afficherLongueurLettre();
  const manquants = ETAPES.filter(([test]) => !test(etat.cv)).map(([, conseil]) => conseil);
  const pourcent = Math.round(100 * (ETAPES.length - manquants.length) / ETAPES.length);
  $("#progres").value = pourcent;
  $("#progres-texte").textContent = manquants.length
    ? `CV complété à ${pourcent} % · ajoute ${manquants[0]}`
    : "CV complet, prêt à être envoyé";
}

// ---------- Aperçu et téléchargement ----------
let minuterie = null;
let requete = null;

function montrerErreur(message) {
  const p = $("#erreur");
  p.textContent = message || "";
  p.hidden = !message;
}

function pret() {
  if (!etat.cv.nom.trim()) return "Renseigne ton nom pour voir l'aperçu.";
  if (etat.type === "lettre" && !texteLettre(etat.lettre)) return "Écris le texte de la lettre pour voir l'aperçu.";
  return "";
}

async function appeler(chemin, signal) {
  let reponse;
  try {
    reponse = await fetch(chemin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: etat.type, cv: etat.cv, lettre: etat.lettre, options: etat.options }),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("Connexion impossible. Vérifie ta connexion Internet et réessaie.");
  }
  if (!reponse.ok) {
    const detail = await reponse.json().catch(() => ({}));
    throw new Error(detail.erreur || `Erreur ${reponse.status}`);
  }
  return reponse;
}

async function actualiser() {
  clearTimeout(minuterie);
  const manque = pret();
  $("#btn-telecharger").disabled = !!manque;
  $("#btn-ouvrir").disabled = !!manque;
  $("#btn-partager").disabled = !!manque;
  $("#btn-telecharger-bas").disabled = !!manque;
  if (manque) {
    $("#etat").textContent = manque;
    $("#vide").hidden = false;
    $("#pages").replaceChildren();
    return;
  }
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
  } catch (e) {
    if (e.name === "AbortError") return;
    $("#etat").textContent = "";
    montrerErreur(e.message);
  }
}

async function telecharger(bouton) {
  const texte = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = "Préparation…";
  try {
    const pdf = await (await appeler("/api/pdf")).blob();
    const nom = etat.cv.nom.trim().normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(pdf);
    lien.download = `${etat.type === "lettre" ? "Lettre" : "CV"}_${nom || "document"}.pdf`;
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
    montrerErreur("");
  } catch (e) {
    montrerErreur(e.message);
  } finally {
    bouton.textContent = texte;
    bouton.disabled = false;
  }
}
function nomFichier() {
  const nom = etat.cv.nom.trim().normalize("NFD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${etat.type === "lettre" ? "Lettre" : "CV"}_${nom || "document"}.pdf`;
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
  bouton.disabled = true;
  try {
    const pdf = await (await appeler("/api/pdf")).blob();
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
  // L'onglet est ouvert TOUT DE SUITE, pendant le clic : ouvert plus tard (après la
  // réponse du serveur), le navigateur le bloquerait comme une fenêtre publicitaire.
  const onglet = window.open("", "_blank");
  bouton.disabled = true;
  try {
    const pdf = await (await appeler("/api/pdf")).blob();
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
$("#btn-voir").addEventListener("click", () => $("#apercu").scrollIntoView({ behavior: "smooth" }));

/** À appeler après chaque modification : sauvegarde, puis aperçu différé (on attend la fin de la frappe). */
function modifie(delai = 1200) {
  sauvegarder();
  afficherProgres();
  clearTimeout(minuterie);
  minuterie = setTimeout(actualiser, delai);
}

$("#formulaire").addEventListener("input", e => {
  const el = e.target;
  if (!el.dataset.k) return;   // les champs des listes ont leur propre écouteur
  ecrire(el.dataset.k, el.type === "checkbox" ? el.checked : el.value);
  if (el.dataset.k === "options.modele") afficherType();
  if (el.dataset.k === "cv.interets") dessinerInterets();
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
  if (texteLettre(etat.lettre) && !confirm("Remplacer le texte actuel de la lettre par les phrases à compléter ?")) return;
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
      && !confirm(lettre ? "Remplacer le texte actuel de ta lettre par celui du fichier ?"
                         : "Remplacer le CV actuel par celui du fichier ?")) return;
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
  remplirChoix();       // avant remplirChamps : un menu doit contenir la valeur à afficher
  remplirChamps();
  Object.keys(LISTES).forEach(dessinerListe);
  dessinerInterets();
  afficherPhoto();
  afficherType();
}

async function chargerExemple() {
  if (etat.cv.nom.trim() && !confirm("Remplacer tes données par l'exemple ?")) return;
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
  if (!confirm(compte.connecte
    ? "Effacer toutes les données du formulaire, sur cet appareil ET dans ton compte ?"
    : "Effacer toutes les données du formulaire ?")) return;
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

// =====================================================================
// Compte (facultatif) : connexion, et copie du CV sur le serveur pour le
// retrouver depuis un autre appareil. Sans compte, rien de tout ceci ne s'active.
// =====================================================================

function lireSynchro() {
  try { return JSON.parse(localStorage.getItem(CLE_SYNCHRO)) || {}; } catch { return {}; }
}
function ecrireSynchro(s) {
  try { localStorage.setItem(CLE_SYNCHRO, JSON.stringify(s)); } catch { /* stockage indisponible */ }
}
function estVide(e) {
  return !e.cv.nom.trim() && !texteLettre(e.lettre);
}

/** Appel à /api/compte… -> { ok, statut, corps }. Ne lève jamais d'erreur. */
async function api(methode, chemin, corps) {
  try {
    const r = await fetch("/api/compte" + chemin, {
      method: methode,
      credentials: "same-origin",
      headers: corps ? { "Content-Type": "application/json" } : {},
      body: corps ? JSON.stringify(corps) : undefined,
    });
    return { ok: r.ok, statut: r.status, corps: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, statut: 0, corps: { erreur: "Connexion impossible. Vérifie ta connexion Internet." } };
  }
}

function afficherCompte(message) {
  $("#btn-compte").textContent = compte.connecte ? "Mon espace" : "Se connecter";
  $("#compte-form").hidden = compte.connecte;
  $("#compte-connecte").hidden = !compte.connecte;
  $("#compte-qui").textContent = compte.email || "";
  if (message !== undefined) $("#compte-synchro").textContent = message;
  $("#compte-titre").textContent = modeInscription ? "Créer un compte" : "Se connecter";
  $("#compte-valider").textContent = modeInscription ? "Recevoir le lien d'inscription" : "Se connecter";
  $("#compte-question").textContent = modeInscription ? "Déjà un compte ?" : "Pas encore de compte ?";
  $("#compte-bascule").textContent = modeInscription ? "Se connecter" : "Créer un compte";
  // Inscription : l'adresse seulement ; le mot de passe se choisit en ouvrant le lien reçu.
  $("#compte-mdp-ligne").hidden = modeInscription;
  $("#compte-info-inscription").hidden = !modeInscription;
  $("#compte-oubli-ligne").hidden = modeInscription;
  $("#compte-envoye").hidden = true;
  $("#compte-valider").hidden = false;
}

function erreurCompte(sel, message) {
  $(sel).textContent = message || "";
  $(sel).hidden = !message;
}

/** Note qu'il y a une modification à envoyer, et programme l'envoi (après une pause dans la frappe). */
function aEnvoyer() {
  if (!compte.connecte) return;
  ecrireSynchro({ ...lireSynchro(), sale: true });
  clearTimeout(minuterieEnvoi);
  minuterieEnvoi = setTimeout(envoyer, 2500);
}

/** Adresse du document en cours dans le compte (« ?doc=12 »), ou sans numéro s'il n'en a pas encore. */
function adresseDocument() {
  const numero = lireSynchro().doc;
  return "/donnees" + (numero ? "?doc=" + numero : "");
}

async function envoyer() {
  clearTimeout(minuterieEnvoi);
  if (!compte.connecte) return false;
  const s = lireSynchro();
  // « version » : celle sur laquelle cet appareil a travaillé. Si le document a été enregistré
  // entre-temps sur un autre appareil, le serveur refuse (409) au lieu d'écraser ce travail.
  const corps = { donnees: etat, nouveau: !s.doc };
  if (s.doc && Number.isInteger(s.version)) corps.version = s.version;
  let r = await api("PUT", adresseDocument(), corps);
  let copie = false;
  if (r.statut === 404 || (r.statut === 409 && r.corps.conflit)) {
    // Document supprimé, ou modifié ailleurs entre-temps : rien n'est écrasé, ce qui est ici
    // est enregistré comme un NOUVEAU document. Les deux versions restent dans le compte.
    copie = r.statut === 409;
    ecrireSynchro({ sale: true });
    r = await api("PUT", "/donnees", { donnees: etat, nouveau: true,
      nom: copie ? (window.tr || (t => t))("Version modifiée sur cet appareil") : undefined });
  }
  if (r.ok) {
    ecrireSynchro({ doc: r.corps.doc, vu: r.corps.modifie_le, version: r.corps.version, sale: false });
    afficherCompte("Ton CV est enregistré dans ton compte.");
    if (copie) alert("Ce CV avait été modifié sur un autre appareil entre-temps. Pour ne rien perdre, "
      + "tes modifications ont été enregistrées dans un nouveau document (« Version modifiée sur cet appareil »). "
      + "Retrouve les deux versions dans « Mon espace ».");
  } else if (r.statut === 401) {
    compte = { connecte: false, email: null };
    afficherCompte();
  } else {
    afficherCompte("Enregistrement dans ton compte impossible pour l'instant : " + (r.corps.erreur || "réessaie plus tard") );
  }
  return r.ok;
}

/** Remplace le contenu de l'éditeur par un document du compte. */
function chargerDocument(reponse) {
  etat = fusionner({ ...reponse.donnees, type: parametres.get("type") === "lettre" ? "lettre" : etat.type });
  try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat)); } catch { /* stockage indisponible */ }
  ecrireSynchro({ doc: reponse.doc, vu: reponse.modifie_le, version: reponse.version, sale: false });
  toutDessiner(); actualiser();
}

/** Met d'accord cet appareil et le compte : la version la plus récente gagne ;
 *  si les deux ont changé chacun de leur côté, on demande. */
async function synchroniser() {
  let s = lireSynchro();
  const nonEnvoye = !estVide(etat) && (s.sale || s.vu === undefined);

  // Arrivée depuis « Mon espace » avec un document précis à ouvrir : /creer?doc=12
  const demande = Number(parametres.get("doc")) || null;
  if (demande) {
    history.replaceState(null, "", location.pathname);       // un rechargement ne rouvre pas ce document de force
    if (demande !== s.doc) {
      if (nonEnvoye) await envoyer();      // ce qui était en cours ici est d'abord mis à l'abri dans le compte
      const r = await api("GET", "/donnees?doc=" + demande);
      if (r.ok) {
        chargerDocument(r.corps);
        return afficherCompte("Ton CV a été chargé depuis ton compte.");
      }
      s = lireSynchro();
    }
  }

  let r = await api("GET", adresseDocument());
  if (r.statut === 404) {                  // document supprimé ailleurs : on repart du plus récent
    ecrireSynchro({ sale: s.sale });
    s = lireSynchro();
    r = await api("GET", "/donnees");
  }
  if (!r.ok) return;
  const { donnees, modifie_le: date, version } = r.corps;
  // Le compte a une version pas encore vue ici ? (numéro de version ; la date pour les
  // appareils synchronisés avant l'arrivée des numéros de version)
  const compteNouveau = donnees && (Number.isInteger(s.version) ? version !== s.version : date !== s.vu);
  const localModifie = !estVide(etat) && (s.sale || s.vu === undefined);
  let prendreCompte = compteNouveau;
  if (compteNouveau && localModifie && JSON.stringify(fusionner(donnees)) !== JSON.stringify(etat)) {
    prendreCompte = confirm("Ton compte contient un CV différent de celui de cet appareil.\n\n"
      + "OK : charger le CV de ton compte.\nAnnuler : garder celui de cet appareil (il sera ajouté à ton compte).");
    // Garder celui de l'appareil : il devient un NOUVEAU document, rien n'est écrasé dans le compte
    // (même si cet appareil travaillait déjà sur ce document : l'autre version reste intacte).
    if (!prendreCompte) ecrireSynchro({ sale: true });
  }
  if (prendreCompte) {
    chargerDocument(r.corps);
    afficherCompte("Ton CV a été chargé depuis ton compte.");
  } else if (!estVide(etat) && (localModifie || !donnees)) {
    await envoyer();
  } else {
    if (donnees && !s.doc) ecrireSynchro({ ...s, doc: r.corps.doc, vu: date, version });
    afficherCompte(donnees ? "Ton CV est enregistré dans ton compte." : "Ton CV sera enregistré dans ton compte dès que tu le rempliras.");
  }
}

$("#btn-compte").addEventListener("click", () => {
  erreurCompte("#compte-erreur", ""); erreurCompte("#compte-erreur-suppr", "");
  afficherCompte();
  $("#dlg-compte").showModal();
});
$("#compte-fermer").addEventListener("click", () => $("#dlg-compte").close());
$("#compte-bascule").addEventListener("click", () => {
  modeInscription = !modeInscription;
  erreurCompte("#compte-erreur", "");
  afficherCompte();
});

$("#compte-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#compte-email").value.trim(), mdp = $("#compte-mdp").value;
  if (modeInscription) {
    if (!email) return erreurCompte("#compte-erreur", "Renseigne ton adresse e-mail.");
    $("#compte-valider").disabled = true;
    const r = await api("POST", "/inscription", { email, langue: LANGUE_SITE });
    $("#compte-valider").disabled = false;
    if (!r.ok) return erreurCompte("#compte-erreur", r.corps.erreur || "Une erreur est survenue. Réessaie.");
    erreurCompte("#compte-erreur", "");
    $("#compte-envoye").hidden = false;
    $("#compte-valider").hidden = true;
    return;
  }
  if (!email || !mdp) return erreurCompte("#compte-erreur", "Renseigne ton adresse e-mail et ton mot de passe.");
  $("#compte-valider").disabled = true;
  const r = await api("POST", "/connexion", { email, mot_de_passe: mdp });
  $("#compte-valider").disabled = false;
  $("#compte-mdp").value = "";
  if (!r.ok) return erreurCompte("#compte-erreur", r.corps.erreur || "Une erreur est survenue. Réessaie.");
  erreurCompte("#compte-erreur", "");
  compte = { connecte: true, email: r.corps.email };
  ecrireSynchro({});              // autre compte possible sur cet appareil : on repart de zéro
  afficherCompte("");
  await synchroniser();
});

$("#compte-deconnexion").addEventListener("click", async () => {
  // On envoie d'abord les dernières modifications, pour ne rien perdre.
  if (lireSynchro().sale && !(await envoyer())
      && !confirm("Tes dernières modifications n'ont pas pu être enregistrées dans ton compte. Se déconnecter quand même ?")) return;
  await api("POST", "/deconnexion", {});
  compte = { connecte: false, email: null };
  clearTimeout(minuterieEnvoi);
  // Ordinateur partagé : après la déconnexion, il ne reste rien sur cet appareil.
  etat = etatVide();
  try { localStorage.removeItem(CLE_STOCKAGE); localStorage.removeItem(CLE_SYNCHRO); } catch { /* stockage indisponible */ }
  toutDessiner(); actualiser();
  afficherCompte();
  $("#dlg-compte").close();
});

$("#compte-supprimer").addEventListener("click", async () => {
  const mdp = $("#compte-mdp-suppr").value;
  if (!mdp) return erreurCompte("#compte-erreur-suppr", "Saisis ton mot de passe pour confirmer.");
  clearTimeout(minuterieEnvoi);
  const r = await api("DELETE", "", { mot_de_passe: mdp });
  $("#compte-mdp-suppr").value = "";
  if (!r.ok) return erreurCompte("#compte-erreur-suppr", r.corps.erreur || "Suppression impossible. Réessaie.");
  compte = { connecte: false, email: null };
  try { localStorage.removeItem(CLE_SYNCHRO); } catch { /* stockage indisponible */ }
  modeInscription = false;
  afficherCompte();
  $("#dlg-compte").close();
  alert("Ton compte et le CV enregistré sur nos serveurs ont été supprimés.");
});

// Au chargement de la page : déjà connecté sur cet appareil ?
(async () => {
  const r = await api("GET", "");
  if (r.ok && r.corps.connecte) {
    compte = { connecte: true, email: r.corps.email };
    afficherCompte("");
    await synchroniser();
  }
  // Arrivée par le lien « Se connecter » des autres pages (/creer?compte=1) :
  // on ouvre directement la fenêtre du compte.
  if (parametres.get("compte") === "1") $("#btn-compte").click();
})();
