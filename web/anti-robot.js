// Vérification anti-robot du formulaire d'inscription (Cloudflare Turnstile).
// Utilisée par l'éditeur (app.js) et par « Mon espace » (espace.js).
// Le serveur indique la clé publique dans GET /api/compte ; sans clé, rien ne s'affiche et
// l'inscription fonctionne comme avant (développement, tests).
(() => {
  const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  let cle = null;            // null : pas encore demandé ; "" : Turnstile désactivé
  let chargement = null;
  const widgets = new Map(); // conteneur -> identifiant du widget

  async function lireCle() {
    if (cle !== null) return cle;
    try {
      const r = await fetch("/api/compte", { credentials: "same-origin", headers: { Accept: "application/json" } });
      cle = (await r.json()).turnstile || "";
    } catch { cle = ""; }
    return cle;
  }

  function chargerScript() {
    chargement ??= new Promise((ok, echec) => {
      const s = document.createElement("script");
      s.src = SCRIPT; s.async = true;
      s.onload = () => ok(); s.onerror = () => { chargement = null; echec(new Error("turnstile")); };
      document.head.appendChild(s);
    });
    return chargement;
  }

  // Affiche la case dans le conteneur (une seule fois par conteneur).
  async function preparer(conteneur) {
    if (!conteneur || widgets.has(conteneur) || !(await lireCle())) return;
    widgets.set(conteneur, null);
    try { await chargerScript(); } catch { widgets.delete(conteneur); return; }
    const langue = (window.LANGUE_SITE || document.documentElement.lang || "fr").slice(0, 2);
    widgets.set(conteneur, window.turnstile.render(conteneur, { sitekey: cle, language: langue, size: "flexible" }));
  }

  // Jeton à envoyer avec l'inscription ("" si Turnstile est désactivé ou pas encore prêt).
  function jeton(conteneur) {
    const id = widgets.get(conteneur);
    return id != null && window.turnstile ? window.turnstile.getResponse(id) || "" : "";
  }

  // Un jeton ne sert qu'une fois : nouvelle case après chaque essai.
  function reinitialiser(conteneur) {
    const id = widgets.get(conteneur);
    if (id != null && window.turnstile) window.turnstile.reset(id);
  }

  window.AntiRobot = { preparer, jeton, reinitialiser };
})();
