"""
Compteurs d'usage, pour le tableau de bord de l'administrateur : nombre de PDF par type de
document, langue des documents, pages vues, CV importés, CV en ligne consultés…

Rien de personnel : seulement « quoi » et « quel jour » (jamais qui, ni l'adresse IP), donc ni
cookie ni consentement. Les compteurs s'accumulent en mémoire et sont écrits dans la base au
plus toutes les 10 minutes (et à l'arrêt du serveur) : la base en ligne n'est pas réveillée à
chaque document fabriqué. Un redémarrage brutal peut donc perdre au plus quelques minutes.
"""
import atexit
import threading
import time
from threading import Thread   # référence gardée : les tests remplacent threading.Thread pour les e-mails
from collections import Counter

import comptes as c

INTERVALLE_S = 600
_en_attente = Counter()          # (jour, clé) -> nombre, pas encore écrit dans la base
_verrou = threading.Lock()
_fil = None


def _aujourdhui():
    return time.strftime("%Y-%m-%d", time.gmtime())


def compter(cle, nombre=1):
    """Ajoute nombre à la clé (« pdf:cv », « page:accueil »…) pour aujourd'hui. Ne lève jamais d'erreur."""
    global _fil
    if not isinstance(cle, str) or not cle or len(cle) > 60:
        return
    with _verrou:
        _en_attente[(_aujourdhui(), cle)] += nombre
        if _fil is None:
            _fil = Thread(target=_ecrire_regulierement, daemon=True, name="statistiques")
            _fil.start()


# Robots connus (moteurs de recherche, surveillance, aperçus de liens, outils) : reconnus à leur
# « User-Agent ». Leurs visites sont comptées à part (« robot:<nom> »), pas dans les pages vues.
_ROBOTS = [("Google", "googlebot"), ("Google", "google-inspectiontool"), ("Google", "googleother"),
           ("Google", "adsbot-google"), ("Google", "mediapartners-google"), ("Google", "storebot-google"),
           ("Bing", "bingbot"), ("Bing", "bingpreview"), ("Yandex", "yandex"), ("Baidu", "baiduspider"),
           ("DuckDuckGo", "duckduckbot"), ("Apple", "applebot"), ("UptimeRobot", "uptimerobot"),
           ("Facebook", "facebookexternalhit"), ("Facebook", "meta-externalagent"), ("WhatsApp", "whatsapp"),
           ("Telegram", "telegrambot"), ("LinkedIn", "linkedinbot"), ("Twitter/X", "twitterbot"),
           ("Ahrefs", "ahrefsbot"), ("Semrush", "semrushbot"), ("IA", "gptbot"), ("IA", "claudebot"),
           ("IA", "chatgpt-user"), ("IA", "perplexitybot"), ("IA", "ccbot"), ("IA", "bytespider"),
           ("Render", "render/health")]
_ROBOT_GENERIQUE = ("bot", "crawler", "spider", "crawl", "slurp", "python-requests", "curl/", "wget/",
                    "go-http-client", "headlesschrome", "monitor", "scrapy", "httpclient")


def robot(agent):
    """Nom du robot si le User-Agent en est un (« Google », « UptimeRobot », « Autre robot »), sinon None."""
    agent = (agent or "").lower()
    if not agent:
        return "Autre robot"                      # un navigateur envoie toujours un User-Agent
    for nom, motif in _ROBOTS:
        if motif in agent:
            return nom
    return "Autre robot" if any(m in agent for m in _ROBOT_GENERIQUE) else None


def compter_visite(page, langue, agent):
    """Une page vue : par une personne (page:… et langue_site:…) ou par un robot (robot:…)."""
    nom = robot(agent)
    if nom:
        compter(f"robot:{nom}")
    else:
        compter(f"page:{page}")
        compter(f"langue_site:{langue}")


def vider():
    """Écrit dans la base ce qui est en mémoire. Remet les compteurs en mémoire en cas d'échec."""
    with _verrou:
        lot = dict(_en_attente)
        _en_attente.clear()
    if not lot:
        return
    try:
        with c._base() as b:
            for (jour, cle), nombre in lot.items():
                b.execute("""INSERT INTO compteurs (jour, cle, nombre) VALUES (?, ?, ?)
                             ON CONFLICT (jour, cle) DO UPDATE SET nombre = compteurs.nombre + excluded.nombre""",
                          (jour, cle, nombre))
    except Exception:
        with _verrou:
            _en_attente.update(lot)          # on réessaiera au prochain passage
        raise


def _ecrire_regulierement():
    while True:
        time.sleep(INTERVALLE_S)
        try:
            vider()
        except Exception:                    # base momentanément injoignable : on réessaiera
            pass


@atexit.register
def _a_l_arret():
    try:
        vider()
    except Exception:
        pass


def lire(jours=30):
    """{jours: [AAAA-MM-JJ…], cles: {clé: [nombre par jour]}} pour les derniers jours (aujourd'hui compris)."""
    vider()
    liste = [time.strftime("%Y-%m-%d", time.gmtime(time.time() - n * 86400)) for n in range(jours - 1, -1, -1)]
    with c._base() as b:
        lignes = b.execute("SELECT jour, cle, nombre FROM compteurs WHERE jour >= ?", (liste[0],)).fetchall()
    indice = {j: i for i, j in enumerate(liste)}
    cles = {}
    for jour, cle, nombre in lignes:
        if jour in indice:
            cles.setdefault(cle, [0] * jours)[indice[jour]] += nombre
    return {"jours": liste, "cles": cles}
