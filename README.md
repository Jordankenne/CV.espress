# MonCVexpress.com

Générateur de CV et de lettres de motivation en PDF (français, anglais, italien).

## Lancer en développement

```bash
.venv/bin/python app.py          # puis ouvrir http://localhost:5000
```

Sans serveur d'e-mails configuré, les liens d'inscription et de mot de passe oublié
sont écrits dans le terminal au lieu d'être envoyés.

## Tests

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
```

Sur GitHub, les tests tournent tout seuls à chaque envoi (`.github/workflows/tests.yml`),
une fois sur SQLite et une fois sur une base PostgreSQL jetable. Résultat : onglet « Actions ».

**Dans un vrai navigateur** (`tests/navigateur/verifier.mjs`, Node 22, aucune dépendance) : un robot
pilote Chrome comme un visiteur. Il remplit un CV, attend l'aperçu, clique sur Télécharger, crée un
compte, reçoit le PDF puis le Word, retrouve le CV dans « Mon espace ». Il ouvre ensuite chaque page à
5 largeurs d'écran : rien ne doit dépasser, aucune erreur JavaScript, aucun fichier introuvable, et
les bases de l'accessibilité. Il tourne aussi sur GitHub à chaque envoi (tâche « navigateur »). En local,
avec le site lancé sur une base jetable :

```bash
DOSSIER_DONNEES=/tmp/essai .venv/bin/python -c "import app; app.app.run(port=5077, threaded=True)" &
node tests/navigateur/verifier.mjs http://127.0.0.1:5077 /chemin/vers/chrome
```

`tests/test_traductions.py` vérifie les traductions anglaises et italiennes : pas de doublon,
les mêmes textes dans les deux langues, tous les messages du serveur traduits, et chaque
`confirm()` / `alert()` / `prompt()` passé par `tr()`. S'il échoue, il affiche le texte à ajouter
dans `web/traductions.js`.

## Export Word et suivi du parcours

- `word.py` fabrique le CV, la lettre ou le document administratif en `.docx` (route `/api/docx`,
  bouton « Word » de l'éditeur), sans bibliothèque à installer. Mise en page sur une colonne,
  lisible par les logiciels de recrutement. Plans et arbres : PDF seulement.
- Parcours dans l'éditeur (`/api/evenement`) : chaque étape (éditeur ouvert, commencé, aperçu,
  téléchargement, compte demandé, erreur) est comptée une fois par onglet, sans rien de personnel.
  Tableau de bord : carte « Parcours dans l'éditeur ». Les échecs de fabrication côté serveur sont
  comptés (`echec:…`) et visibles dans « Toutes les statistiques ».
- Téléchargements : deux minutes au plus, un second essai automatique si le serveur est occupé ou
  se réveille, et un message clair dans chaque cas.

## Assistant IA (analyse du CV)

Dans l'éditeur, « Analyser mon CV avec l'IA » donne une note expliquée (5 critères pondérés, calculée
par le serveur), les points forts, les alertes, des réécritures à appliquer d'un clic et, si une offre
est collée, la correspondance avec l'offre. Code : `ia.py` (serveur) et `web/editeur-ia.js`.

Réglages (Render > Environment) — sans eux, l'assistant est simplement caché :
- `IA_FOURNISSEUR` : `groq` ou `cerebras` pour tester gratuitement, `anthropic` (Claude Haiku) pour le lancement ;
- la clé correspondante : `GROQ_API_KEY`, `CEREBRAS_API_KEY` ou `ANTHROPIC_API_KEY` ;
- `IA_MODELE` (facultatif) : un autre modèle. Liste des modèles de ta clé :
  `IA_FOURNISSEUR=groq GROQ_API_KEY=… .venv/bin/python -m ia modeles` ;
- `IA_ANALYSES_PAR_JOUR` (5 par défaut, par compte) et `IA_ANALYSES_MAX_JOUR` (300, tous comptes) : coût maîtrisé.

Garde-fous : compte obligatoire et accord coché ; seul le parcours est envoyé (ni nom, ni
coordonnées, ni photo, ni état civil, ni références) ; les consignes cachées dans un CV ou une offre
sont traitées comme du texte ; une réécriture qui contient un chiffre absent du CV est marquée
« à vérifier » ; rien n'est modifié sans clic sur « Appliquer » ; seules les analyses réussies comptent.

## Lettre rédigée par l'IA, confirmation de l'adresse, copie des données, hors ligne

- **Lettre par l'IA** (onglet Lettre, « Rédiger ma lettre avec l'IA », route `/api/ia/lettre`) : les quatre
  paragraphes d'après le CV, le poste, l'entreprise et l'offre. Mêmes garde-fous que l'analyse (rien de
  personnel envoyé, chiffres absents du CV signalés) ; une lettre compte comme une analyse dans le quota.
- **Confirmation de l'adresse** : l'e-mail de bienvenue contient un lien signé (7 jours) qui remplit
  `verifie_le` ; « Mon espace » montre l'état et peut renvoyer le lien. Le compte reste utilisable sans.
- **Copie des données** (`/api/compte/export`) : profil, documents (photo comprise), liens publics,
  candidatures, en JSON ; jamais l'empreinte du mot de passe ni le jeton de session.
- **Hors ligne** (`web/sw.js`) : les pages déjà ouvertes et l'éditeur marchent sans réseau ; sinon la page
  `web/hors-ligne.html`. Jamais l'API, les CV en ligne ni l'administration.
- **Modèles** : 8 CV (dont Minimaliste et Créatif). Après une modification d'un modèle, refaire sa miniature
  (`.venv/bin/python miniatures.py`) ; `tests/test_import_aller_retour.py` vérifie que chaque modèle se réimporte.
- **Don** : `DON_LIEN` (https://paypal.me/…, https://ko-fi.com/…) ajoute « Soutenir le site » dans le pied de page.

## À régler chez les hébergeurs (rien à coder)

1. **Turnstile** (anti-robot de l'inscription) : `TURNSTILE_CLE_SITE` et `TURNSTILE_SECRET` sur Render.
2. **E-mails moins souvent dans les indésirables** : dans Brevo, *Senders, Domains* > ajouter le domaine
   `moncvexpress.com` et copier ses enregistrements DNS (DKIM, DMARC) dans Cloudflare ; puis
   `EMAIL_EXPEDITEUR=MonCVexpress.com <contact@moncvexpress.com>`. Pour recevoir les réponses :
   Cloudflare > Email Routing, `contact@moncvexpress.com` vers ta boîte Gmail.
3. **Assistant IA** : `IA_FOURNISSEUR` + la clé ; `IA_ANALYSES_PAR_JOUR` (2 aujourd'hui en ligne).
4. **Réveil** : un service gratuit (cron-job.org, UptimeRobot) qui appelle `/sante` toutes les 10 minutes.
5. **Sauvegardes** : secrets GitHub `SAUVEGARDE_DATABASE_URL` et `SAUVEGARDE_PHRASE` (voir plus bas).
6. **Google** : Search Console > ajouter `https://www.moncvexpress.com`, puis envoyer `/sitemap.xml`.
7. **Informations légales** : compléter `editeur.json` (nom, adresse, directeur de la publication, adresse
   de l'hébergeur, durée des journaux, droit applicable).

## Inscriptions protégées contre les robots

- Champ piège invisible dans le formulaire, et 10 inscriptions au plus par quart d'heure et par adresse IP.
- Vérification Cloudflare Turnstile (une case « Je suis humain », souvent validée toute seule),
  active seulement avec ces deux réglages chez l'hébergeur :
  1. Cloudflare → Turnstile → Add widget, domaine `www.moncvexpress.com`, mode « Managed » ;
  2. `TURNSTILE_CLE_SITE` = la Site Key, `TURNSTILE_SECRET` = la Secret Key.
- `INSCRIPTIONS_PAR_JOUR` (200 par défaut) : au-delà, les inscriptions sont suspendues 24 heures.
- `EMAILS_PAR_JOUR` (280 par défaut ; Brevo gratuit = 300) : les e-mails de bienvenue et de
  contact s'arrêtent 60 e-mails avant, pour garder de quoi envoyer les liens « mot de passe oublié ».
- La colonne `verifie_le` d'un compte note le jour où son adresse a été prouvée (lien reçu
  par e-mail ouvert) : prête pour une future vérification d'adresse obligatoire.

