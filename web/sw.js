"use strict";
/*
 * Service worker : le site reste utilisable sur une connexion faible ou coupée.
 *
 *  - Pages (accueil, éditeur, guides…) : toujours demandées au serveur d'abord ; si le réseau
 *    ne répond pas, la dernière copie gardée sur l'appareil, sinon la page « Hors ligne ».
 *    L'éditeur s'ouvre donc sans réseau : on peut remplir son CV (il est gardé dans le
 *    navigateur), l'aperçu et le PDF reviennent avec la connexion.
 *  - Scripts, styles, polices, images : leur adresse change à chaque nouvelle version du site
 *    (?v=…), une copie gardée ne peut donc jamais être périmée.
 *  - Jamais : l'API (comptes, CV, PDF), l'administration, les CV en ligne (/cv/…), les PDF
 *    d'exemple. Rien de personnel n'est gardé par ce fichier.
 */
const PAGES = "pages-v1", FICHIERS = "fichiers-v1", HORS_LIGNE = "/hors-ligne.html";
const MAXI_PAGES = 40, MAXI_FICHIERS = 120;
const JAMAIS = /^\/(api\/|admin|cv\/|exemple\/|sw\.js)/;
const FICHIER = /\.(js|css|woff2|png|webp|svg|ico|json|webmanifest)$/;

// À l'installation : la page « Hors ligne » et sa feuille de style (dont l'adresse porte la version du site).
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const reponse = await fetch(HORS_LIGNE, { cache: "no-cache" });
    const html = await reponse.clone().text();
    await (await caches.open(PAGES)).put(HORS_LIGNE, reponse);
    const style = html.match(/href="(\/style\.css\?v=[^"]+)"/);
    if (style) await (await caches.open(FICHIERS)).add(style[1].replace(/&amp;/g, "&"));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) if (![PAGES, FICHIERS].includes(nom)) await caches.delete(nom);
    await self.clients.claim();
  })());
});

/** Garde au plus « maxi » réponses dans ce cache (les plus anciennes partent d'abord). */
async function limiter(nom, maxi) {
  const cache = await caches.open(nom);
  const cles = await cache.keys();
  for (const cle of cles.slice(0, Math.max(0, cles.length - maxi))) await cache.delete(cle);
}

async function page(requete) {
  const cache = await caches.open(PAGES);
  try {
    const reponse = await fetch(requete);
    if (reponse.ok && reponse.type === "basic") {
      // Une seule copie par adresse, sans ses paramètres (?doc=…, ?jeton=… ne sont jamais gardés).
      const adresse = new URL(requete.url);
      await cache.put(adresse.origin + adresse.pathname, reponse.clone());
      limiter(PAGES, MAXI_PAGES);
    }
    return reponse;
  } catch {
    return (await cache.match(requete, { ignoreSearch: true })) || (await cache.match(HORS_LIGNE));
  }
}

async function telecharger(requete, cache) {
  const reponse = await fetch(requete);
  const adresse = new URL(requete.url);
  // Seulement des fichiers du site : versionnés (?v=…), images et polices.
  const garder = adresse.searchParams.has("v") || /^\/(img|polices)\//.test(adresse.pathname);
  if (reponse.ok && reponse.type === "basic" && garder) {
    await cache.put(requete, reponse.clone());
    limiter(FICHIERS, MAXI_FICHIERS);
  }
  return reponse;
}

async function fichier(requete) {
  const cache = await caches.open(FICHIERS);
  const garde = await cache.match(requete);
  if (!garde) return telecharger(requete, cache);
  // Fichier versionné : sa copie est forcément la bonne. Image ou police (adresse sans version) :
  // la copie sert tout de suite, et une version fraîche la remplace pour la prochaine fois.
  if (!new URL(requete.url).searchParams.has("v")) telecharger(requete, cache).catch(() => {});
  return garde;
}

self.addEventListener("fetch", e => {
  const requete = e.request;
  const adresse = new URL(requete.url);
  if (requete.method !== "GET" || adresse.origin !== location.origin || JAMAIS.test(adresse.pathname)) return;
  if (requete.mode === "navigate") e.respondWith(page(requete));
  else if (FICHIER.test(adresse.pathname)) e.respondWith(fichier(requete).catch(() => caches.match(requete, { ignoreSearch: true })
    .then(r => r || Response.error())));
});
