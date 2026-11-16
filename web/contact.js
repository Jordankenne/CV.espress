"use strict";
// Page Contact : envoie le message à /api/contact (le serveur le transmet par e-mail).
const $ = sel => document.querySelector(sel);
function erreur(texte) { $("#contact-erreur").textContent = texte || ""; $("#contact-erreur").hidden = !texte; }

$("#contact-form").addEventListener("submit", async e => {
  e.preventDefault();
  const message = $("#contact-message").value.trim();
  if (message.length < 10) return erreur("Écris ton message (quelques mots au moins).");
  $("#contact-valider").disabled = true;
  erreur("");
  let r, corps = {};
  try {
    r = await fetch("/api/contact", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sujet: $("#contact-sujet").value, nom: $("#contact-nom").value, email: $("#contact-email").value,
                             message, site_web: $("#contact-site").value, langue: window.LANGUE_SITE || "fr" }),
    });
    corps = await r.json().catch(() => ({}));
  } catch {
    $("#contact-valider").disabled = false;
    return erreur("Connexion impossible. Vérifie ta connexion Internet et réessaie.");
  }
  $("#contact-valider").disabled = false;
  if (!r.ok) return erreur(corps.erreur || "Une erreur est survenue. Réessaie.");
  $("#contact-form").reset();
  $("#contact-envoye").hidden = false;
  $("#contact-valider").hidden = true;
});
