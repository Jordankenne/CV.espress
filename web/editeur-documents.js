"use strict";
// Éditeur (page /creer), partie 3/5 : Documents administratifs, onglets, score du CV, adaptation à une offre.
// Les cinq fichiers editeur-*.js se chargent dans l'ordre (voir creer.html) et partagent leurs
// variables : ce qui est déclaré dans un fichier sert dans les suivants.

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
