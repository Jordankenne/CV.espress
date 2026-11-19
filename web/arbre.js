"use strict";
/*
 * Arbre généalogique : saisie de la famille, en partant de l'ancêtre.
 *
 * etat.arbre.racine = personne ; personne = {nom, sexe, naissance, deces, decede, lieu, unions: [union…]} ;
 * union = {conjoint: {nom, sexe, naissance, deces, decede, lieu} | null, enfants: [personne…]}.
 * Le serveur (arbre.py) calcule la disposition et dessine le PDF ; l'aperçu est celui de l'éditeur.
 * S'appuie sur l'éditeur, editeur-*.js (etat, modifie, $, $$).
 */
(() => {
  const t = x => (window.tr || (y => y))(x);
  const PERSONNES_MAX = 250, GENERATIONS_MAX = 7;
  const ouverts = new WeakMap();            // personnes dont la fiche est dépliée (n'est pas enregistré)
  const zone = $("#arbre-editeur");

  const personneVide = () => ({ nom: "", sexe: "", naissance: "", deces: "", decede: false, lieu: "", unions: [] });
  function compter(p) {
    return 1 + (p.unions || []).reduce((s, u) => s + (u.conjoint ? 1 : 0)
      + (u.enfants || []).reduce((n, e) => n + compter(e), 0), 0);
  }
  function descendants(p) {
    return (p.unions || []).reduce((s, u) => s + (u.enfants || []).reduce((n, e) => n + 1 + descendants(e), 0), 0);
  }
  /** Modification de la structure (ajout, suppression) : on redessine le formulaire. */
  // Un court délai : plusieurs ajouts rapides ne demandent qu'un seul aperçu au serveur.
  function structure() { dessiner(); modifie(700); }

  function champ(objet, cle, libelle, genre = "texte", options) {
    const label = document.createElement("label");
    label.textContent = t(libelle);
    let saisie;
    if (genre === "choix") {
      saisie = document.createElement("select");
      saisie.replaceChildren(...options.map(([v, x]) => new Option(t(x), v)));
      saisie.value = objet[cle] || "";
    } else if (genre === "case") {
      label.className = "case"; label.textContent = "";
      saisie = document.createElement("input"); saisie.type = "checkbox"; saisie.checked = !!objet[cle];
    } else {
      saisie = document.createElement("input");
      saisie.maxLength = genre === "date" ? 40 : 80;
      saisie.value = objet[cle] || "";
      if (genre === "date") saisie.placeholder = t("1950, ou 12 mars 1950");
    }
    saisie.addEventListener(genre === "texte" || genre === "date" ? "input" : "change", () => {
      objet[cle] = genre === "case" ? saisie.checked : saisie.value;
      if (cle === "nom") rafraichirTitres();
      modifie(genre === "texte" || genre === "date" ? 1200 : 700);
    });
    if (genre === "case") label.append(saisie, " " + t(libelle)); else label.append(saisie);
    return label;
  }
  const SEXES = [["", "Non précisé"], ["h", "Homme"], ["f", "Femme"]];
  function champsIdentite(grille, objet) {
    grille.append(champ(objet, "nom", "Nom et prénom"), champ(objet, "sexe", "Sexe", "choix", SEXES),
                  champ(objet, "naissance", "Naissance", "date"), champ(objet, "lieu", "Lieu (naissance ou résidence)"),
                  champ(objet, "decede", "Décédé(e)", "case"), champ(objet, "deces", "Décès", "date"));
  }
  function bouton(texte, action, classe = "mini") {
    const b = document.createElement("button");
    b.type = "button"; b.className = classe; b.textContent = t(texte);
    b.addEventListener("click", action);
    return b;
  }

  /** Fiche d'une personne, avec ses unions et (dedans) ses enfants. */
  function fiche(p, generation, retirer) {
    const carte = document.createElement("details");
    carte.className = `personne-carte gen-${Math.min(generation, 6)}`;
    carte.open = ouverts.has(p) ? ouverts.get(p) : generation <= 2;
    carte.addEventListener("toggle", () => ouverts.set(p, carte.open));
    const resume = document.createElement("summary");
    resume.className = "personne-resume";
    resume.dataset.titre = "";
    carte._personne = p;
    carte.append(resume);
    const grille = document.createElement("div"); grille.className = "grille";
    champsIdentite(grille, p);
    carte.append(grille);

    p.unions = Array.isArray(p.unions) ? p.unions : [];
    p.unions.forEach((u, i) => {
      u.enfants = Array.isArray(u.enfants) ? u.enfants : [];
      const bloc = document.createElement("div"); bloc.className = "union-bloc";
      const tete = document.createElement("div"); tete.className = "union-tete";
      const titre = document.createElement("strong");
      titre.textContent = u.conjoint ? t(p.unions.filter(x => x.conjoint).length > 1 ? `Conjoint ${p.unions.slice(0, i + 1).filter(x => x.conjoint).length}` : "Conjoint")
                                     : t("Enfants sans autre parent indiqué");
      tete.append(titre, bouton("Retirer", () => {
        if (u.enfants.length && !confirm(t("Retirer ce conjoint et ses enfants de l'arbre ?"))) return;
        p.unions.splice(i, 1); structure();
      }));
      bloc.append(tete);
      if (u.conjoint) {
        const g = document.createElement("div"); g.className = "grille";
        champsIdentite(g, u.conjoint);
        bloc.append(g);
      }
      const enfants = document.createElement("div"); enfants.className = "enfants";
      u.enfants.forEach((e, k) => enfants.append(fiche(e, generation + 1, () => { u.enfants.splice(k, 1); structure(); })));
      bloc.append(enfants);
      if (generation < GENERATIONS_MAX) {
        bloc.append(bouton(u.conjoint ? "+ Ajouter un enfant de ce couple" : "+ Ajouter un enfant", () => {
          if (compter(etat.arbre.racine) >= PERSONNES_MAX) { alert(t("L'arbre a atteint le nombre maximal de personnes.")); return; }
          const enfant = personneVide();
          u.enfants.push(enfant); ouverts.set(enfant, true); structure();
          zone.querySelector("details[open] .enfants details:last-of-type input")?.focus();
        }, "ajouter"));
      }
      carte.append(bloc);
    });
    const actions = document.createElement("div"); actions.className = "personne-actions";
    actions.append(bouton("+ Conjoint", () => { p.unions.push({ conjoint: personneVide(), enfants: [] }); structure(); }));
    if (!p.unions.some(u => !u.conjoint)) {
      actions.append(bouton("+ Enfant sans autre parent connu", () => { p.unions.push({ conjoint: null, enfants: [personneVide()] }); structure(); }));
    }
    if (retirer) actions.append(bouton("Supprimer cette personne", () => {
      const n = descendants(p);
      if ((p.nom.trim() || n) && !confirm(n ? t(`Supprimer cette personne et ses ${n} descendants ?`) : t("Supprimer cette personne ?"))) return;
      retirer();
    }));
    carte.append(actions);
    return carte;
  }

  /** Le titre de chaque fiche repliée : nom, et nombre de descendants. */
  function rafraichirTitres() {
    for (const carte of zone.querySelectorAll(".personne-carte")) {
      const p = carte._personne;
      const n = descendants(p);
      const conjoints = (p.unions || []).filter(u => u.conjoint && u.conjoint.nom.trim()).map(u => u.conjoint.nom.trim());
      carte.querySelector(":scope > summary").textContent = (p.nom.trim() || t("Personne sans nom"))
        + (conjoints.length ? ` × ${conjoints.join(", ")}` : "")
        + (n ? ` · ${n} ${t(n > 1 ? "descendants" : "descendant")}` : "");
    }
    const total = compter(etat.arbre.racine);
    $("#arbre-compte").textContent = `${total} ${t(total > 1 ? "personnes dans l'arbre" : "personne dans l'arbre")}`
      + (total > 60 ? t(" · beaucoup de monde : choisis le format A3, ou fais un arbre par branche.") : "");
  }

  function dessiner() {
    const racine = etat.arbre.racine;
    const remonter = bouton("↑ Ajouter les parents de l'ancêtre (remonter d'une génération)", () => {
      const parent = personneVide();
      parent.unions = [{ conjoint: personneVide(), enfants: [racine] }];
      etat.arbre.racine = parent; ouverts.set(parent, true); structure();
      zone.querySelector("input")?.focus();
    }, "ajouter");
    zone.replaceChildren(remonter, fiche(racine, 1, null));
    rafraichirTitres();
  }

  window.arbreAfficher = function arbreAfficher() {
    if (etat.type !== "arbre") return;
    dessiner();
  };
  arbreAfficher();      // l'éditeur a déjà affiché l'onglet avant que ce script soit chargé
})();
