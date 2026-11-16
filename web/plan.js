"use strict";
/*
 * Plan de localisation : éditeur de dessin (SVG) et assistant itinéraire.
 *
 * Les éléments dessinés sont dans etat.plan.elements (même forme que ce qu'attend plan.py) :
 *   route     {points: [[x, y]…], largeur, lisse}      carrefour {x, y, r, nom, style, position}
 *   batiment  {x, y, icone, nom, taille, position}      ici       {x, y, nom, taille, position}
 *   fleche    {points: [[x1, y1], [x2, y2]], couleur, epaisse}
 *   interdit  {x, y}                                    texte     {x, y, nom, taille, angle, gras, couleur}
 * Coordonnées : 1000 × 500 en paysage, 700 × 820 en portrait (y vers le bas). Le serveur dessine
 * le PDF avec les mêmes règles (routes noires puis blanches par-dessus, mêmes pictogrammes).
 * S'appuie sur app.js (etat, modifie, $, $$).
 */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const FORMATS = { paysage: [1000, 500], portrait: [700, 820] };
  const COULEURS = { noir: "#1A1A1A", gris: "#8A8A8A", gris_clair: "#D9D9D9", rouge: "#D62828", bleu: "#3D6FB6",
                     vert: "#2E8B57", orange: "#F28C28", jaune_clair: "#FFF3C4", fond: "#FFFFFF" };
  const TRAIT = 2.2, GRILLE = 10;
  const t = x => (window.tr || (y => y))(x);
  const svg = $("#plan-svg");
  let icones = {};
  let outil = "selection", choix = -1, enCours = null, glisse = null, historique = [];
  window.planVoirPdf = false;

  fetch("/plan-icones.json").then(r => r.json()).then(j => { icones = j; dessiner(); }).catch(() => {});

  const plan = () => etat.plan;
  const elements = () => etat.plan.elements;
  const taille = () => FORMATS[plan().orientation] || FORMATS.paysage;

  // ---------- Historique (Annuler) ----------
  function memoriser() {
    historique.push(JSON.stringify(elements()));
    if (historique.length > 60) historique.shift();
  }
  function annuler() {
    if (!historique.length) return;
    etat.plan.elements = JSON.parse(historique.pop());
    choix = -1; enCours = null; changer();
  }
  /** Après chaque modification : dessin, panneau, enregistrement. */
  function changer(sauver = true) {
    dessiner(); proprietes();
    if (sauver) modifie(0);
  }

  // ---------- Dessin SVG ----------
  function el(nom, attributs = {}, parent) {
    const n = document.createElementNS(NS, nom);
    for (const [k, v] of Object.entries(attributs)) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  }
  function chemin(points, lisse) {
    if (!lisse || points.length < 3) return "M" + points.map(p => p.join(" ")).join(" L");
    let d = `M${points[0].join(" ")}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1.join(" ")} ${c2.join(" ")} ${p2.join(" ")}`;
    }
    return d;
  }
  function etiquette(parent, x, y, texte, { taille: tl = 13, position = "droite", ecart = 0, couleur = "noir", gras = false, angle = 0 } = {}) {
    if (!texte) return;
    const ancre = { droite: "start", gauche: "end", dessus: "middle", dessous: "middle", centre: "middle" }[position];
    const [dx, dy] = { droite: [ecart, 0], gauche: [-ecart, 0], dessus: [0, -ecart], dessous: [0, ecart], centre: [0, 0] }[position];
    const base = { dessus: "auto", dessous: "hanging" }[position] || "central";
    const n = el("text", { x: x + dx, y: y + dy, "text-anchor": ancre, "dominant-baseline": base, "font-size": tl,
                           "font-weight": gras ? "bold" : "normal", fill: COULEURS[couleur] || COULEURS.noir,
                           transform: angle ? `rotate(${-angle} ${x + dx} ${y + dy})` : "", class: "plan-etiquette" }, parent);
    n.textContent = texte;
  }
  function icone(parent, nom, x, y, k) {
    const g = el("g", { transform: `translate(${x - 30 * k} ${y - 30 * k}) scale(${k})` }, parent);
    for (const f of icones[nom] || []) {
      if (f[0] === "texte") {
        const n = el("text", { x: f[1], y: f[2], "text-anchor": "middle", "dominant-baseline": "central", "font-size": f[4],
                               "font-weight": "bold", fill: COULEURS[f[5]] }, g);
        n.textContent = f[3];
        continue;
      }
      const style = { stroke: COULEURS[f[f.length - 1]], fill: f[f.length - 2] === "aucun" ? "none" : COULEURS[f[f.length - 2]],
                      "stroke-width": 1.6, "stroke-linejoin": "round" };
      if (f[0] === "poly") el("polygon", { points: f[1].map(p => p.join(",")).join(" "), ...style }, g);
      else if (f[0] === "rect") el("rect", { x: f[1], y: f[2], width: f[3], height: f[4], ...style }, g);
      else if (f[0] === "ligne") el("line", { x1: f[1], y1: f[2], x2: f[3], y2: f[4], stroke: COULEURS[f[5]], "stroke-width": 1.6 }, g);
    }
  }
  function dessiner() {
    const [L, H] = taille();
    svg.setAttribute("viewBox", `0 0 ${L} ${H}`);
    svg.style.aspectRatio = `${L} / ${H}`;
    svg.replaceChildren();
    el("rect", { x: 0, y: 0, width: L, height: H, fill: "#fff" }, svg);
    const grille = el("g", { class: "plan-grille" }, svg);
    for (let x = 50; x < L; x += 50) el("line", { x1: x, y1: 0, x2: x, y2: H }, grille);
    for (let y = 50; y < H; y += 50) el("line", { x1: 0, y1: y, x2: L, y2: y }, grille);
    const liste = elements();
    const routes = liste.map((e, i) => [e, i]).filter(([e]) => e.type === "route");
    // Bords noirs de toutes les routes, puis chaussées blanches par-dessus : les croisements se fondent.
    for (const [couleur, retrait] of [[COULEURS.noir, 0], [COULEURS.fond, 2 * TRAIT]]) {
      for (const [e] of routes) {
        el("path", { d: chemin(e.points, e.lisse), fill: "none", stroke: couleur, "stroke-width": (e.largeur || 36) - retrait,
                     "stroke-linejoin": "round", "stroke-linecap": "butt" }, svg);
      }
    }
    liste.forEach((e, i) => {
      const g = el("g", { "data-i": i, class: "plan-element" + (i === choix ? " choisi" : "") }, svg);
      if (e.type === "route") {
        el("path", { d: chemin(e.points, e.lisse), fill: "none", stroke: "transparent", "stroke-width": (e.largeur || 36) + 8 }, g);
      } else if (e.type === "carrefour") {
        if (e.style === "point") el("circle", { cx: e.x, cy: e.y, r: (e.r || 24) * 0.5, fill: COULEURS.bleu }, g);
        else el("circle", { cx: e.x, cy: e.y, r: e.r || 24, fill: "#fff", stroke: COULEURS.noir, "stroke-width": TRAIT }, g);
        etiquette(g, e.x, e.y, e.nom, { position: e.position || "droite", ecart: (e.style === "point" ? 0.5 : 1) * (e.r || 24) + 6, gras: true });
      } else if (e.type === "batiment" || e.type === "ici") {
        const k = e.taille || 1;
        el("rect", { x: e.x - 30 * k, y: e.y - 30 * k, width: 60 * k, height: 60 * k, fill: "transparent" }, g);
        icone(g, e.type === "ici" ? "ici" : e.icone || "maison", e.x, e.y, k);
        etiquette(g, e.x, e.y, e.nom, { taille: e.type === "ici" ? 14 : 12, position: e.position || "dessous", ecart: 31 * k,
                                        couleur: e.type === "ici" ? "rouge" : "noir", gras: e.type === "ici" });
      } else if (e.type === "fleche") {
        const [[x1, y1], [x2, y2]] = e.points;
        const c = COULEURS[e.couleur] || COULEURS.noir;
        const [epais, tete, demi] = e.epaisse ? [9, 22, 13] : [1.6, 11, 4];
        const lg = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / lg, uy = (y2 - y1) / lg;
        const bx = x2 - ux * tete, by = y2 - uy * tete;
        el("line", { x1, y1, x2: bx, y2: by, stroke: c, "stroke-width": epais }, g);
        el("polygon", { points: `${x2},${y2} ${bx - uy * demi},${by + ux * demi} ${bx + uy * demi},${by - ux * demi}`, fill: c }, g);
        el("line", { x1, y1, x2, y2, stroke: "transparent", "stroke-width": 16 }, g);
      } else if (e.type === "interdit") {
        for (const [a, b] of [[[-9, -9], [9, 9]], [[-9, 9], [9, -9]]]) {
          el("line", { x1: e.x + a[0], y1: e.y + a[1], x2: e.x + b[0], y2: e.y + b[1], stroke: COULEURS.rouge,
                       "stroke-width": 4.5, "stroke-linecap": "round" }, g);
        }
        el("circle", { cx: e.x, cy: e.y, r: 14, fill: "transparent" }, g);
      } else if (e.type === "texte") {
        etiquette(g, e.x, e.y, e.nom || "", { taille: e.taille || 14, position: "centre", couleur: e.couleur || "noir",
                                             gras: !!e.gras, angle: e.angle || 0 });
      }
    });
    // Poignées de la route ou de la flèche choisie : on peut déplacer chaque point.
    const e = liste[choix];
    if (e && (e.type === "route" || e.type === "fleche")) {
      e.points.forEach((p, k) => el("circle", { cx: p[0], cy: p[1], r: 7, class: "plan-poignee", "data-point": k }, svg));
    }
    if (enCours) {
      el("path", { d: chemin(enCours.points, enCours.lisse), fill: "none", stroke: COULEURS.bleu, "stroke-width": 3,
                   "stroke-dasharray": "8 6" }, svg);
      for (const p of enCours.points) el("circle", { cx: p[0], cy: p[1], r: 5, fill: COULEURS.bleu }, svg);
    }
  }

  // ---------- Coordonnées, aimantation ----------
  function position(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  /** Aimantée sur les points des routes existantes (pour les relier), sinon sur la grille. */
  function aimanter([x, y], sauf) {
    const [L, H] = taille();
    x = Math.min(L, Math.max(0, x)); y = Math.min(H, Math.max(0, y));
    let meilleur = null, distance = 16;
    elements().forEach((e, i) => {
      if (e.type !== "route" || e === sauf) return;
      for (const p of e.points) {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < distance) { distance = d; meilleur = p; }
      }
    });
    return meilleur ? [...meilleur] : [Math.round(x / GRILLE) * GRILLE, Math.round(y / GRILLE) * GRILLE];
  }

  // ---------- Outils ----------
  const AIDES = {
    selection: "Clique sur un élément pour le modifier ; fais-le glisser pour le déplacer. Suppr pour l'effacer.",
    route: "Clique point par point pour tracer la route (les points s'accrochent aux autres routes), puis « Terminer la route » ou double-clic.",
    courbe: "Comme une route, mais la ligne passe en douceur par chaque point : pour les virages et les descentes.",
    carrefour: "Clique sur un croisement pour y placer un carrefour, puis donne-lui son nom.",
    batiment: "Choisis le type de repère dans la liste, puis clique à côté d'une route.",
    ici: "Clique à l'endroit de ta maison.",
    fleche: "Fais glisser dans le sens de la circulation.",
    interdit: "Clique sur une route à ne pas prendre.",
    texte: "Clique pour écrire un nom de rue ou « Venant de… ». Tu peux ensuite l'incliner.",
  };
  function choisirOutil(nom) {
    terminerRoute();
    outil = nom;
    for (const b of $$(".plan-outils [data-outil]")) b.setAttribute("aria-pressed", String(b.dataset.outil === nom));
    $("#plan-icone").hidden = nom !== "batiment";
    $("#plan-aide").textContent = t(AIDES[nom]);
    svg.dataset.outil = nom;
  }
  for (const b of $$(".plan-outils [data-outil]")) b.addEventListener("click", () => choisirOutil(b.dataset.outil));

  function ajouter(e) {
    memoriser();
    elements().push(e);
    choix = elements().length - 1;
    changer();
    const champ = $("#plan-props [data-champ=nom]");
    if (champ && !champ.value) champ.focus();
  }
  function terminerRoute() {
    if (!enCours) return;
    const route = enCours;
    enCours = null;
    $("#plan-terminer").hidden = true;
    if (route.points.length >= 2) ajouter(route);
    else dessiner();
  }

  svg.addEventListener("pointerdown", evt => {
    if (evt.button > 0) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const brut = position(evt);
    const p = aimanter(brut);
    const poignee = evt.target.closest(".plan-poignee");
    const cible = evt.target.closest(".plan-element");
    if (outil === "route" || outil === "courbe") {
      if (!enCours) enCours = { type: "route", points: [], largeur: 36, lisse: outil === "courbe" };
      const dernier = enCours.points[enCours.points.length - 1];
      if (dernier && Math.hypot(dernier[0] - p[0], dernier[1] - p[1]) < 4) { terminerRoute(); return; }   // clic sur le dernier point
      enCours.points.push(p);
      $("#plan-terminer").hidden = false;
      dessiner();
      return;
    }
    if (outil === "fleche") {
      glisse = { mode: "fleche", depart: p };
      svg.setPointerCapture(evt.pointerId);
      return;
    }
    if (outil === "selection") {
      if (poignee) {
        memoriser();
        glisse = { mode: "point", k: +poignee.dataset.point };
      } else if (cible) {
        choix = +cible.dataset.i;
        memoriser();
        glisse = { mode: "deplacer", depart: brut, bouge: false, avant: JSON.stringify(elements()[choix]) };
        changer(false);
      } else {
        choix = -1; changer(false);
        return;
      }
      svg.setPointerCapture(evt.pointerId);
      return;
    }
    const nouveaux = {
      carrefour: { type: "carrefour", x: p[0], y: p[1], r: 24, nom: "", style: "rond", position: "droite" },
      batiment: { type: "batiment", x: p[0], y: p[1], icone: $("#plan-icone").value, nom: "", taille: 1, position: "dessous" },
      ici: { type: "ici", x: p[0], y: p[1], nom: "ICI", taille: 1.2, position: "dessous" },
      interdit: { type: "interdit", x: p[0], y: p[1] },
      texte: { type: "texte", x: p[0], y: p[1], nom: t("Venant de …"), taille: 14, angle: 0, gras: false, couleur: "noir" },
    };
    if (nouveaux[outil]) ajouter(nouveaux[outil]);
  });
  svg.addEventListener("pointermove", evt => {
    const brut = position(evt);
    if (enCours) {
      dessiner();
      const der = enCours.points[enCours.points.length - 1];
      const p = aimanter(brut);
      el("line", { x1: der[0], y1: der[1], x2: p[0], y2: p[1], stroke: COULEURS.bleu, "stroke-width": 2, "stroke-dasharray": "4 4" }, svg);
      return;
    }
    if (!glisse) return;
    const e = elements()[choix];
    if (glisse.mode === "fleche") {
      dessiner();
      const p = aimanter(brut);
      el("line", { x1: glisse.depart[0], y1: glisse.depart[1], x2: p[0], y2: p[1], stroke: COULEURS.bleu, "stroke-width": 2 }, svg);
    } else if (glisse.mode === "point" && e) {
      e.points[glisse.k] = aimanter(brut, e);
      dessiner();
    } else if (glisse.mode === "deplacer" && e) {
      const avant = JSON.parse(glisse.avant);
      let dx = Math.round((brut[0] - glisse.depart[0]) / GRILLE) * GRILLE, dy = Math.round((brut[1] - glisse.depart[1]) / GRILLE) * GRILLE;
      if (!dx && !dy && !glisse.bouge) return;
      glisse.bouge = true;
      if (avant.points) e.points = avant.points.map(([x, y]) => [x + dx, y + dy]);
      else { e.x = avant.x + dx; e.y = avant.y + dy; }
      dessiner();
    }
  });
  svg.addEventListener("pointerup", evt => {
    if (!glisse) return;
    const g = glisse;
    glisse = null;
    if (g.mode === "fleche") {
      let fin = aimanter(position(evt));
      if (Math.hypot(fin[0] - g.depart[0], fin[1] - g.depart[1]) < 15) fin = [g.depart[0] + 80, g.depart[1]];
      ajouter({ type: "fleche", points: [g.depart, fin], couleur: "noir", epaisse: false });
      return;
    }
    if (g.mode === "deplacer" && !g.bouge) historique.pop();    // simple clic : rien n'a changé
    changer(g.mode !== "deplacer" || g.bouge);
  });
  svg.addEventListener("dblclick", () => terminerRoute());
  $("#plan-terminer").addEventListener("click", terminerRoute);
  $("#plan-annuler").addEventListener("click", annuler);
  $("#plan-supprimer").addEventListener("click", supprimer);
  $("#plan-vider").addEventListener("click", () => {
    if (!elements().length || !confirm(t("Effacer tout le dessin ?"))) return;
    memoriser(); etat.plan.elements = []; choix = -1; changer();
  });
  function supprimer() {
    if (choix < 0) return;
    memoriser(); elements().splice(choix, 1); choix = -1; changer();
  }
  document.addEventListener("keydown", evt => {
    if (etat.type !== "plan" || evt.target.closest("input, textarea, select")) return;
    if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "z") { evt.preventDefault(); annuler(); }
    else if (evt.key === "Delete" || evt.key === "Backspace") { if (choix >= 0) { evt.preventDefault(); supprimer(); } }
    else if (evt.key === "Enter") terminerRoute();
    else if (evt.key === "Escape") { enCours = null; $("#plan-terminer").hidden = true; dessiner(); }
  });

  // ---------- Panneau « Élément sélectionné » ----------
  const POSITIONS = [["dessous", "En dessous"], ["dessus", "Au-dessus"], ["droite", "À droite"], ["gauche", "À gauche"]];
  const NOMS_COULEURS = [["noir", "Noir"], ["rouge", "Rouge"], ["bleu", "Bleu"], ["vert", "Vert"], ["orange", "Orange"]];
  function proprietes() {
    const zone = $("#plan-props");
    const e = elements()[choix];
    $("#plan-supprimer").disabled = !e;
    if (!e) {
      zone.innerHTML = "";
      const p = document.createElement("p"); p.className = "conseil";
      p.textContent = t("Choisis un outil au-dessus du dessin, puis clique dans le dessin. Avec l'outil « Sélection », clique sur un élément pour le modifier ou le déplacer.");
      zone.append(p);
      return;
    }
    zone.replaceChildren();
    const titre = document.createElement("p"); titre.className = "plan-props-titre";
    titre.textContent = t({ route: "Route", carrefour: "Carrefour", batiment: "Repère", ici: "Ta maison (ICI)", fleche: "Flèche",
                            interdit: "Chemin interdit", texte: "Texte" }[e.type]);
    zone.append(titre);
    const grille = document.createElement("div"); grille.className = "grille"; zone.append(grille);
    const champ = (libelle, cle, genre, options) => {
      const label = document.createElement("label");
      label.textContent = t(libelle);
      let saisie;
      if (genre === "choix") {
        saisie = document.createElement("select");
        saisie.replaceChildren(...options.map(([v, x]) => new Option(t(x), v)));
        saisie.value = String(e[cle] ?? options[0][0]);
      } else if (genre === "case") {
        label.className = "case"; label.textContent = "";
        saisie = document.createElement("input"); saisie.type = "checkbox"; saisie.checked = !!e[cle];
      } else if (genre === "curseur") {
        saisie = document.createElement("input"); saisie.type = "range";
        [saisie.min, saisie.max, saisie.step] = options; saisie.value = e[cle];
      } else {
        saisie = document.createElement("input"); saisie.maxLength = 80; saisie.value = e[cle] ?? "";
        saisie.dataset.champ = cle;
        label.className = "large";
      }
      let premier = true;
      const appliquer = () => {
        if (premier) { memoriser(); premier = false; }
        e[cle] = genre === "case" ? saisie.checked : genre === "curseur" ? +saisie.value : saisie.value;
        dessiner(); modifie(genre === "texte" ? 1200 : 0);
      };
      saisie.addEventListener(genre === "texte" || genre === "curseur" ? "input" : "change", appliquer);
      if (genre === "case") label.append(saisie, " " + t(libelle)); else label.append(saisie);
      grille.append(label);
    };
    if (e.type === "route") {
      champ("Largeur", "largeur", "curseur", [16, 70, 2]);
      champ("Tracé en courbe", "lisse", "case");
    } else if (e.type === "carrefour") {
      champ("Nom", "nom", "texte");
      champ("Forme", "style", "choix", [["rond", "Rond-point (cercle)"], ["point", "Point bleu"]]);
      champ("Taille", "r", "curseur", [10, 60, 2]);
      champ("Place du nom", "position", "choix", POSITIONS);
    } else if (e.type === "batiment" || e.type === "ici") {
      champ("Nom", "nom", "texte");
      if (e.type === "batiment") champ("Type", "icone", "choix", [...$("#plan-icone").options].map(o => [o.value, o.textContent]));
      champ("Taille", "taille", "curseur", [0.6, 2.5, 0.1]);
      champ("Place du nom", "position", "choix", POSITIONS);
    } else if (e.type === "fleche") {
      champ("Couleur", "couleur", "choix", NOMS_COULEURS);
      champ("Grosse flèche", "epaisse", "case");
    } else if (e.type === "texte") {
      champ("Texte", "nom", "texte");
      champ("Taille", "taille", "curseur", [9, 36, 1]);
      champ("Inclinaison", "angle", "curseur", [-90, 90, 5]);
      champ("Couleur", "couleur", "choix", NOMS_COULEURS);
      champ("Gras", "gras", "case");
    }
  }

  // ---------- Position GPS ----------
  function afficherGps() {
    const g = plan().gps;
    $("#plan-lat").value = g ? g.lat : "";
    $("#plan-lon").value = g ? g.lon : "";
    $("#plan-gps-etat").textContent = g
      ? t("Position enregistrée : le PDF portera un code QR qui ouvre la carte sur un téléphone.")
      : t("Avec une position GPS, le PDF porte un code QR : en le scannant, on ouvre la carte sur son téléphone.");
  }
  function definirGps(lat, lon) {
    lat = Number(String(lat).replace(",", ".")); lon = Number(String(lon).replace(",", "."));
    etat.plan.gps = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      && (lat || lon) ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 } : null;
    afficherGps(); modifie(0);
  }
  for (const id of ["#plan-lat", "#plan-lon"]) {
    $(id).addEventListener("change", () => {
      if (!$("#plan-lat").value.trim() && !$("#plan-lon").value.trim()) { etat.plan.gps = null; afficherGps(); modifie(0); return; }
      definirGps($("#plan-lat").value, $("#plan-lon").value);
    });
  }
  $("#plan-lien").addEventListener("change", e => {
    // « …/@3.8667,11.5167,17z », « …?q=3.8667,11.5167 », ou simplement « 3.8667, 11.5167 »
    const m = e.target.value.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (m) { definirGps(m[1], m[2]); e.target.value = ""; }
    else $("#plan-gps-etat").textContent = t("Ce lien ne contient pas de coordonnées. Ouvre l'endroit dans Google Maps, appuie longuement dessus, et copie les chiffres affichés (ex. 3.8667, 11.5167).");
  });
  $("#plan-position").addEventListener("click", () => {
    if (!navigator.geolocation) { $("#plan-gps-etat").textContent = t("Ton navigateur ne donne pas la position."); return; }
    $("#plan-gps-etat").textContent = t("Recherche de ta position…");
    navigator.geolocation.getCurrentPosition(
      p => definirGps(p.coords.latitude, p.coords.longitude),
      () => { $("#plan-gps-etat").textContent = t("Position indisponible : autorise la localisation pour ce site, ou recopie les coordonnées depuis Google Maps."); },
      { enableHighAccuracy: true, timeout: 15000 });
  });

  // ---------- Assistant itinéraire ----------
  let etapes = [{ direction: "droit", longueur: "moyen", arrivee: "", genre: "rond", repere: "", icone: "maison", cote: "droite" }];
  function dessinerEtapes() {
    const zone = $("#iti-etapes");
    zone.replaceChildren(...etapes.map((s, i) => {
      const carte = document.createElement("div"); carte.className = "element";
      const tete = document.createElement("div"); tete.className = "element-tete";
      const nom = document.createElement("span"); nom.textContent = `${t("Étape")} ${i + 1}`;
      const retirer = document.createElement("button"); retirer.type = "button"; retirer.className = "mini"; retirer.textContent = t("Supprimer");
      retirer.disabled = etapes.length === 1;
      retirer.addEventListener("click", () => { etapes.splice(i, 1); dessinerEtapes(); });
      tete.append(nom, retirer);
      const grille = document.createElement("div"); grille.className = "grille";
      const champ = (libelle, cle, options, attributs = {}) => {
        const label = document.createElement("label"); label.textContent = t(libelle);
        const saisie = options ? document.createElement("select") : document.createElement("input");
        if (options) saisie.replaceChildren(...options.map(([v, x]) => new Option(t(x), v)));
        Object.assign(saisie, attributs);
        saisie.value = s[cle];
        saisie.addEventListener("input", () => { s[cle] = saisie.value; });
        label.append(saisie); grille.append(label);
      };
      champ("Direction", "direction", [["droit", "Tout droit"], ["gauche", "Tourner à gauche"], ["droite", "Tourner à droite"]]);
      champ("Distance", "longueur", [["court", "Courte (moins de 100 m)"], ["moyen", "Moyenne (100 à 500 m)"], ["long", "Longue (plus de 500 m)"]]);
      champ("Jusqu'à", "arrivee", null, { maxLength: 80, placeholder: t("Carrefour CRADAT (facultatif)") });
      champ("C'est", "genre", [["rond", "un rond-point / carrefour"], ["point", "un carrefour simple"], ["aucun", "rien de particulier"]]);
      champ("Repère en chemin", "repere", null, { maxLength: 80, placeholder: t("Église Don Bosco (facultatif)") });
      champ("Type de repère", "icone", [...$("#plan-icone").options].map(o => [o.value, o.textContent]));
      champ("Côté du repère", "cote", [["droite", "À droite"], ["gauche", "À gauche"]]);
      carte.append(tete, grille);
      return carte;
    }));
  }
  $("#iti-ajouter").addEventListener("click", () => {
    etapes.push({ direction: "droit", longueur: "moyen", arrivee: "", genre: "rond", repere: "", icone: "maison", cote: "droite" });
    dessinerEtapes();
  });
  $("#iti-dessiner").addEventListener("click", () => {
    if (elements().length && !confirm(t("Remplacer le dessin actuel par le plan de l'itinéraire ?"))) return;
    memoriser();
    etat.plan.elements = itineraire();
    if (!etat.plan.contact.trim() && (etat.cv.nom.trim() || etat.cv.telephone.trim())) {
      etat.plan.contact = [etat.cv.nom.trim(), etat.cv.telephone.trim()].filter(Boolean).join(" – ");
      remplirChamps();
    }
    choix = -1; choisirOutil("selection"); changer();
  });
  /** Trajet décrit -> éléments : une route qui avance et tourne, des carrefours (avec un bout de
   *  rue de chaque côté), les repères au bord, des flèches dans le sens de la marche, et ICI. */
  function itineraire() {
    const LONGUEURS = { court: 130, moyen: 210, long: 300 };
    const out = [];
    let pos = [0, 0], cap = [0, -1];                     // on part vers le haut
    const gaucheDe = c => [c[1], -c[0]];                  // y vers le bas : la gauche de (0,-1) est (-1,0)
    const droiteDe = c => [-c[1], c[0]];
    const plus = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
    const trace = [plus(pos, cap, -70)];                 // un bout de route avant le départ
    const carrefour = (p, nom, style) => {
      out.push({ type: "carrefour", x: p[0], y: p[1], r: 24, nom, style, position: "droite" });
    };
    const rueTransversale = (p, c) => out.push({ type: "route", points: [plus(p, gaucheDe(c), 90), plus(p, droiteDe(c), 90)], largeur: 32 });
    const depart = $("#iti-depart").value.trim();
    const genreDepart = $("#iti-depart-genre").value;
    if (genreDepart === "repere") out.push({ type: "batiment", icone: "magasin", x: -75, y: 0, nom: depart, taille: 1, position: "gauche" });
    else { rueTransversale(pos, cap); carrefour(pos, depart, genreDepart); }
    trace.push(pos);
    for (const s of etapes) {
      if (s.direction === "gauche") cap = gaucheDe(cap);
      else if (s.direction === "droite") cap = droiteDe(cap);
      const lg = LONGUEURS[s.longueur] || 210;
      const arrivee = plus(pos, cap, lg);
      // Flèche dans le sens de la marche, sur le bord droit de la chaussée.
      out.push({ type: "fleche", points: [plus(plus(pos, cap, lg * 0.3), droiteDe(cap), 9), plus(plus(pos, cap, lg * 0.6), droiteDe(cap), 9)], couleur: "noir", epaisse: false });
      if (s.repere.trim()) {
        const cote = s.cote === "gauche" ? gaucheDe(cap) : droiteDe(cap);
        const p = plus(plus(pos, cap, lg * 0.5), cote, 62);
        out.push({ type: "batiment", icone: s.icone, x: p[0], y: p[1], nom: s.repere.trim(), taille: 1, position: "dessous" });
      }
      pos = arrivee;
      trace.push(pos);
      if (s.genre !== "aucun") { rueTransversale(pos, cap); carrefour(pos, s.arrivee.trim(), s.genre); }
      else if (s.arrivee.trim()) out.push({ type: "texte", x: pos[0] + 60, y: pos[1], nom: s.arrivee.trim(), taille: 13, angle: 0, gras: true, couleur: "noir" });
    }
    const coteIci = $("#iti-ici-cote").value;
    let ici;
    if (coteIci === "face") { trace.push(plus(pos, cap, 40)); ici = plus(pos, cap, 100); }
    else { trace.push(plus(pos, cap, 70)); ici = plus(plus(pos, cap, 40), coteIci === "gauche" ? gaucheDe(cap) : droiteDe(cap), 72); }
    out.unshift({ type: "route", points: trace, largeur: 38 });
    out.push({ type: "ici", x: ici[0], y: ici[1], nom: $("#iti-ici-nom").value.trim() || "ICI", taille: 1.2, position: "dessous" });
    return cadrer(out);
  }
  /** Met le dessin à l'échelle de la feuille (format choisi d'après sa forme), centré. */
  function cadrer(liste) {
    const pts = liste.flatMap(e => e.points || [[e.x, e.y]]);
    let [x0, y0, x1, y1] = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])),
                            Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    x0 -= 90; x1 += 150; y0 -= 70; y1 += 70;             // place pour les noms
    etat.plan.orientation = (x1 - x0) >= (y1 - y0) * 1.1 ? "paysage" : "portrait";
    remplirChamps();
    const [L, H] = taille();
    const k = Math.min(1.5, L / (x1 - x0), H / (y1 - y0));
    const dx = (L - (x1 - x0) * k) / 2 - x0 * k, dy = (H - (y1 - y0) * k) / 2 - y0 * k;
    const q = ([x, y]) => [Math.round(x * k + dx), Math.round(y * k + dy)];
    for (const e of liste) {
      if (e.points) e.points = e.points.map(q);
      else [e.x, e.y] = q([e.x, e.y]);
    }
    return liste;
  }

  // ---------- Affichage selon l'onglet ----------
  function basculerPdf(voir) {
    window.planVoirPdf = voir;
    $("#plan-voir-pdf").textContent = t(voir ? "Revenir au dessin" : "Voir le PDF");
    planAfficher();
    if (voir) actualiser();
  }
  $("#plan-voir-pdf").addEventListener("click", () => basculerPdf(!window.planVoirPdf));
  // Bouton « Revenir au dessin », visible au-dessus de l'aperçu PDF.
  const retour = document.createElement("button");
  retour.type = "button"; retour.className = "bouton"; retour.id = "plan-retour"; retour.hidden = true;
  retour.textContent = t("Revenir au dessin");
  retour.addEventListener("click", () => basculerPdf(false));
  $(".apercu-boutons").prepend(retour);

  window.planAfficher = function planAfficher() {
    const actif = etat.type === "plan";
    const dessin = actif && !window.planVoirPdf;
    $("#plan-zone").hidden = !dessin;
    $("#apercu").classList.toggle("mode-plan", dessin);
    $("#pages").hidden = dessin;
    $("#plan-retour").hidden = !(actif && window.planVoirPdf);
    if (dessin) $("#vide").hidden = true;
    if (!actif) { window.planVoirPdf = false; return; }
    if (!$("#plan-assistant").dataset.vu) {
      $("#plan-assistant").dataset.vu = "1";
      $("#plan-assistant").open = !elements().length;      // plan vide : on propose l'assistant
    }
    if (choix >= elements().length) choix = -1;
    dessiner(); proprietes(); afficherGps();
  };
  $("#formulaire").addEventListener("input", e => {
    if (e.target.dataset.k === "plan.orientation") { choix = -1; dessiner(); }
  });
  dessinerEtapes();
  choisirOutil("selection");
  planAfficher();       // app.js a déjà affiché l'onglet avant que ce script soit chargé
})();
