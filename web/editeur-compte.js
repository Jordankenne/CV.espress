"use strict";
// Éditeur (page /creer), partie 5/5 : Compte (facultatif) : connexion, synchronisation du CV, plusieurs onglets.
// Les cinq fichiers editeur-*.js se chargent dans l'ordre (voir creer.html) et partagent leurs
// variables : ce qui est déclaré dans un fichier sert dans les suivants.

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
  $("#compte-titre").textContent = modeInscription ? "Créer mon compte gratuit" : "Se connecter";
  $("#compte-valider").textContent = modeInscription ? "Créer mon compte" : "Se connecter";
  $("#compte-question").textContent = modeInscription ? "Déjà un compte ?" : "Pas encore de compte ?";
  $("#compte-bascule").textContent = modeInscription ? "Se connecter" : "Créer un compte";
  $("#compte-intro").textContent = actionApresConnexion
    ? (modeInscription ? "Crée ton compte gratuit pour télécharger ton document. Ce que tu as rempli y sera enregistré : tu le retrouveras sur tous tes appareils."
                       : "Connecte-toi pour télécharger ton document. Ce que tu as rempli sera enregistré dans ton compte.")
    : "Retrouve tes documents depuis n'importe quel appareil.";
  // Inscription en une étape : prénom, nom, e-mail, mot de passe et confirmation.
  $("#compte-noms").hidden = !modeInscription;
  $("#compte-confirmation-ligne").hidden = !modeInscription;
  $("#compte-mdp-aide").hidden = !modeInscription;
  $("#compte-mdp").autocomplete = modeInscription ? "new-password" : "current-password";
  $("#compte-info-inscription").hidden = !modeInscription;
  $("#compte-oubli-ligne").hidden = modeInscription;
  $("#compte-robot-ligne").hidden = !modeInscription;
  if (modeInscription && !compte.connecte) window.AntiRobot?.preparer($("#compte-robot"));
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
    if (copie) alert((window.tr || (t => t))("Ce CV avait été modifié sur un autre appareil entre-temps. Pour ne rien perdre, "
      + "tes modifications ont été enregistrées dans un nouveau document (« Version modifiée sur cet appareil »). "
      + "Retrouve les deux versions dans « Mon espace »."));
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
  if (typeDemande === "admin" && GENRES_ADMIN.includes(parametres.get("genre"))) etat.admin.genre = parametres.get("genre");
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
    const t = window.tr || (x => x);
    prendreCompte = confirm(t("Ton compte contient un CV différent de celui de cet appareil.") + "\n\n"
      + t("OK : charger le CV de ton compte.") + "\n" + t("Annuler : garder celui de cet appareil (il sera ajouté à ton compte)."));
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

/** Ouvre la fenêtre du compte. action : ce qu'il faudra faire une fois connecté (télécharger…). */
function ouvrirCompte(action, inscription) {
  actionApresConnexion = action || null;
  if (inscription !== undefined) modeInscription = inscription;
  erreurCompte("#compte-erreur", ""); erreurCompte("#compte-erreur-suppr", "");
  afficherCompte();
  $("#dlg-compte").showModal();
  (modeInscription ? $("#compte-prenom") : $("#compte-email")).focus();
}
$("#btn-compte").addEventListener("click", () => ouvrirCompte(null));
$("#compte-fermer").addEventListener("click", () => $("#dlg-compte").close());
$("#dlg-compte").addEventListener("close", () => { if (!compte.connecte) actionApresConnexion = null; });
$("#compte-voir-mdp").addEventListener("change", e => {
  for (const sel of ["#compte-mdp", "#compte-confirmation"]) $(sel).type = e.target.checked ? "text" : "password";
});

/** Connecté (connexion ou inscription) : on enregistre le travail en cours, puis on reprend l'action demandée. */
async function apresConnexion(corps, nouveau) {
  compte = { connecte: true, email: corps.email };
  // Nouveau compte : ce qui est sur cet appareil y est enregistré. Connexion : un autre compte
  // a pu être utilisé ici, on refait le point avec le compte.
  if (!nouveau) ecrireSynchro({});
  afficherCompte("");
  await synchroniser();
  await verifierPartage();
  annoncerConnexion();
  const action = actionApresConnexion;
  actionApresConnexion = null;
  $("#dlg-compte").close();
  if (action) action();
}
$("#compte-bascule").addEventListener("click", () => {
  modeInscription = !modeInscription;
  erreurCompte("#compte-erreur", "");
  afficherCompte();
});

const CHAMPS_INSCRIPTION = { prenom: "#compte-prenom", nom: "#compte-nom", email: "#compte-email",
                             mot_de_passe: "#compte-mdp", confirmation: "#compte-confirmation" };
