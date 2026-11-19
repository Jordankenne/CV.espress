"use strict";
// En-tête des pages : si le visiteur est connecté, le lien « Se connecter » devient
// « Mon espace », avec l'initiale de son adresse.
(async () => {
  try {
    const r = await fetch("/api/compte", { credentials: "same-origin" });
    const compte = await r.json();
    if (!compte.connecte) return;
    for (const lien of document.querySelectorAll("a[data-lien-compte]")) {
      const pastille = document.createElement("span");
      pastille.className = "initiale";
      pastille.textContent = compte.email[0].toUpperCase();
      lien.replaceChildren(pastille, "Mon espace");
      lien.title = compte.email;
    }
  } catch { /* hors ligne : le lien reste « Se connecter » */ }
})();

// Accueil : un filet sous l'en-tête dès qu'on fait défiler, et les CV de la une qui suivent
// légèrement la souris. Rien de tout ça si l'appareil demande moins d'animations.
(() => {
  const entete = document.querySelector("[data-entete]");
  if (entete) {
    const marquer = () => entete.classList.toggle("defile", scrollY > 8);
    addEventListener("scroll", marquer, { passive: true });
    marquer();
  }
  const visuel = document.querySelector("[data-parallaxe]");
  if (!visuel || matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(pointer: fine)").matches) return;
  let image = 0;
  addEventListener("pointermove", e => {
    cancelAnimationFrame(image);
    image = requestAnimationFrame(() => {
      visuel.style.setProperty("--x", ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
      visuel.style.setProperty("--y", ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
    });
  }, { passive: true });
})();
