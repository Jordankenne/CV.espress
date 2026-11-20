"use strict";
// Éditeur (page /creer) : l'assistant IA (POST /api/ia/analyse, voir ia.py).
// Chargé après les fichiers editeur-*.js : il s'appuie sur etat, compte, ouvrirCompte, toutDessiner, modifie.
// Le texte écrit par l'IA est toujours inséré comme du texte (textContent), jamais comme du HTML.
(() => {
  const t = x => (window.tr || (y => y))(x);
  const CLE_ACCORD = "cv-express-ia-accord";
  let infos = null;          // réponse de GET /api/ia

  const element = (nom, texte, classe) => {
    const e = document.createElement(nom);
    if (texte !== undefined) e.textContent = texte;
    if (classe) e.className = classe;
    return e;
  };
  const montrer = (sel, texte) => { $(sel).textContent = texte || ""; $(sel).hidden = !texte; };

  function afficherQuota() {
    if (!infos?.actif) return;
    $("#ia-quota").textContent = infos.restant == null
      ? `${infos.par_jour} analyses par jour`
      : `${infos.restant}/${infos.par_jour} aujourd'hui`;
  }

  async function chargerInfos() {
    try {
      const r = await fetch("/api/ia", { credentials: "same-origin", headers: { Accept: "application/json" } });
      infos = await r.json();
    } catch { infos = null; }
    document.body.dataset.ia = infos?.actif ? "actif" : "";
    if (!infos?.actif) return;
    $("#ia-fournisseur").textContent = infos.fournisseur;
    afficherQuota();
  }

  // L'accord est redemandé tant que la case n'a pas été cochée une fois sur cet appareil.
  try { $("#ia-accord").checked = localStorage.getItem(CLE_ACCORD) === "1"; } catch { /* stockage indisponible */ }
  $("#ia-accord").addEventListener("change", e => {
    try { localStorage.setItem(CLE_ACCORD, e.target.checked ? "1" : "0"); } catch { /* stockage indisponible */ }
    if (e.target.checked) montrer("#ia-erreur", "");
  });

  // ---------- Appliquer une proposition : seulement si le passage « avant » est trouvé une seule fois ----------
  function emplacements(objet, avant, trouves = []) {
    for (const [cle, valeur] of Object.entries(objet || {})) {
      if (typeof valeur === "string") {
        const n = valeur.split(avant).length - 1;
        for (let i = 0; i < n; i++) trouves.push([objet, cle]);
      } else if (valeur && typeof valeur === "object") emplacements(valeur, avant, trouves);
    }
    return trouves;
  }
  function appliquer(s) {
    const trouves = s.avant ? emplacements(etat.cv, s.avant) : [];
    if (trouves.length !== 1) return false;
    const [objet, cle] = trouves[0];
    objet[cle] = objet[cle].replace(s.avant, s.apres);
    toutDessiner();
    modifie(0);
    return true;
  }

  // ---------- Affichage du résultat ----------
  function liste(titre, elements) {
    if (!elements?.length) return null;
    const bloc = element("div", undefined, "ia-bloc");
    const ul = element("ul");
    ul.setAttribute("translate", "no");              // le texte de l'IA est déjà dans la bonne langue
    for (const texte of elements) ul.append(element("li", texte));
    bloc.append(element("h4", t(titre)), ul);
    return bloc;
  }

  function carteSuggestion(s) {
    const carte = element("div", undefined, "ia-suggestion");
    const texte = element("div");
    texte.setAttribute("translate", "no");
    texte.append(element("span", s.rubrique, "rubrique"));
    if (s.avant) texte.append(element("del", s.avant));
    texte.append(element("ins", s.apres));
    if (s.raison) texte.append(element("p", s.raison, "raison"));
    carte.append(texte);
    if (s.a_verifier) carte.append(element("p", t("Contient un chiffre absent de ton CV : vérifie qu'il est exact avant de l'utiliser."), "verifier"));
    const actions = element("div", undefined, "actions");
    const appliquerBouton = element("button", t("Appliquer"), "bouton mini");
    appliquerBouton.type = "button";
    const peutAppliquer = s.avant && emplacements(etat.cv, s.avant).length === 1;
    appliquerBouton.hidden = !peutAppliquer;
    appliquerBouton.addEventListener("click", () => {
      if (s.a_verifier && !confirm(t("Cette proposition contient un chiffre qui n'est pas dans ton CV. L'appliquer quand même ?"))) return;
      if (appliquer(s)) { carte.classList.add("appliquee"); actions.replaceChildren(element("span", t("Appliqué"), "note")); }
    });
    const copier = element("button", t("Copier"), "bouton mini");
    copier.type = "button";
    copier.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(s.apres); copier.textContent = t("Copié"); } catch { /* presse-papiers refusé */ }
    });
    const ignorer = element("button", t("Ignorer"), "bouton mini");
    ignorer.type = "button";
    ignorer.addEventListener("click", () => carte.remove());
    actions.append(appliquerBouton, copier, ignorer);
    carte.append(actions);
    return carte;
  }

  function afficherResultat(r) {
    const zone = $("#ia-resultat");
    const morceaux = [];
    const note = element("p", undefined, "ia-note");
    note.append(element("strong", String(r.note)), element("span", t("sur 100 : qualité générale du CV")));
    morceaux.push(note, element("p", t("Une estimation pour t'aider à progresser, pas une garantie de passer les logiciels de tri ou d'obtenir un entretien."), "ia-avertissement"));

    const tableau = element("table", undefined, "ia-criteres");
    for (const c of r.criteres) {
      const ligne = element("tr");
      const nom = element("td", t(c.nom));
      const commentaire = element("small", c.commentaire);
      commentaire.setAttribute("translate", "no");
      nom.append(commentaire);
      ligne.append(nom, element("td", `${c.note}/10 · ${c.poids} %`));
      tableau.append(ligne);
    }
    morceaux.push(tableau);

    if (r.offre) {
      const bloc = element("div", undefined, "ia-bloc");
      const n = element("p", undefined, "ia-note");
      n.append(element("strong", String(r.offre.note)), element("span", t("sur 100 : correspondance avec l'offre")));
      bloc.append(element("h4", t("Ton CV face à l'offre")), n);
      morceaux.push(bloc);
      for (const [titre, elements] of [["Ce que l'offre demande et que ton CV montre", r.offre.correspondances],
                                        ["Ce que l'offre demande et que ton CV ne montre pas encore", r.offre.ecarts],
                                        ["Mots-clés de l'offre absents de ton CV", r.offre.mots_cles_absents]]) {
        const l = liste(titre, elements);
        if (l) morceaux.push(l);
      }
    }
    for (const [titre, elements] of [["Points forts", r.points_forts], ["À corriger en priorité", r.alertes]]) {
      const l = liste(titre, elements);
      if (l) morceaux.push(l);
    }
    if (r.suggestions.length) {
      const bloc = element("div", undefined, "ia-bloc");
      bloc.append(element("h4", t("Propositions de réécriture")));
      for (const s of r.suggestions) bloc.append(carteSuggestion(s));
      morceaux.push(bloc);
    }
    const q = liste("Pour aller plus loin, réponds à ces questions dans ton CV", r.questions);
    if (q) morceaux.push(q);
    zone.replaceChildren(...morceaux);
    zone.hidden = false;
  }

  // ---------- Lancer l'analyse ----------
  async function lancer() {
    montrer("#ia-erreur", "");
    if (!$("#ia-accord").checked) return montrer("#ia-erreur", t("Coche la case pour accepter l'envoi de ton CV à l'assistant IA."));
    const bouton = $("#ia-lancer");
    bouton.disabled = true;
    montrer("#ia-etat", t("Analyse en cours… (10 à 30 secondes)"));
    try {
      const r = await fetch("/api/ia/analyse", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cv: etat.cv, offre: etat.offre || "", langue: window.LANGUE_SITE || "fr", accord: true }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(120_000) : undefined,
      });
      const corps = await r.json().catch(() => ({}));
      if (typeof corps.restant === "number" && infos) { infos.restant = corps.restant; afficherQuota(); }
      if (!r.ok) {
        if (corps.compte_requis) { compte = { connecte: false, email: null }; return ouvrirCompte(lancer, true); }
        return montrer("#ia-erreur", corps.erreur || t("L'assistant IA n'a pas pu analyser ce CV. Réessaie."));
      }
      afficherResultat(corps.resultat);
    } catch {
      montrer("#ia-erreur", t("Connexion impossible. Vérifie ta connexion Internet et réessaie."));
    } finally {
      montrer("#ia-etat", "");
      bouton.disabled = false;
    }
  }
  $("#ia-lancer").addEventListener("click", () => {
    if (!$("#ia-accord").checked) return montrer("#ia-erreur", t("Coche la case pour accepter l'envoi de ton CV à l'assistant IA."));
    // L'assistant demande toujours un compte (quota par compte), même si le téléchargement n'en demande pas.
    if (compte.connecte) lancer();
    else ouvrirCompte(async () => { await chargerInfos(); lancer(); }, true);
  });

  chargerInfos();
})();
