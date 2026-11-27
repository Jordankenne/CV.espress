"""
Page Contact : le message du visiteur est envoyé par e-mail à l'équipe du site (Brevo, comme
les e-mails du compte). L'adresse de l'équipe n'apparaît jamais sur le site.

Destinataire : réglage CONTACT_EMAIL, sinon le premier administrateur (ADMINS), sinon
l'adresse d'expédition (EMAIL_EXPEDITEUR). « Répondre » dans la messagerie répond au visiteur.
Protections : même site seulement, 5 messages par quart d'heure et par adresse IP, champ piège
invisible pour les robots, longueurs bornées. Le message n'est pas enregistré sur le serveur.
"""
import threading
from email.utils import parseaddr

from flask import Blueprint, current_app, jsonify, request

import comptes as c
import statistiques

contact = Blueprint("contact", __name__, url_prefix="/api/contact")
SUJETS = {"probleme": "Un problème sur le site", "idee": "Une idée ou une suggestion",
          "compte": "Mon compte ou mes données", "autre": "Autre chose"}
c.LIMITES.setdefault("contact_ip", 5)


def destinataire():
    admins = sorted(a.strip().lower() for a in c._reglage("ADMINS").split(",") if a.strip())
    return c._reglage("CONTACT_EMAIL") or (admins[0] if admins else "") or parseaddr(c.EMAIL_EXPEDITEUR)[1]


@contact.post("")
def envoyer():
    refus = c._meme_site()                     # même contrôle que pour les comptes (CSRF, JSON)
    if refus:
        return refus
    corps = c._corps()
    texte = lambda cle, maxi: " ".join(c._sans_nul(corps[cle]).split())[:maxi] if isinstance(corps.get(cle), str) else ""
    # Champ invisible : seul un robot le remplit. On fait comme si tout allait bien.
    if texte("site_web", 200):
        return jsonify(envoye=True)
    cle = ("contact_ip", request.remote_addr)
    if c._bloque(cle):
        return jsonify(erreur="Trop de messages envoyés. Réessaie dans un quart d'heure."), 429
    nom, email = texte("nom", 120), texte("email", 120).lower()
    message = c._sans_nul(corps["message"]).strip()[:5000] if isinstance(corps.get("message"), str) else ""
    sujet = corps.get("sujet") if corps.get("sujet") in SUJETS else "autre"
    if email and not c._EMAIL_OK.match(email):
        return jsonify(erreur="Adresse e-mail invalide."), 400
    if len(message) < 10:
        return jsonify(erreur="Écris ton message (quelques mots au moins)."), 400
    c._noter(cle)
    statistiques.compter("contact")
    a_qui = destinataire()
    langue = corps.get("langue") if corps.get("langue") in ("fr", "en", "it") else "fr"
    contenu = (f"Message reçu depuis la page Contact de MonCVexpress.com\n\n"
               f"Sujet : {SUJETS[sujet]}\nNom : {nom or '(non indiqué)'}\n"
               f"Adresse e-mail : {email or '(non indiquée : impossible de répondre)'}\nLangue du site : {langue}\n"
               f"\n{message}\n")
    if not a_qui:
        current_app.logger.warning("Message de contact reçu mais aucune adresse où l'envoyer (CONTACT_EMAIL).")
        return jsonify(envoye=True)
    threading.Thread(target=c.envoyer_email, daemon=True, args=(
        a_qui, f"[MonCVexpress.com] {SUJETS[sujet]}" + (f" – {nom}" if nom else ""), contenu, "contact",
        current_app.logger, email or None)).start()
    return jsonify(envoye=True)