## Production

Voir le `Dockerfile`. Avec `DERRIERE_PROXY=1`, le serveur refuse de démarrer sans
`ADRESSE_SITE` (en https), `CLE_SECRETE`, `EMAIL_EXPEDITEUR` et un moyen d'envoyer les
e-mails : `BREVO_CLE_API` (API web de Brevo) ou les réglages `SMTP_…`.

La base des comptes est :
- une base PostgreSQL en ligne si `DATABASE_URL` est défini (par exemple Neon) ;
- sinon un fichier SQLite dans `/donnees` : monter alors un volume à cet endroit.

## Sauvegardes de la base

Le serveur fait une copie de la base toutes les 24 heures dans `/donnees/sauvegardes/`
et garde les 14 plus récentes. Réglages : `SAUVEGARDE_HEURES` (0 pour désactiver) et
`SAUVEGARDES_GARDEES`. Copie immédiate, par exemple depuis une tâche cron :

```bash
python -m comptes sauvegarder
```

**Ces copies sont sur le même disque que la base.** Elles protègent d'une erreur ou
d'une base abîmée, pas de la perte du disque : activer aussi les instantanés (snapshots)
du volume chez l'hébergeur, ou copier régulièrement `/donnees/sauvegardes/` ailleurs.

Restaurer une sauvegarde :