$("#compte-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#compte-email").value.trim(), mdp = $("#compte-mdp").value;
  const refuser = (message, champ) => { erreurCompte("#compte-erreur", message); if (champ) $(CHAMPS_INSCRIPTION[champ]).focus(); };
  if (modeInscription) {
    const prenom = $("#compte-prenom").value.trim(), nom = $("#compte-nom").value.trim(), confirmation = $("#compte-confirmation").value;
    if (!prenom || !nom) return refuser("Indique ton prénom et ton nom.", prenom ? "nom" : "prenom");
    if (!email) return refuser("Renseigne ton adresse e-mail.", "email");
    if (mdp.length < 8) return refuser("Le mot de passe doit contenir au moins 8 caractères.", "mot_de_passe");
    if (mdp !== confirmation) return refuser("Les deux mots de passe ne sont pas identiques.", "confirmation");
    $("#compte-valider").disabled = true;
    const r = await api("POST", "/inscription", { prenom, nom, email, mot_de_passe: mdp, confirmation, langue: LANGUE_SITE,
                                                  site_web: $("#compte-site").value,
                                                  turnstile: window.AntiRobot?.jeton($("#compte-robot")) || "" });
    $("#compte-valider").disabled = false;
    if (!r.ok) window.AntiRobot?.reinitialiser($("#compte-robot"));
    if (!r.ok) return refuser(r.corps.erreur || "Une erreur est survenue. Réessaie.", r.corps.champ);
    $("#compte-mdp").value = $("#compte-confirmation").value = "";
    erreurCompte("#compte-erreur", "");
    return apresConnexion(r.corps, true);
  }
  if (!email || !mdp) return refuser("Renseigne ton adresse e-mail et ton mot de passe.");
  $("#compte-valider").disabled = true;
  const r = await api("POST", "/connexion", { email, mot_de_passe: mdp });
  $("#compte-valider").disabled = false;
  $("#compte-mdp").value = "";
  if (!r.ok) return refuser(r.corps.erreur || "Une erreur est survenue. Réessaie.");
  erreurCompte("#compte-erreur", "");
  await apresConnexion(r.corps, false);
});

// ---------- Plusieurs onglets ----------
// Le lien d'inscription (ou de mot de passe oublié) s'ouvre souvent dans un autre onglet, qui
// crée le compte et se connecte. Il prévient cet onglet-ci, qui se connecte à son tour au lieu
// de rester sur « C'est presque fini ». On revérifie aussi quand on revient sur l'onglet.
const CLE_CONNEXION = "cv-saas-connexion";
const canalCompte = "BroadcastChannel" in window ? new BroadcastChannel("cv-express-compte") : null;
function annoncerConnexion() {
  canalCompte?.postMessage("connecte");
  try { localStorage.setItem(CLE_CONNEXION, String(Date.now())); } catch { /* stockage indisponible */ }
}
let verificationEnCours = false;
async function verifierConnexion() {
  if (compte.connecte || verificationEnCours) return;
  verificationEnCours = true;
  const r = await api("GET", "");
  if (r.ok && r.corps.connecte && !compte.connecte) {
    compte = { connecte: true, email: r.corps.email };
    // Pas de remise à zéro de la synchronisation : l'autre onglet vient peut-être d'enregistrer
    // dans le compte le CV de cet appareil (même navigateur, même compte).
    afficherCompte("");
    if ($("#dlg-compte").open) $("#dlg-compte").close();
    await synchroniser();
    await verifierPartage();
  }
  verificationEnCours = false;
}
canalCompte?.addEventListener("message", e => { if (e.data === "connecte") verifierConnexion(); });
window.addEventListener("storage", e => { if (e.key === CLE_CONNEXION) verifierConnexion(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verifierConnexion(); });

$("#compte-deconnexion").addEventListener("click", async () => {
  // On envoie d'abord les dernières modifications, pour ne rien perdre.
  if (lireSynchro().sale && !(await envoyer())
      && !confirm((window.tr || (x => x))("Tes dernières modifications n'ont pas pu être enregistrées dans ton compte. Se déconnecter quand même ?"))) return;
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
  alert((window.tr || (x => x))("Ton compte et le CV enregistré sur nos serveurs ont été supprimés."));
});

// Au chargement de la page : déjà connecté sur cet appareil ?
(async () => {
  const r = await api("GET", "");
  if (r.ok && typeof r.corps.compte_requis_pour_pdf === "boolean") compteRequisPourPdf = r.corps.compte_requis_pour_pdf;
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
