(() => {
  "use strict";

  /*
   * صور الشعارات حسب الثيم.
   * وجود الشرطة / في البداية يعني أن الصور موجودة
   * في المجلد الرئيسي للموقع بجانب index.html.
   */
  const THEME_ASSETS = {
    lootlingua: {
      favicon: "/Lootlingua_LOGO_2.png",
      browserColor: "#071a22",
    },

    golden: {
      favicon: "/Lootlingua_LOGO_3.png",
      browserColor: "#0a0a0a",
    },

    scroll: {
      favicon: "/Lootlingua_LOGO_4.png",
      browserColor: "#eee8dd",
    },

    oceanLight: {
      favicon: "/Lootlingua_LOGO_5.png",
      browserColor: "#eaf4f4",
    },

    oceanDark: {
      favicon: "/Lootlingua_LOGO_6.png",
      browserColor: "#090c0f",
    },

    glass: {
      favicon: "/Lootlingua_LOGO_7.png",
      browserColor: "#0ea5e9",
    },
  };

  /**
   * يقرأ الخاصية من html أو body.
   * هذا يجعل الكود يعمل مهما كان مكان data-theme في موقعك.
   */
  function getThemeAttribute(attributeName) {
    const htmlValue =
      document.documentElement.getAttribute(attributeName);

    const bodyValue =
      document.body?.getAttribute(attributeName);

    return (htmlValue || bodyValue || "")
      .trim()
      .toLowerCase();
  }

  /**
   * يحوّل الثيم الحالي إلى اسم داخل THEME_ASSETS.
   */
  function getCurrentThemeKey() {
    const theme = getThemeAttribute("data-theme");
    const oasisMode = getThemeAttribute("data-oasis-mode");

    switch (theme) {
      case "golden":
        return "golden";

      case "scroll":
        return "scroll";

      case "ocean":
        return oasisMode === "dark"
          ? "oceanDark"
          : "oceanLight";

      case "glass":
        return "glass";

      /*
       * يشمل:
       * data-theme="lootlingua"
       * data-theme="default"
       * أو عدم وجود data-theme أساسًا.
       */
      default:
        return "lootlingua";
    }
  }

  /**
   * يغير صورة التبويب ولون المتصفح.
   */
  function updateThemeBranding() {
    const themeKey = getCurrentThemeKey();
    const asset = THEME_ASSETS[themeKey];

    if (!asset) {
      console.warn(
        `[LootLingua] لا توجد صورة معرفة للثيم: ${themeKey}`
      );
      return;
    }

    let favicon =
      document.getElementById("site-favicon");

    /*
     * حماية إضافية:
     * إذا لم يجد السطر داخل HTML، ينشئه تلقائيًا.
     */
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.id = "site-favicon";
      favicon.rel = "icon";
      favicon.type = "image/png";
      document.head.appendChild(favicon);
    }

    const currentFavicon =
      favicon.getAttribute("href");

    if (currentFavicon !== asset.favicon) {
      favicon.setAttribute("href", asset.favicon);
    }

    let themeColor =
      document.getElementById("site-theme-color");

    if (!themeColor) {
      themeColor = document.createElement("meta");
      themeColor.id = "site-theme-color";
      themeColor.name = "theme-color";
      document.head.appendChild(themeColor);
    }

    themeColor.setAttribute(
      "content",
      asset.browserColor
    );
  }

  /**
   * يبدأ المراقبة بعد تجهيز الصفحة.
   */
  function initializeThemeBranding() {
    // يضبط الصورة الصحيحة عند فتح الموقع.
    updateThemeBranding();

    const observerOptions = {
      attributes: true,
      attributeFilter: [
        "data-theme",
        "data-oasis-mode",
      ],
    };

    /*
     * نراقب html وbody معًا،
     * لأن الموقع قد يضع خصائص الثيم على أحدهما.
     */
    const themeObserver =
      new MutationObserver(() => {
        updateThemeBranding();
      });

    themeObserver.observe(
      document.documentElement,
      observerOptions
    );

    if (document.body) {
      themeObserver.observe(
        document.body,
        observerOptions
      );
    }
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
