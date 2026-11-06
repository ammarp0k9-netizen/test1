# Glass material polish

`glass-theme.css` is the final, theme-scoped material contract after the older
visual layers. It separates floating chrome, reading cards and modal sheets.
Normal text is solid, with static glass lettering only on selected large
headings in Ultra/Balanced. The page canvas and edge highlights are static.

The fixed bars use one backdrop pass (12px Ultra, 8px Balanced); their previous
two additional backdrop-sampling pseudo layers are replaced by static paint.
Repeated word/content cards and controls do not sample the backdrop. Stable,
Turbo and low-end modes disable shell/sheet blur and use more opaque materials.
OS reduced transparency overrides even Ultra, and reduced motion restores
solid headings without animation. Browsers without backdrop-filter get the
opaque materials through a feature-query fallback.

Focused local Chrome verification: `node tools/glass-material-browser-smoke.mjs`.
It uses actual styles and the dictionary card renderer with sample content,
plus the real top/dock/search markup. Network/Firebase are excluded; symbols
stand in for the external icon font in screenshots. It covers 1280px desktop,
390/320px phones, every performance mode, selection, reduced transparency
and motion, and isolation from other themes. The contrast values in the JSON
are calculated against a representative bright canvas and the strongest card
highlight, not a full-page accessibility certification or a device FPS test.

No dependencies, running animation loops or production data changes were added.
