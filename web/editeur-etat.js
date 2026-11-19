"use strict";
// Éditeur (page /creer), partie 1/5 : État du formulaire, sauvegarde dans le navigateur, outils communs, centres d'intérêt.
// Les cinq fichiers editeur-*.js se chargent dans l'ordre (voir creer.html) et partagent leurs
// variables : ce qui est déclaré dans un fichier sert dans les suivants.

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
let actionApresConnexion = null;   // ce qu'il faut faire une fois connecté (télécharger le PDF…)
let compteRequisPourPdf = true;    // réglage du serveur (COMPTE_OBLIGATOIRE), lu à l'ouverture de la page
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
// Pages « Demande administrative », « Attestation sur l'honneur » : /creer?type=admin&genre=attestation
if (typeDemande === "admin" && GENRES_ADMIN.includes(parametres.get("genre"))) etat.admin.genre = parametres.get("genre");

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function sauvegarder() {
  try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(etat)); } catch { /* quota ou navigation privée */ }
  aEnvoyer();   // compte connecté : la modification partira aussi vers le serveur
}
