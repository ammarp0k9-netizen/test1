(() => {
  "use strict";

  // Glass V2.8 uses reliable CSS backdrop sampling only.
  // Remove V2.7's SVG filter host/classes if an older build left them behind.
  document.documentElement.classList.remove("glass-true-refraction", "glass-refraction-fallback");
  document.getElementById("lootlingua-liquid-refraction-defs")?.remove();
})();
