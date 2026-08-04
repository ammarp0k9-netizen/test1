(() => {
  "use strict";

  /*
   * أسماء الملفات فقط، بدون / في البداية.
   * يتم حساب المسار تلقائيًا بحسب مكان index.html.
   */
  const THEME_ASSETS = {
    lootlingua: {
      file: "Lootlingua_LOGO_2.png",
      browserColor: "#071a22",
      version: "2",
    },

    golden: {
      file: "Lootlingua_LOGO_3.png",
      browserColor: "#0a0a0a",
      version: "3",
    },

    scroll: {
      file: "Lootlingua_LOGO_4.png",
      browserColor: "#eee8dd",
      version: "4",
    },

    oceanLight: {
      file: "Lootlingua_LOGO_5.png",
      browserColor: "#eaf4f4",
      version: "5",
    },

    oceanDark: {
      file: "Lootlingua_LOGO_6.png",
      browserColor: "#090c0f",
      version: "6",
    },

    glass: {
      file: "Lootlingua_LOGO_7.png",
      browserColor: "#0ea5e9",
      version: "7",
    },
  };

  let scheduledUpdate = null;

  /**
   * يبحث عن قيمة الخاصية في html ثم body،
   * ثم في أي عنصر آخر داخل الصفحة.
   */
  function readDataAttribute(attributeName) {
    const possibleElements = [
      document.documentElement,
      document.body,
      ...document.querySelectorAll(`[${attributeName}]`),
    ].filter(Boolean);

    for (const element of possibleElements) {
      const value = element.getAttribute(attributeName);

      if (value && value.trim()) {
        return value.trim().toLowerCase();
      }
    }

    return "";
  }

  /**
   * يحدد الصورة الصحيحة بحسب الثيم والوضع.
   */
  function getCurrentAssetKey() {
    const theme = readDataAttribute("data-theme");
    const oasisMode = readDataAttribute("data-oasis-mode");

    if (theme === "ocean") {
      return oasisMode === "dark"
        ? "oceanDark"
        : "oceanLight";
    }

    switch (theme) {
      case "golden":
        return "golden";

      case "scroll":
        return "scroll";

      case "glass":
        return "glass";

      case "lootlingua":
      case "default":
      case "":
      default:
        return "lootlingua";
    }
  }

  /**
   * ينشئ رابطًا يعمل في GitHub Pages وLive Server وVercel.
   */
  function createAssetUrl(fileName, version) {
    const url = new URL(fileName, document.baseURI);

    /*
     * يمنع Chrome من استخدام favicon قديم من الكاش.
     */
    url.searchParams.set("v", version);

    return url.href;
  }

  /**
   * يغير favicon ولون واجهة المتصفح.
   */
  function updateThemeBranding() {
    const assetKey = getCurrentAssetKey();
    const asset = THEME_ASSETS[assetKey];

    if (!asset) {
      console.warn(
        `[LootLingua] لم يتم العثور على إعدادات الثيم: ${assetKey}`
      );

      return;
    }

    let favicon = document.getElementById("site-favicon");

    if (!favicon) {
      favicon = document.createElement("link");
      favicon.id = "site-favicon";
      favicon.rel = "icon";
      favicon.type = "image/png";
      document.head.appendChild(favicon);
    }

    const faviconUrl = createAssetUrl(
      asset.file,
      asset.version
    );

    if (favicon.href !== faviconUrl) {
      favicon.href = faviconUrl;
    }

    let themeColor =
      document.getElementById("site-theme-color");

    if (!themeColor) {
      themeColor = document.createElement("meta");
      themeColor.id = "site-theme-color";
      themeColor.name = "theme-color";
      document.head.appendChild(themeColor);
    }

    themeColor.content = asset.browserColor;
  }

  /**
   * يمنع تشغيل التحديث مرات كثيرة في اللحظة نفسها.
   */
  function scheduleBrandingUpdate() {
    if (scheduledUpdate !== null) {
      cancelAnimationFrame(scheduledUpdate);
    }

    scheduledUpdate = requestAnimationFrame(() => {
      scheduledUpdate = null;
      updateThemeBranding();
    });
  }

  function initializeThemeBranding() {
    updateThemeBranding();

    /*
     * نراقب الصفحة كاملة؛ لأن data-oasis-mode
     * قد لا تكون موجودة على نفس العنصر الذي توقعناه سابقًا.
     */
    const themeObserver = new MutationObserver(
      scheduleBrandingUpdate
    );

    themeObserver.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: [
        "data-theme",
        "data-oasis-mode",
      ],
    });

    /*
     * احتياط لو الموقع عنده حدث مخصص لتغيير الثيم.
     */
    window.addEventListener(
      "storage",
      scheduleBrandingUpdate
    );

    window.addEventListener(
      "pageshow",
      scheduleBrandingUpdate
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeThemeBranding,
      { once: true }
    );
  } else {
    initializeThemeBranding();
  }
})();