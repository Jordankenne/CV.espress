"use strict";
/*
 * Tableau de bord de l'administrateur (/admin). Tout passe par /api/admin…, qui n'existe que
 * pour un compte listé dans le réglage ADMINS. Aucune donnée n'est écrite dans la page avec
 * innerHTML : les adresses e-mail viennent des visiteurs, elles sont toujours insérées comme texte.
 */
const $ = sel => document.querySelector(sel);
let page = 1, total = 0, parPage = 50, recherche = "", aSupprimer = null;

async function api(methode, chemin, corps) {
  try {
    const r = await fetch("/api/admin" + chemin, {
      method: methode, credentials: "same-origin",
      headers: corps ? { "Content-Type": "application/json" } : {},
      body: corps ? JSON.stringify(corps) : undefined,
    });
    return { ok: r.ok, statut: r.status, corps: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, statut: 0, corps: { erreur: "Connexion impossible. Vérifie ta connexion Internet." } };
  }
}
const entier = n => Number(n || 0).toLocaleString("fr-FR");
function taille(octets) {
  const mo = (octets || 0) / 1048576;
  return mo < 1 ? `${Math.max(1, Math.round((octets || 0) / 1024))} ko` : `${mo.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}
function date(secondes) {
  return secondes ? new Date(secondes * 1000).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function message(texte) { $("#admin-message").textContent = texte || ""; $("#admin-message").hidden = !texte; }
function element(nom, texte, classe) {
  const e = document.createElement(nom);
  if (texte !== undefined) e.textContent = texte;
  if (classe) e.className = classe;
  return e;
}

// ---------- Chiffres clés et histogramme ----------
async function chargerResume() {
  const r = await api("GET", "/resume");
  if (!r.ok) { message(r.corps.erreur || "Impossible de charger les chiffres."); return; }
  const d = r.corps;
  $("#t-comptes").textContent = entier(d.comptes);
  $("#t-inscrits").textContent = `${entier(d.inscrits_7j)} / ${entier(d.inscrits_30j)}`;
  $("#t-actifs").textContent = `${entier(d.actifs_7j)} / ${entier(d.actifs_30j)}`;
  $("#t-documents").textContent = entier(d.documents);
  $("#t-attente").textContent = entier(d.invitations_en_attente);
  $("#t-base").textContent = d.base;
  const pourcent = Math.min(100, 100 * d.taille_base / d.stockage_max);
  $("#t-stockage").textContent = taille(d.taille_base);
  $("#t-stockage-max").textContent = `${pourcent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de ${taille(d.stockage_max)}`;
  $("#t-jauge").value = pourcent;
  $("#t-jauge").textContent = `${Math.round(pourcent)} %`;
  dessinerHistogramme(d.inscriptions);
}

function jourLisible(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function dessinerHistogramme(jours) {
  const zone = $("#histogramme"), bulle = $("#infobulle");
  zone.replaceChildren();
  const max = Math.max(1, ...jours.map(j => j.nombre));
  const totalJours = jours.reduce((s, j) => s + j.nombre, 0);
  zone.setAttribute("aria-label", `Inscriptions par jour sur 30 jours : ${totalJours} au total, ${max} au maximum en un jour.`);
  for (const j of jours) {
    // Zone de survol sur toute la hauteur (plus grande que la barre), barre ancrée en bas.
    const colonne = element("div", undefined, "histo-colonne");
    const barre = element("div", undefined, "histo-barre");
    barre.style.height = j.nombre ? `${Math.max(4, 100 * j.nombre / max)}%` : "0";
    colonne.append(barre);
    const texte = `${jourLisible(j.jour)} : ${j.nombre} inscription${j.nombre > 1 ? "s" : ""}`;
    colonne.tabIndex = 0;
    colonne.setAttribute("aria-label", texte);
    const montrer = () => {
      bulle.textContent = texte; bulle.hidden = false;
      zone.querySelectorAll(".actif").forEach(e => e.classList.remove("actif"));
      colonne.classList.add("actif");
    };
    colonne.addEventListener("mouseenter", montrer);
    colonne.addEventListener("focus", montrer);
    zone.append(colonne);
  }
  zone.addEventListener("mouseleave", () => { bulle.hidden = true; zone.querySelectorAll(".actif").forEach(e => e.classList.remove("actif")); });
  $("#axe-debut").textContent = jourLisible(jours[0].jour);
  $("#axe-fin").textContent = "aujourd'hui";
}

// ---------- Liste des comptes ----------
async function chargerComptes() {
  const r = await api("GET", `/comptes?page=${page}&q=${encodeURIComponent(recherche)}`);
  if (!r.ok) { message(r.corps.erreur || "Impossible de charger les comptes."); return; }
  ({ total, par_page: parPage } = r.corps);
  const corps = $("#comptes");
  corps.replaceChildren();
  for (const c of r.corps.comptes) {
    const ligne = document.createElement("tr");
    const email = element("td", c.email, "email");
    if (c.admin) email.append(" ", element("span", "admin", "puce-modele"));
    ligne.append(email, element("td", date(c.cree_le)), element("td", date(c.vu_le)),
                 element("td", entier(c.documents), "nombre"), element("td", c.volume ? taille(c.volume) : "—", "nombre"));
    const action = element("td");
    if (!c.admin) {
      const bouton = element("button", "Supprimer", "bouton petit");
      bouton.type = "button";
      bouton.addEventListener("click", () => demanderSuppression(c));
      action.append(bouton);
    }
    ligne.append(action);
    corps.append(ligne);
  }
  $("#comptes-vide").hidden = total > 0;
  const pages = Math.max(1, Math.ceil(total / parPage));
  $("#page-info").textContent = `${entier(total)} compte${total > 1 ? "s" : ""} · page ${page} sur ${pages}`;
  $("#page-prec").disabled = page <= 1;
  $("#page-suiv").disabled = page >= pages;
}

let minuterie;
$("#recherche").addEventListener("input", e => {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => { recherche = e.target.value.trim(); page = 1; chargerComptes(); }, 300);
});
$("#page-prec").addEventListener("click", () => { page--; chargerComptes(); });
$("#page-suiv").addEventListener("click", () => { page++; chargerComptes(); });

// ---------- Suppression d'un compte ----------
function erreurSuppr(texte) { $("#suppr-erreur").textContent = texte || ""; $("#suppr-erreur").hidden = !texte; }
function demanderSuppression(compte) {
  aSupprimer = compte;
  $("#suppr-email").textContent = compte.email;
  $("#suppr-mdp").value = "";
  erreurSuppr("");
  $("#suppr-dialogue").showModal();
  $("#suppr-mdp").focus();
}
$("#suppr-annuler").addEventListener("click", () => $("#suppr-dialogue").close());
$("#suppr-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!$("#suppr-mdp").value) { erreurSuppr("Indique ton mot de passe."); return; }
  $("#suppr-valider").disabled = true;
  const r = await api("DELETE", `/comptes/${aSupprimer.id}`, { mot_de_passe: $("#suppr-mdp").value });
  $("#suppr-valider").disabled = false;
  if (!r.ok) { erreurSuppr(r.corps.erreur || "Suppression impossible."); return; }
  $("#suppr-dialogue").close();
  message(`Le compte ${aSupprimer.email} a été supprimé.`);
  chargerResume();
  chargerComptes();
});

chargerResume();
chargerComptes();