1. arrêter le serveur ;
2. remplacer `/donnees/comptes.sqlite3` par la copie choisie, et supprimer
   `comptes.sqlite3-wal` et `comptes.sqlite3-shm` s'ils existent ;
3. vérifier que le fichier appartient à l'utilisateur du serveur, avec les droits 600 ;
4. relancer le serveur.

## Déployer gratuitement : Render + Neon + Brevo

Trois comptes gratuits, chacun son rôle : **Render** fait tourner le site, **Neon** garde la
base des comptes, **Brevo** envoie les e-mails (inscription, mot de passe oublié).

1. **Neon** (neon.com) : créer un projet, région **AWS Europe Central (Frankfurt)**.
   Dans **Connect**, copier la chaîne de connexion (`postgresql://…?sslmode=require`).
   Les tables sont créées automatiquement au premier démarrage du site.
2. **Brevo** (brevo.com) :
   - **Senders, Domains & Dedicated IPs > Senders** : ajouter et valider l'adresse qui
     enverra les e-mails (un lien de confirmation arrive dans cette boîte) ;
   - **SMTP & API > API Keys** : créer une clé et la copier.
3. Pousser le dépôt sur GitHub (`git push`).
4. **Render** (render.com) : **New > Blueprint**, choisir le dépôt. Render lit `render.yaml`
   et demande :
   - `ADRESSE_SITE` : `https://cv-express.onrender.com` (le nom exact est affiché par
     Render ; s'il diffère, corriger cette valeur dans **Environment** ensuite) ;
   - `DATABASE_URL` : la chaîne de connexion Neon ;
   - `BREVO_CLE_API` : la clé Brevo ;
   - `EMAIL_EXPEDITEUR` : l'adresse validée dans Brevo, par exemple
     `MonCVexpress.com <ton.adresse@gmail.com>`.
5. Vérifier : créer un compte sur le site ; l'e-mail d'inscription doit arriver (regarder
   aussi les indésirables). En cas de problème, **Logs** dans Render.

Limites de l'offre gratuite : le site s'endort après 15 minutes sans visite (le premier
visiteur attend alors environ une minute), un PDF prend quelques secondes de plus, Neon
garde 1 Go (quelques milliers de comptes) et Brevo envoie 300 e-mails par jour.
Plus tard, avec un budget : `plan: starter` dans `render.yaml` (site jamais endormi,
plus rapide), sans rien changer d'autre.

Propre domaine : l'ajouter dans **Settings > Custom Domains** sur Render, puis mettre
`ADRESSE_SITE` à `https://ce-domaine`.

## Déployer gratuitement sur Hugging Face Spaces

Plus puissant que Render gratuit (2 processeurs, 16 Go), sans carte bancaire. Le site
s'endort après 48 heures sans visite. Neon et Brevo s'utilisent de la même façon.

1. Créer un compte sur huggingface.co, puis un jeton **Write** dans
   **Settings > Access Tokens**.
2. Mettre les réglages dans `production.env` (ignoré par Git) : `CLE_SECRETE`,
   `DATABASE_URL`, `BREVO_CLE_API`, `EMAIL_EXPEDITEUR`.
3. Publier (crée le Space, enregistre les réglages comme secrets, envoie le code) :

   ```bash
   .venv/bin/pip install huggingface_hub
   HF_TOKEN=hf_… .venv/bin/python publier_hf.py TON_NOM/cv-express production.env
   ```

   Pour une mise à jour du code ensuite : la même commande sans `production.env`.
4. Le site est à l'adresse `https://ton-nom-cv-express.hf.space` (affichée par le script).
   Donner cette adresse-là aux visiteurs : la page huggingface.co/spaces/… affiche le site
   dans un cadre, que le site refuse par sécurité (protection contre le « clickjacking »).

Si le journal affiche « Base PostgreSQL injoignable », Hugging Face bloque la sortie vers
le port 5432 de Neon : le signaler sur discuss.huggingface.co, ou héberger ailleurs.

### Tableau de bord de l'administrateur

Page `/admin` : nombre de comptes, inscriptions et activité, stockage utilisé, liste des
comptes avec recherche, et suppression d'un compte (mot de passe de l'administrateur
redemandé). L'administrateur peut aussi consulter et corriger un compte et ses documents
(annoncé dans la politique de confidentialité) ; chaque action est écrite dans le journal du
serveur, sans contenu personnel. Mots de passe, empreintes et jetons restent masqués.

