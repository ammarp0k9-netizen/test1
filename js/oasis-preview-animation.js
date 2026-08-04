(() => {
  "use strict";

  const LIGHT_COLOR = "#dff7f3";
  const DARK_COLOR = "#0b1718";

   const ANIMATION_DURATION = 330;
   const ANIMATION_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

  let updateFrame = null;

  /**
   * يبحث عن data-theme وdata-oasis-mode
   * سواء كانا على html أو body أو عنصر آخر.
   */
  function readAttribute(attributeName) {
    const directElements = [
      document.documentElement,
      document.body,
    ].filter(Boolean);

    for (const element of directElements) {
      const value = element.getAttribute(attributeName);

      if (value && value.trim()) {
        return value.trim().toLowerCase();
      }
    }

    const foundElement =
      document.querySelector(`[${attributeName}]`);

    return (
      foundElement
        ?.getAttribute(attributeName)
        ?.trim()
        ?.toLowerCase() || ""
    );
  }

  /**
   * يعيد الحالة المطلوبة للدائرة:
   * split = الثيم غير مختار
   * light = واحة نهارية
   * dark  = واحة ليلية
   */
  function getDesiredState() {
    const theme = readAttribute("data-theme");
    const oasisMode = readAttribute("data-oasis-mode");

    if (theme !== "ocean") {
      return "split";
    }

    return oasisMode === "dark"
      ? "dark"
      : "light";
  }

  /**
   * ينشئ طبقتي الحركة داخل الدائرة تلقائيًا.
   */
  function preparePreview(preview) {
    let fill =
      preview.querySelector(".oasis-preview-fill");

    let wipe =
      preview.querySelector(".oasis-preview-wipe");

    if (!fill) {
      fill = document.createElement("span");
      fill.className = "oasis-preview-fill";
      preview.appendChild(fill);
    }

    if (!wipe) {
      wipe = document.createElement("span");
      wipe.className = "oasis-preview-wipe";
      preview.appendChild(wipe);
    }

    return { fill, wipe };
  }

  function getStateSettings(state) {
    if (state === "dark") {
      return {
        color: DARK_COLOR,

        /*
         * الأسود يبدأ من الجهة اليمنى
         * ويتحرك نحو الجزء الفاتح.
         */
        origin: "right center",
      };
    }

    return {
      color: LIGHT_COLOR,

      /*
       * اللون الفاتح يبدأ من اليسار
       * ويتحرك نحو الجزء الغامق.
       */
      origin: "left center",
    };
  }

  function cancelPreviewAnimation(preview) {
    if (preview._oasisAnimation) {
      preview._oasisAnimation.cancel();
      preview._oasisAnimation = null;
    }
  }

  /**
   * من التقسيم النصفي إلى النهاري أو الليلي.
   */
  function animateFromSplit(preview, fill, targetState) {
    const settings = getStateSettings(targetState);

    cancelPreviewAnimation(preview);

    fill.style.background = settings.color;
    fill.style.transformOrigin = settings.origin;
    fill.style.transform = "scaleX(0)";

    const animation = fill.animate(
      [
        { transform: "scaleX(0)" },
        { transform: "scaleX(1)" },
      ],
      {
        duration: ANIMATION_DURATION,
        easing: ANIMATION_EASING,
        fill: "forwards",
      }
    );

    preview._oasisAnimation = animation;

    animation.onfinish = () => {
      fill.style.transform = "scaleX(1)";
      animation.cancel();
      preview._oasisAnimation = null;
    };
  }

  /**
   * من النهاري إلى الليلي أو العكس.
   * اللون السابق يبقى كاملًا، والجديد يمسحه فوقه.
   */
  function animateBetweenModes(
    preview,
    fill,
    wipe,
    targetState
  ) {
    const settings = getStateSettings(targetState);

    cancelPreviewAnimation(preview);

    wipe.style.background = settings.color;
    wipe.style.transformOrigin = settings.origin;
    wipe.style.transform = "scaleX(0)";

    const animation = wipe.animate(
      [
        { transform: "scaleX(0)" },
        { transform: "scaleX(1)" },
      ],
      {
        duration: ANIMATION_DURATION,
        easing: ANIMATION_EASING,
        fill: "forwards",
      }
    );

    preview._oasisAnimation = animation;

    animation.onfinish = () => {
      /*
       * ننقل اللون الجديد إلى الطبقة الأساسية،
       * ثم نخفي طبقة المسح استعدادًا للمرة القادمة.
       */
      fill.style.background = settings.color;
      fill.style.transformOrigin = settings.origin;
      fill.style.transform = "scaleX(1)";

      wipe.style.transform = "scaleX(0)";

      animation.cancel();
      preview._oasisAnimation = null;
    };
  }

  /**
   * عند إزالة ثيم الواحة، ينسحب اللون
   * ويعود التقسيم النصفي الأصلي.
   */
  function animateBackToSplit(
    preview,
    fill,
    previousState
  ) {
    const settings = getStateSettings(previousState);

    cancelPreviewAnimation(preview);

    fill.style.transformOrigin = settings.origin;

    const animation = fill.animate(
      [
        { transform: "scaleX(1)" },
        { transform: "scaleX(0)" },
      ],
      {
        duration: ANIMATION_DURATION,
        easing: ANIMATION_EASING,
        fill: "forwards",
      }
    );

    preview._oasisAnimation = animation;

    animation.onfinish = () => {
      fill.style.transform = "scaleX(0)";
      animation.cancel();
      preview._oasisAnimation = null;
    };
  }

  function updateSinglePreview(preview, targetState) {
    const { fill, wipe } = preparePreview(preview);

    const previousState =
      preview.dataset.oasisPreviewState || "uninitialized";

    if (previousState === targetState) {
      return;
    }

    /*
     * أول تحميل للصفحة:
     * نعرض الحالة الصحيحة فورًا دون حركة غريبة.
     */
    if (previousState === "uninitialized") {
      if (targetState === "split") {
        fill.style.transform = "scaleX(0)";
      } else {
        const settings = getStateSettings(targetState);

        fill.style.background = settings.color;
        fill.style.transformOrigin = settings.origin;
        fill.style.transform = "scaleX(1)";
      }

      preview.dataset.oasisPreviewState = targetState;
      return;
    }

    if (targetState === "split") {
      animateBackToSplit(
        preview,
        fill,
        previousState === "dark" ? "dark" : "light"
      );
    } else if (previousState === "split") {
      animateFromSplit(preview, fill, targetState);
    } else {
      animateBetweenModes(
        preview,
        fill,
        wipe,
        targetState
      );
    }

    preview.dataset.oasisPreviewState = targetState;
  }

  function updateAllPreviews() {
    const targetState = getDesiredState();

    document
      .querySelectorAll(".preview-ocean")
      .forEach((preview) => {
        updateSinglePreview(preview, targetState);
      });
  }

  function scheduleUpdate() {
    if (updateFrame !== null) {
      cancelAnimationFrame(updateFrame);
    }

    updateFrame = requestAnimationFrame(() => {
      updateFrame = null;
      updateAllPreviews();
    });
  }

  function initialize() {
    updateAllPreviews();

    const observer = new MutationObserver(scheduleUpdate);

    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: [
        "data-theme",
        "data-oasis-mode",
      ],
    });

    /*
     * احتياط إذا أعاد الموقع رسم قائمة الثيمات.
     */
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("pageshow", scheduleUpdate);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }
})();