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
const MODELES = ["moderne", "classique", "europeen", "africain", "elegant", "compact"];

// Description des listes répétables : [champ, libellé, type]
const LISTES = {
  experiences: { nom: "Expérience", champs: [
    ["poste", "Poste"], ["entreprise", "Entreprise"], ["lieu", "Lieu"],
    ["dates", "Dates", "periode"],
    ["points", "Missions et résultats (un par ligne)", "textarea"]] },
  formations: { nom: "Formation", champs: [
    ["diplome", "Diplôme", "suggere:diplomes"], ["ecole", "Établissement"], ["dates", "Dates", "periode"],
    ["details", "Détails (mention, matières…)"]] },
  competences: { nom: "Compétence", champs: [
    ["categorie", "Catégorie (ex. Informatique)", "suggere:categories"], ["liste", "Compétences"]] },
  langues: { nom: "Langue", champs: [
    ["langue", "Langue", "suggere:langues"], ["niveau", "Niveau", "choix:niveaux"]] },
  certifications: { nom: "Certification", champs: [
    ["titre", "Intitulé (ex. TOEIC 750, permis cariste)"], ["organisme", "Organisme"], ["date", "Année"]] },
  projets: { nom: "Projet", champs: [
    ["titre", "Nom du projet"], ["dates", "Dates", "periode"],
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
  if (MOIS[nouvelle]) {
    for (const liste of [etat.cv.experiences, etat.cv.formations, etat.cv.projets]) {
      for (const e of liste) {
        const p = lirePeriode(e.dates);
        if (p && (e.dates || "").trim()) e.dates = ecrirePeriode(p, nouvelle);
      }
    }
  }
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
  elegant: "Police à empattements et dates dans une colonne à gauche : un CV sobre et raffiné, très lisible, pour les métiers du droit, de la finance, de l'enseignement ou de la culture.",
  compact: "Bandeau de couleur et rubriques serrées pour tout faire tenir sur une page : idéal quand on a beaucoup à dire, ou pour un premier emploi.",
};

// Ce qui compte dans la jauge « CV complété à … % » : [test, conseil si manquant]
const PARTIES_LETTRE = ["accroche", "parcours", "entreprise", "conclusion"];
const MODELES_LETTRE = ["classique", "moderne", "epure", "elegante"];
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

const GENRES_ADMIN = ["demande", "attestation", "procuration", "reclamation", "prise_en_charge"];

function etatVide() {
  return {
    type: "cv",
    options: { modele: "moderne", modele_lettre: "classique", langue: LANGUE_SITE, couleur: "1F4E79", certifier: false,
               qr: false, partage: "" },
    offre: "",          // texte de l'annonce visée (« Adapter à une offre d'emploi »)
    cv: { nom: "", titre: "", email: "", telephone: "", ville: "", etat_civil: {}, profil: "",
          experiences: [{}], formations: [{}], competences: [{}], langues: [{}], liens: [],
          certifications: [], projets: [],
          interets: "", references: [], photo: "" },
    lettre: { destinataire: {}, lieu: "", objet: "", pj: "",
              parties: { accroche: "", parcours: "", entreprise: "", conclusion: "" },
              date: new Date().toLocaleDateString(window.LOCALE_SITE || "fr-FR", { day: "numeric", month: "long", year: "numeric" }),
              salutation: TEXTES_LETTRE[LANGUE_SITE].salutation, formule: TEXTES_LETTRE[LANGUE_SITE].formule },
    // Documents administratifs : les réponses au formulaire, et le texte rédigé d'après elles.
    // « auto » : le texte suit les réponses tant qu'il n'a pas été corrigé à la main.
    admin: { genre: "demande", nature: "emploi", sexe: "", destinataire: {}, precision: "", motif: "",
             domicile: "", piece_type: "la carte nationale d'identité", piece_numero: "",
             declaration: "", mandataire: {}, demarche: "", validite: "", lieu: "", pj: "",
             date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
             recours: "reclamation", conteste: "", reference: "", date_fait: "", arguments: "", reparation: "",
             beneficiaire: {}, sejour: "etudes", destination: "", debut: "", fin: "", frais: "", ressources: "",
             corps: "", objet: "", titre: "", signataires: [], auto: true },
    // Plan de localisation : les éléments dessinés (web/plan.js), et ce qui est écrit autour.
    plan: { titre: "PLAN DE LOCALISATION", sous_titre: "", orientation: "paysage", cadre: true,
            description: "", contact: "", gps: null, elements: [] },
    // Arbre généalogique : la descendance d'un ancêtre (web/arbre.js), unions multiples possibles.
    arbre: { titre: "ARBRE GÉNÉALOGIQUE", sous_titre: "", papier: "A4", note: "", options: { dates: true, lieux: false },
             racine: { nom: "", sexe: "", naissance: "", deces: "", decede: false, lieu: "", unions: [] } },
  };
}

/** Fusionne des données (import, sauvegarde) dans un état propre, sans faire confiance à leur forme. */
function fusionner(source) {
  const e = etatVide();
  if (!source || typeof source !== "object") return e;
  // Un cv.json « nu » (sans enveloppe cv/lettre/options) est accepté aussi.
  const s = source.cv || source.lettre || source.options ? source : { cv: source };
  if (["lettre", "admin", "plan", "arbre"].includes(s.type)) e.type = s.type;
  for (const bloc of ["options", "cv", "lettre", "admin", "plan", "arbre"]) {
    if (s[bloc] && typeof s[bloc] === "object") Object.assign(e[bloc], s[bloc]);
  }
  // Un champ texte doit rester une chaîne, quoi que contienne le fichier importé.
  const modele = etatVide();
  for (const bloc of ["cv", "lettre", "options", "admin", "plan", "arbre"]) {
    for (const [cle, defaut] of Object.entries(modele[bloc])) {
      if (typeof defaut === "string" && typeof e[bloc][cle] !== "string") e[bloc][cle] = defaut;
    }
  }
  e.offre = typeof s.offre === "string" ? s.offre.slice(0, 10000) : "";
  e.options.qr = e.options.qr === true;
  if (!/^[a-z0-9]{6,40}$/.test(e.options.partage)) e.options.partage = "";
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
  if (!GENRES_ADMIN.includes(e.admin.genre)) e.admin.genre = "demande";
  e.plan.elements = Array.isArray(e.plan.elements) ? e.plan.elements.filter(x => x && typeof x === "object") : [];
  if (!["paysage", "portrait"].includes(e.plan.orientation)) e.plan.orientation = "paysage";
  if (typeof e.plan.cadre !== "boolean") e.plan.cadre = true;
  if (!e.arbre.racine || typeof e.arbre.racine !== "object" || Array.isArray(e.arbre.racine)) e.arbre.racine = modele.arbre.racine;
  if (typeof e.arbre.racine.nom !== "string") e.arbre.racine.nom = "";
  e.arbre.options = { ...modele.arbre.options, ...(e.arbre.options && typeof e.arbre.options === "object" ? e.arbre.options : {}) };
  if (!Array.isArray(e.admin.signataires)) e.admin.signataires = [];
  e.admin.auto = e.admin.auto !== false;
  for (const [bloc, cle] of [["cv", "etat_civil"], ["lettre", "destinataire"], ["admin", "destinataire"], ["admin", "mandataire"], ["admin", "beneficiaire"]]) {
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
// Arrivée depuis une carte « Tous nos services » : /creer?type=admin, type=plan, type=arbre…
const TYPES_DOCUMENT = ["cv", "lettre", "admin", "plan", "arbre"];
const typeDemande = TYPES_DOCUMENT.includes(parametres.get("type")) ? parametres.get("type") : null;
if (typeDemande) etat.type = typeDemande;

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

// ---------- Documents administratifs : demande à une autorité, attestation, procuration ----------
// Le texte est rédigé ici, d'après les réponses, dans les formules en usage en Afrique francophone.
// Il reste modifiable : dès qu'on le corrige à la main, il n'est plus réécrit automatiquement.
// Ce qui manque apparaît entre [crochets]. Le serveur met le texte en page comme une lettre.
const DEMANDES = {
  emploi: ["Demande d'emploi", "un emploi au sein de votre structure"],
  stage: ["Demande de stage", "un stage au sein de votre structure"],
  bourse: ["Demande de bourse", "l'octroi d'une bourse d'études"],
  inscription: ["Demande d'inscription", "mon inscription dans votre établissement"],
  autorisation: ["Demande d'autorisation", "une autorisation de [préciser]"],
  mutation: ["Demande de mutation", "ma mutation à [lieu ou service souhaité]"],
  terrain: ["Demande d'attribution de terrain", "l'attribution d'un terrain à usage d'habitation"],
  autre: ["Demande de [préciser]", "[ce que tu demandes]"],
};
const NOTES_ADMIN = {
  demande: "Certaines administrations exigent une demande écrite à la main : dans ce cas, recopie ce texte sur une feuille en gardant la même présentation. Pense au timbre fiscal s'il est demandé, et signe.",
  attestation: "Signe l'attestation à la main. Une fausse déclaration sur l'honneur est punie par la loi.",
  reclamation: "Garde une copie de ta lettre et des pièces jointes. Envoie-la en recommandé avec accusé de réception, ou dépose-la contre un récépissé daté : c'est la preuve de ta démarche. Un recours contre une décision a souvent un délai (deux mois, par exemple) : agis vite.",
  prise_en_charge: "Signe à la main, puis fais légaliser ta signature (mairie, commissariat ou consulat). Joins une copie de ta pièce d'identité et des justificatifs de ressources (bulletins de salaire, relevés bancaires, attestation de travail). Le consulat peut demander d'autres pièces : renseigne-toi.",
  procuration: "Les deux personnes signent à la main, en recopiant la mention placée au-dessus de leur nom. Joins une copie de ta pièce d'identité. Beaucoup d'administrations demandent une signature légalisée (mairie, commissariat ou consulat) : renseigne-toi avant.",
};
const sansPoint = t => t.trim().replace(/[.\s]+$/, "");
/** Suite d'une phrase (« … atteste que je ne perçois… ») : sans le mot d'introduction répété, sans majuscule. */
const suite = (t, mot) => { const s = sansPoint(t).replace(new RegExp(`^${mot}\\s+`, "i"), ""); return s.startsWith("[") ? s : s.charAt(0).toLowerCase() + s.slice(1); };
/** « À Monsieur le Maire de la commune de … » -> « Monsieur le Maire » (formule d'appel). */
function civiliteAutorite(nom) {
  const m = (nom || "").trim().replace(/^[àa]\s+/i, "")
    .match(/^(Monsieur|Madame)(\s+(?:le|la)\s+[^\s,]+(?:\s+g[ée]n[ée]rale?)?(?:\s+de\s+(?:service|division|bureau|cabinet|centre|district))?|\s+l['’][^\s,]+)?/i);
  return m ? m[0] : "";
}
function redigerAdmin() {
  const a = etat.admin, cv = etat.cv, ec = cv.etat_civil || {};
  if (!a.auto) return;
  const e = a.sexe === "f" ? "e" : a.sexe === "m" ? "" : "(e)";
  const ou = (valeur, manque) => (valeur || "").trim() || `[${manque}]`;
  const piece = a.piece_type.replace(/^le /, "du ").replace(/^la /, "de la ");
  const identite = `Je soussigné${e}, ${ou(cv.nom, "nom et prénom")}, né${e} le ${ou(ec.date_naissance, "date de naissance")} à `
    + `${ou(ec.lieu_naissance, "lieu de naissance")}`
    + ((ec.nationalite || "").trim() ? `, de nationalité ${ec.nationalite.trim().toLowerCase()}` : "")
    + `, titulaire ${piece} n° ${ou(a.piece_numero, "numéro de la pièce")}, demeurant à ${ou(a.domicile || cv.ville, "adresse")}`;
  Object.assign(a, { titre: "", objet: "", signataires: [] });
  let paragraphes;
  if (a.genre === "attestation") {
    a.titre = "ATTESTATION SUR L'HONNEUR";
    paragraphes = [
      `${identite}, atteste sur l'honneur que ${suite(ou(a.declaration, "ce que tu déclares"), "que")}.`,
      "J'ai connaissance des sanctions prévues par la loi en cas de fausse déclaration.",
      "En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.",
    ];
  } else if (a.genre === "procuration") {
    const m = a.mandataire || {};
    a.titre = "PROCURATION";
    paragraphes = [
      `${identite}, donne par la présente procuration à ${ou(m.nom, "nom et prénom du mandataire")}`
        + `, né(e) ${ou(m.naissance, "date et lieu de naissance du mandataire")}`
        + `, titulaire de la pièce suivante : ${ou(m.piece, "pièce d'identité du mandataire et son numéro")}`
        + ((m.domicile || "").trim() ? `, demeurant à ${m.domicile.trim()}` : "")
        + `, pour ${suite(ou(a.demarche, "la démarche autorisée"), "pour")}, en mon nom et pour mon compte.`,
      "À cet effet, le mandataire pourra signer tout document, retirer toute pièce et, plus généralement, accomplir toute formalité nécessaire.",
      (a.validite || "").trim() ? `La présente procuration est valable jusqu'au ${sansPoint(a.validite)}.`
                                : "La présente procuration est valable pour cette seule démarche.",
      "Fait pour servir et valoir ce que de droit.",
    ];
    a.signataires = [{ role: "Le mandant", nom: cv.nom.trim(), mention: "« Bon pour pouvoir »" },
                     { role: "Le mandataire", nom: (m.nom || "").trim(), mention: "« Bon pour acceptation de pouvoir »" }];
  } else if (a.genre === "prise_en_charge") {
    const b = a.beneficiaire || {};
    const motif = { etudes: "ses études", visite: "son séjour", soins: "ses soins médicaux" }[a.sejour] || "son séjour";
    const frais = (a.frais || "").trim() || (a.sejour === "etudes"
      ? "les frais de scolarité, l'hébergement, la nourriture, l'assurance maladie et le billet de retour"
      : "l'hébergement, la nourriture, l'assurance maladie et le billet de retour");
    a.titre = "ATTESTATION DE PRISE EN CHARGE";
    paragraphes = [
      `${identite}${(a.ressources || "").trim() ? `, ${sansPoint(a.ressources)}` : ""}, `
        + `m'engage à prendre en charge ${ou(b.nom, "nom et prénom de la personne prise en charge")}`
        + `${(b.lien || "").trim() ? `, ${sansPoint(b.lien)}` : ""}, né(e) ${ou(b.naissance, "date et lieu de naissance")}`
        + `, titulaire de la pièce suivante : ${ou(b.piece, "passeport ou pièce d'identité et son numéro")}`
        + ((b.domicile || "").trim() ? `, demeurant à ${sansPoint(b.domicile)}` : "")
        + `, pendant toute la durée de ${motif} ${(a.destination || "").trim() ? `à ${suite(a.destination, "à")}` : "[pays, ville ou établissement]"}`
        + `, du ${ou(a.debut, "date d'arrivée")} au ${ou(a.fin, "date de départ")}.`,
      `Je m'engage à couvrir ${sansPoint(frais)}, de sorte que la personne prise en charge ne soit à la charge ni de l'État ni des organismes publics.`,
      "En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.",
    ];
  } else if (a.genre === "reclamation") {
    const civilite = civiliteAutorite(a.destinataire.nom) || "[Monsieur le…]";
    const conteste = ou(a.conteste, "la décision ou le problème contesté");
    const precisions = [(a.reference || "").trim() && `référence ${sansPoint(a.reference)}`,
                        (a.date_fait || "").trim() && `en date du ${sansPoint(a.date_fait)}`].filter(Boolean).join(", ");
    const sujet = sansPoint(suite(conteste, "contre")) + (precisions ? ` (${precisions})` : "");
    a.objet = ({ gracieux: "Recours gracieux contre ", hierarchique: "Recours hiérarchique contre " }[a.recours]
               || "Réclamation concernant ") + sujet;
    a.objet = a.objet.length > 280 ? a.objet.slice(0, 277) + "…" : a.objet;
    paragraphes = [
      `${civilite},`,
      a.recours === "reclamation"
        ? `J'ai l'honneur de porter à votre connaissance la situation suivante : ${sujet}.`
        : `J'ai l'honneur de former, par la présente, un recours ${a.recours === "gracieux" ? "gracieux" : "hiérarchique"} contre ${sujet}.`,
      (a.arguments || "").trim() || "[Expose les faits, dans l'ordre, et explique pourquoi cette décision ou cette situation n'est pas justifiée.]",
      `C'est pourquoi je vous saurais gré de bien vouloir ${suite(ou(a.reparation, "ce que tu demandes"), "de")}.`,
      ...((a.pj || "").trim() ? ["Vous trouverez ci-joint les pièces justificatives."] : []),
      `Dans l'attente de votre réponse, je vous prie d'agréer, ${civilite}, l'expression de ma considération distinguée.`,
    ];
  } else {
    const [objet, defaut] = DEMANDES[a.nature] || DEMANDES.autre;
    const civilite = civiliteAutorite(a.destinataire.nom) || "[Monsieur le…]";
    a.objet = objet;
    paragraphes = [
      `${civilite},`,
      `J'ai l'honneur de venir très respectueusement auprès de votre haute bienveillance solliciter ${sansPoint(a.precision) || defaut}.`,
      (a.motif || "").trim() || "[Explique ta situation : qui tu es, et pourquoi tu fais cette demande.]",
      `Dans l'attente d'une suite favorable, je vous prie d'agréer, ${civilite}, l'expression de mon profond respect.`,
    ];
  }
  a.corps = paragraphes.join("\n");
  const zone = $("#admin-corps");
  if (zone) zone.value = a.corps;
}
/** Ce qui part au serveur : un document sans destinataire (attestation, procuration, prise en
 *  charge) n'imprime pas l'autorité ni les pièces jointes saisies pour une demande ou un recours. */
function documentAdmin() {
  const a = etat.admin;
  return ["demande", "reclamation"].includes(a.genre) ? a : { ...a, destinataire: {}, pj: "" };
}
function afficherAdmin() {
  const a = etat.admin, t = window.tr || (x => x);
  for (const g of GENRES_ADMIN) for (const el of $$(".admin-" + g)) el.hidden = a.genre !== g;
  const lettre = a.genre === "demande" || a.genre === "reclamation";
  for (const el of $$(".admin-lettre")) el.hidden = !lettre;
  for (const el of $$(".admin-identite")) el.hidden = lettre;
  $("#admin-note").textContent = t(NOTES_ADMIN[a.genre]);
  $("[data-k='admin.frais']").placeholder = a.sejour === "etudes"
    ? "les frais de scolarité, l'hébergement, la nourriture, l'assurance maladie et le billet de retour"
    : "l'hébergement, la nourriture, l'assurance maladie et le billet de retour";
  $("#admin-precision").placeholder = (DEMANDES[a.nature] || DEMANDES.autre)[1];
  $("#admin-rediger").hidden = a.auto;
  const manques = (a.corps.match(/\[[^\]]*\]/g) || []).length;
  $("#admin-etat").textContent = !a.auto ? t("Tu as corrigé le texte : il ne change plus quand tu modifies tes réponses.")
    : manques ? t("Complète tes réponses : les passages entre [crochets] restent à remplir.")
      : t("Le texte est complet. Relis-le avant de télécharger.");
}
$("#admin-rediger").addEventListener("click", () => {
  if (!confirm((window.tr || (x => x))("Remplacer le texte actuel par un texte rédigé d'après tes réponses ?"))) return;
  etat.admin.auto = true; redigerAdmin(); afficherAdmin(); modifie(0);
});

// ---------- Onglets CV / Lettre, conseil, jauge ----------
function afficherType() {
  for (const b of $$(".onglets button")) b.setAttribute("aria-selected", String(b.dataset.type === etat.type));
  for (const el of $$(".pour-cv, .pour-lettre, .pour-admin, .pour-plan, .pour-arbre")) el.hidden = !el.classList.contains("pour-" + etat.type);
  $("#import").hidden = ["admin", "plan", "arbre"].includes(etat.type);
  if (typeof arbreAfficher === "function") arbreAfficher();
  if (typeof planAfficher === "function") planAfficher();
  afficherAdmin();
  $("#conseil-modele").textContent = CONSEILS[etat.options.modele] || "";
  afficherImport();
  afficherProgres();
}
for (const b of $$(".onglets button")) {
  b.addEventListener("click", () => { etat.type = b.dataset.type; redigerAdmin(); remplirChamps(); afficherType(); modifie(0); });
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

// ---------- Score du CV : ce qui manque, et ce qui rendrait le CV plus convaincant ----------
// Chaque critère rapporte des points (total 100) ; ceux qui ne sont pas remplis donnent un
// conseil, du plus important au moins important. Clic sur un conseil : on va à la rubrique.
const rempli = v => typeof v === "string" && v.trim() !== "";
const nbChiffres = v => (String(v || "").match(/\d/g) || []).length;
function texteDuCV(cv) {
  const morceaux = [];
  const parcourir = v => { if (typeof v === "string") { if (!v.startsWith("data:")) morceaux.push(v); }
                           else if (v && typeof v === "object") Object.values(v).forEach(parcourir); };
  parcourir(cv);
  return morceaux.join(" ");
}
function criteresCV(cv) {
  const exps = cv.experiences.filter(e => rempli(e.poste) || rempli(e.entreprise));
  const forms = cv.formations.filter(f => rempli(f.diplome));
  const langues = cv.langues.filter(l => rempli(l.langue));
  const nbCompetences = cv.competences.flatMap(c => (c.liste || "").split(/[,;\n]/)).filter(rempli).length;
  const profil = (cv.profil || "").trim().length;
  const volume = texteDuCV(cv).length;
  return [
    // [points, réussi ?, conseil, rubrique où aller]
    [6, rempli(cv.nom), "Indique ton nom et ton prénom.", "[data-k='cv.nom']"],
    [6, rempli(cv.titre), "Indique le poste que tu vises : c'est la première chose que lit le recruteur.", "[data-k='cv.titre']"],
    [6, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((cv.email || "").trim()), "Ajoute une adresse e-mail valide.", "[data-k='cv.email']"],
    [5, nbChiffres(cv.telephone) >= 8, "Ajoute ton numéro de téléphone, avec l'indicatif du pays.", "[data-k='cv.telephone']"],
    [3, rempli(cv.ville), "Indique ta ville : les recruteurs cherchent souvent près de chez eux.", "[data-k='cv.ville']"],
    [8, exps.length > 0, "Ajoute au moins une expérience : stage, emploi, job d'été, bénévolat…", "[data-liste='experiences']"],
    [6, forms.length > 0, "Ajoute ta formation (diplôme, école).", "[data-liste='formations']"],
    [5, nbCompetences > 0, "Liste tes compétences.", "[data-liste='competences']"],
    [5, langues.length > 0, "Indique les langues que tu parles.", "[data-liste='langues']"],
    [8, profil >= 150 && profil <= 900,
      profil === 0 ? "Écris quelques lignes de profil : qui tu es, ce que tu sais faire, ce que tu cherches."
        : profil < 150 ? "Étoffe ton profil : 3 ou 4 phrases sur ton expérience et ton objectif."
          : "Raccourcis ton profil : 4 ou 5 phrases suffisent.", "[data-k='cv.profil']"],
    [6, exps.length > 0 && exps.every(e => rempli(e.dates)), "Ajoute les dates de chaque expérience.", "[data-liste='experiences']"],
    [4, exps.length > 0 && exps.every(e => rempli(e.entreprise)), "Indique l'entreprise de chaque expérience.", "[data-liste='experiences']"],
    [7, exps.length > 0 && exps.every(e => (e.points || "").split("\n").filter(rempli).length >= 2),
      "Décris au moins deux missions par expérience, en commençant par un verbe d'action (« Gérer », « Organiser »…).", "[data-liste='experiences']"],
    [5, exps.some(e => /\d/.test(e.points || "")),
      "Chiffre tes résultats (« 300 factures par mois », « +20 % de ventes ») : c'est ce qui convainc le plus.", "[data-liste='experiences']"],
    [4, forms.length > 0 && forms.every(f => rempli(f.dates)), "Ajoute les dates de chaque formation.", "[data-liste='formations']"],
    [4, langues.length > 0 && langues.every(l => rempli(l.niveau)), "Précise ton niveau dans chaque langue.", "[data-liste='langues']"],
    [4, nbCompetences >= 6, "Cite au moins six compétences, regroupées par catégorie (Informatique, Gestion…).", "[data-liste='competences']"],
    [3, rempli(cv.interets), "Ajoute quelques centres d'intérêt : ils donnent envie de te rencontrer.", "[data-k='cv.interets']"],
    // Longueur : comptée seulement pour un CV déjà commencé (un CV vide n'est pas « de bonne longueur »).
    [5, exps.length > 0 && volume <= 5500, volume > 5500
      ? "Ton CV est très long et risque de dépasser deux pages : garde l'essentiel des expériences les plus récentes." : "",
      "[data-liste='experiences']"],
  ];
}
function allerA(selecteur) {
  const cible = $(selecteur);
  if (!cible) return;
  for (let d = cible.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
  cible.scrollIntoView({ behavior: "smooth", block: "center" });
  const champ = cible.matches("input, textarea, select") ? cible
    : cible.querySelector("input:not(:disabled), textarea, select") || cible.querySelector("button:not(:disabled)");
  champ?.focus({ preventScroll: true });
}
function afficherProgres() {
  afficherLongueurLettre();
  const t = window.tr || (x => x);
  const criteres = criteresCV(etat.cv);
  const score = criteres.reduce((s, [points, ok]) => s + (ok ? points : 0), 0);
  const conseils = criteres.filter(([, ok, texte]) => !ok && texte).sort((a, b) => b[0] - a[0]);
  // Offre collée dans « Adapter à une offre d'emploi » : les mots-clés absents du CV deviennent
  // un conseil de plus (il ne change pas la note sur 100, qui mesure le CV lui-même).
  const offre = afficherOffre();
  if (offre && offre.manquants.length) {
    const mots = offre.manquants.slice(0, 6).map(m => m.mot).join(", ") + (offre.manquants.length > 6 ? "…" : "");
    conseils.push(["offre", false, `Mots-clés de l'offre absents de ton CV : ${mots}`, "#offre"]);
  }
  $("#progres").value = score;
  $("#score-valeur").textContent = score;
  $("#score").dataset.niveau = score >= 85 ? "bon" : score >= 60 ? "moyen" : "faible";
  $("#progres-texte").textContent = score >= 85 && !conseils.length ? "Excellent CV, prêt à être envoyé"
    : score >= 85 ? "Très bon CV" : score >= 60 ? "Bon début, encore quelques améliorations" : "Complète ton CV";
  $("#score-voir").textContent = conseils.length
    ? (conseils.length > 1 ? `${conseils.length} conseils` : "1 conseil") : "";
  $("#score-conseils").replaceChildren(...conseils.map(([points, , texte, cible]) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button"; b.className = "score-conseil";
    const gain = document.createElement("span"); gain.className = "score-gain";
    gain.textContent = points === "offre" ? `${offre.taux} %` : `+${points}`;
    if (points === "offre") gain.title = t("Correspondance avec l'offre");
    b.append(gain, " ", t(texte));
    b.addEventListener("click", () => { if (cible === "#offre") $("#offre").open = true; allerA(cible); });
    li.append(b);
    return li;
  }));
}

// ---------- Adapter le CV à une offre : mots-clés de l'annonce présents ou absents du CV ----------
// Tout se fait ici, dans le navigateur : l'annonce n'est envoyée nulle part (sauf, comme le reste
// du document, dans le compte de la personne si elle en a un).
// Mots sans intérêt pour un recruteur : mots courants (trois langues), et vocabulaire de toutes les annonces.
const MOTS_VIDES = new Set((
  // français
  "a afin ai aie ainsi alors apres au aucun aupres aussi autre autres aux avant avec avez avoir ayant bien bon bonne ce ceci cela celle celles celui " +
  "ces cet cette chacun chaque chez ci comme comment dans de des deja depuis donc dont du elle elles en encore entre est et etc ete etre eu " +
  "fait faire faut il ils je jusqu la le les leur leurs lors lui mais me meme mes moins mon ne ni nos notre nous on ont ou par parmi pas peu " +
  "peut plus plusieurs pour pourquoi qu que quel quelle quelles quels qui sa sans se selon ser ses si soit son sont sous sur ta te tes ton tous " +
  "tout toute toutes tres tu un une unes uns vers via vos votre vous y cas lieu sein ainsi celle dès des tant toujours souhaite souhaitez " +
  // annonces (français)
  "poste postes profil profils candidat candidate candidats candidature candidatures entreprise entreprises societe groupe mission missions " +
  "offre offres emploi emplois recherche recherchons recrute recrutons recrutement rejoindre rejoignez rejoins integrer integrez equipe equipes " +
  "experience experiences annee annees an ans mois minimum maximum niveau souhaite souhaitee souhaitable requis requise exige exigee " +
  "idealement idealement serait atout plus principales principaux principale principal notamment egalement afin cadre sein " +
  "salaire remuneration avantages avantage contrat cdi cdd interim temps plein partiel h/f f/h hf fh date debut prise fonction poste " +
  "lieu travail travailler ville region pays localisation adresse envoyer envoyez merci contact contacter postuler postulez cv lettre motivation " +
  "vous etes serez aurez avez savez votre vos nous sommes notre nos client clients ensemble assurer assurez participer participez " +
  "realiser realisez gerer gerez veiller contribuer contribuez accompagner mettre place oeuvre ensemble tache taches activite activites " +
  "capacite capacites bonne bonnes tres grande grand forte fort sens esprit qualite qualites aptitude aptitudes connaissance connaissances " +
  "maitrise maitriser maitrisez justifiez justifier disposez disposer possedez posseder dote dotee doit devra devez permettant permettra " +
  "diplome diplomes formation bac nouveau nouvelle nouveaux interne externe sera seront etc jour jours semaine semaines heures horaires " +
  // anglais
  "the and or of to in for on with at by from as is are be been being an a this that these those it its our your you we they their " +
  "will would can could should may must have has had not no but if then than so such into over under about all any each other more most " +
  "job jobs role roles position positions company team teams candidate candidates apply application looking seeking join work working " +
  "experience years year required requirements preferred plus strong good excellent ability skills skill knowledge responsibilities " +
  "responsible including include etc full time part salary benefits location based within across ensure support help new " +
  // italien
  "il lo gli i della delle dello degli del dei al alla alle allo agli ai da dal dalla dai con su per tra fra e ed o un uno una che chi " +
  "non come anche piu sono essere avere ha hanno nel nella nelle negli nei questo questa questi queste quello quella suo sua loro nostro " +
  "nostra nostri vostro vostra ruolo posizione azienda candidato candidata candidati offerta lavoro ricerca ricerchiamo cerchiamo " +
  "esperienza anni anno requisiti richiesti richiesta preferibile buona buone ottima ottime capacita conoscenza conoscenze competenze " +
  "attivita sede contratto tempo pieno indeterminato determinato inserimento squadra team"
).split(/\s+/));
// Lettres accentuées -> sans accent, en minuscules : « Comptabilité » et « comptabilite » sont le même mot.
const sansAccent = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Racine grossière : « comptable », « comptabilité » -> « comptab » ; on cherche les mots qui commencent pareil.
function racineMot(mot) {
  let m = mot.replace(/(?<=\w{4})[sx]$/, "");
  if (m.length > 6) m = m.slice(0, Math.max(6, m.length - 2));
  return m;
}
const MOT = /[\p{L}\p{N}][\p{L}\p{N}+#.\-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu;
function motsDe(texte) {
  // « l'expérience », « d'Excel » : on garde ce qui suit l'apostrophe.
  return (texte.replace(/\b[\p{L}]{1,2}['’]/gu, " ").match(MOT) || []).map(m => m.replace(/[.\-]+$/, ""));
}

/** Les mots-clés de l'annonce (20 au plus), du plus important au moins important. */
function motsClesOffre(texte) {
  const trouves = new Map();       // racine -> { mot, poids, rang }
  motsDe(texte).forEach((brut, rang) => {
    const simple = sansAccent(brut);
    if (/^\d+$/.test(simple) || MOTS_VIDES.has(simple)) return;
    const sigle = /^[A-Z0-9+#]{2,}$/.test(brut) && /[A-Z]/.test(brut);     // SAP, RH, C++, B2B
    if (simple.length < 3 && !sigle) return;
    // Nom propre ou outil (Excel, Python) : une majuscule ailleurs qu'en début de phrase.
    const debutPhrase = rang === 0 || /[.!?:\n•\-]\s*$/.test(texte.slice(0, texte.indexOf(brut)).slice(-3));
    const special = sigle || /[+#\d]/.test(brut) || (/^\p{Lu}/u.test(brut) && !debutPhrase);
    const cle = racineMot(simple);
    const fiche = trouves.get(cle) || { mot: brut, poids: 0, rang, recherche: cle };
    fiche.poids += 1 + (special ? 1 : 0);
    if (special && !/^\p{Lu}/u.test(fiche.mot)) fiche.mot = brut;        // garder la forme avec majuscule
    trouves.set(cle, fiche);
  });
  return [...trouves.values()]
    .sort((a, b) => b.poids - a.poids || a.rang - b.rang)
    .slice(0, 20);
}

/** Analyse de l'offre et affichage ; renvoie { taux, presents, manquants } ou null sans offre. */
function afficherOffre() {
  const zone = $("#offre-resultat");
  if (!zone) return null;
  const mots = (etat.offre || "").trim().length >= 40 ? motsClesOffre(etat.offre) : [];
  zone.hidden = !mots.length;
  if (!mots.length) { $("#offre-taux").textContent = ""; return null; }
  const texteCV = " " + motsDe(texteDuCV({ ...etat.cv, photo: "" })).map(sansAccent).join(" ");
  const present = m => texteCV.includes(" " + m.recherche);
  const presents = mots.filter(present), manquants = mots.filter(m => !present(m));
  const taux = Math.round(100 * presents.length / mots.length);
  const t = window.tr || (x => x);
  $("#offre-taux").textContent = t(`${taux} % de correspondance`);
  $("#offre").dataset.niveau = taux >= 70 ? "bon" : taux >= 40 ? "moyen" : "faible";
  $("#offre-titre-manque").textContent = manquants.length
    ? t(`Absents de ton CV (${manquants.length})`) : t("Tous les mots-clés de l'offre sont dans ton CV.");
  $("#offre-titre-present").textContent = presents.length ? t(`Déjà dans ton CV (${presents.length})`) : "";
  $("#offre-aide").hidden = !manquants.length;
  $("#offre-manque").replaceChildren(...manquants.map(m => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "puce-mot manque"; b.textContent = "+ " + m.mot;
    b.title = t("Ajouter à mes compétences");
    b.addEventListener("click", () => ajouterCompetence(m.mot));
    return b;
  }));
  $("#offre-present").replaceChildren(...presents.map(m => {
    const s = document.createElement("span");
    s.className = "puce-mot present"; s.textContent = "✓ " + m.mot;
    return s;
  }));
  return { taux, presents, manquants };
}

function ajouterCompetence(mot) {
  if (!confirm((window.tr || (x => x))("Ajouter ce mot à tes compétences ? Fais-le seulement si tu as vraiment cette compétence.") + `\n\n${mot}`)) return;
  const liste = etat.cv.competences;
  // Dans la dernière catégorie qui a de la place, sinon une nouvelle ligne.
  const cible = [...liste].reverse().find(c => (c.liste || "").length + mot.length < 480);
  if (cible) cible.liste = (cible.liste || "").trim() ? `${cible.liste.trim().replace(/[,;]$/, "")}, ${mot}` : mot;
  else liste.push({ categorie: "", liste: mot });
  dessinerListe("competences");
  modifie();
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
  if (etat.type === "plan") return etat.plan.elements.length ? "" : "Dessine ton plan, ou utilise l'assistant itinéraire.";
  if (etat.type === "arbre") return etat.arbre.racine.nom.trim() ? "" : "Indique le nom de l'ancêtre pour voir l'aperçu.";
  if (!etat.cv.nom.trim()) return "Renseigne ton nom pour voir l'aperçu.";
  if (etat.type === "lettre" && !texteLettre(etat.lettre)) return "Écris le texte de la lettre pour voir l'aperçu.";
  if (etat.type === "admin" && !etat.admin.corps.trim()) return "Écris le texte du document pour voir l'aperçu.";
  return "";
}

async function appeler(chemin, signal) {
  let reponse;
  try {
    reponse = await fetch(chemin, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: etat.type, cv: etat.cv, lettre: etat.lettre, admin: documentAdmin(), plan: etat.plan, arbre: etat.arbre, options: etat.options }),
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
    lien.download = etat.type === "arbre" ? "Arbre_genealogique.pdf" : etat.type === "plan" ? "Plan_de_localisation.pdf"
      : `${{ lettre: "Lettre", admin: "Document" }[etat.type] || "CV"}_${nom || "document"}.pdf`;
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
  if (etat.type === "plan") return "Plan_de_localisation.pdf";
  if (etat.type === "arbre") return "Arbre_genealogique.pdf";
  return `${{ lettre: "Lettre", admin: "Document", plan: "Plan" }[etat.type] || "CV"}_${nom || "document"}.pdf`;
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
// Arrivée par « Adapter mon CV à une offre » (/creer?offre=1) : la carte s'ouvre, prête à recevoir l'annonce.
if (parametres.get("offre") === "1" && etat.type === "cv") {
  $("#offre").open = true;
  $("#offre").scrollIntoView({ block: "start" });
  $("[data-k='offre']").focus({ preventScroll: true });
}

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
  if (!compte.connecte) partageActuel = null;
  afficherQr();
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
  etat = fusionner({ ...reponse.donnees, type: typeDemande || etat.type });
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
        // « Copier en anglais… » depuis Mon espace : la copie est convertie dans sa nouvelle langue.
        if (parametres.get("langue")) traduireDocument(parametres.get("langue"));
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
  await verifierPartage();
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
  partageActuel = null;
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
    await verifierPartage();
  }
  // Arrivée par le lien « Se connecter » des autres pages (/creer?compte=1) :
  // on ouvre directement la fenêtre du compte.
  if (parametres.get("compte") === "1") $("#btn-compte").click();
})();