Pour y accéder : créer un compte normal sur le site, puis mettre son adresse dans le réglage
`ADMINS` chez l'hébergeur (plusieurs adresses : séparées par des virgules). Pour tous les
autres visiteurs, la page n'existe pas (erreur 404).

### Sauvegarder la base en ligne

Neon gratuit ne garde pas de vraies sauvegardes.

**Automatique, chaque nuit** (`.github/workflows/sauvegarde.yml`) : GitHub copie la base Neon,
la restaure dans une base jetable pour vérifier qu'elle est complète, puis la chiffre et la
garde 30 jours dans l'onglet « Actions ». À régler une seule fois dans GitHub > Settings >
Secrets and variables > Actions > New repository secret :

- `SAUVEGARDE_DATABASE_URL` : la même valeur que `DATABASE_URL` sur Render ;
- `SAUVEGARDE_PHRASE` : une longue phrase secrète. **Note-la ailleurs** (gestionnaire de mots
  de passe) : sans elle, les copies sont illisibles, même pour toi.

Puis Actions > « Sauvegarde de la base » > Run workflow, pour vérifier tout de suite que ça marche.
GitHub met en pause les tâches programmées d'un dépôt sans aucun envoi pendant 60 jours :
il suffit alors de cliquer « Enable workflow ».

Restaurer une copie automatique : Actions > une exécution réussie > Artifacts > télécharger,
dézipper, puis :

```bash
gpg --decrypt comptes-DATE.sqlite3.gpg > comptes-DATE.sqlite3      # demande la phrase secrète
DATABASE_URL='postgresql://…' .venv/bin/python -m comptes restaurer comptes-DATE.sqlite3
DATABASE_URL='postgresql://…' .venv/bin/python -m comptes verifier comptes-DATE.sqlite3
```

**À la main**, depuis ton ordinateur, quand tu veux :

```bash
DATABASE_URL='postgresql://…' .venv/bin/python -m comptes sauvegarder
```

La base entière est copiée dans un fichier `donnees/sauvegardes/comptes-DATE.sqlite3`
(il contient les adresses e-mail des clients : ne pas le partager). Pour la remettre en
ligne dans une base Neon **vide** (nouvelle base, ou après un accident) :

```bash
DATABASE_URL='postgresql://…' .venv/bin/python -m comptes restaurer donnees/sauvegardes/comptes-DATE.sqlite3
```

La même commande transfère les comptes d'une ancienne base SQLite vers Neon.

### Tests sur PostgreSQL

Les tests tournent aussi sur une base PostgreSQL **jetable** (elle est vidée à chaque test,
ne jamais y mettre l'adresse de la vraie base) :

```bash
CV_TESTS_POSTGRES='postgresql://…/base_de_test' .venv/bin/python -m pytest tests -q
```
