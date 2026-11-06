# Loot Runner browser verification

Run `node tools/runner-browser-smoke.mjs` from the repository root.

The fixture uses the real controller, lazy CSS/renderer, engine, modal focus
manager, scroll locks and app keyboard handler. Published words and profile
writes are deterministic in-memory adapters; external HTTPS is blocked.
No Firebase or production API writes occur.

Final result: all focused checks pass; `runtimeExceptions` is empty.

`npm run test:runner` also passes 21 focused engine, profile synchronization
and expedition tests: crossing-time collisions, gate evaluation, pause,
invulnerability and bounded object reuse over 20,000 updates.

- CSS viewports are explicitly checked at 1280, 390 and 320 pixels, with the
  viewport meta tag present. Controls, intro, focus and scroll isolation fit
  inside each viewport without horizontal overflow.
- Arrow keys, Space, Down, P and touch swipes activate the real controls. One
  horizontal swipe changes one lane. Pausing freezes distance. Enter does not
  activate the dictionary button behind the game.
- Exit restores focus, scroll and background isolation. Account changes stop
  the run. Word-fetch failure and official review becoming due prevent or stop
  play, including a due change during an asynchronous word fetch.
- A desktop run collects coins and submits exactly one account wallet
  delta with its immutable run ID. The fixture never grants XP or SRS progress.
- A separate safe-route engine/renderer fixture simulates 120 seconds with
  600 real canvas draws. Its peak is recorded in the JSON report; the combined pool and
  active list stays at 48, and DOM count remains unchanged. The renderer's DPR
  is capped at 1.5. Backing-pixel/client-width ratios differ slightly because
  the controller supplies the viewport rectangle including its two borders.

`desktop-running.png` captures actual controller gameplay. The two mobile
images use the real renderer and cloned controller UI after controller cleanup,
with explicit public engine states for a gate, low/overhead/wall obstacles,
jump and slide. This avoids mutating a live run or competing resize callbacks.
`train-rooftop.png` shows the shared roof support height, elevated coins and
the lightweight tunnel scenery in another isolated renderer state.

The second iteration spaces gates 30–48 seconds apart (30–42 seconds for the
first), gradually increases running speed, and temporarily slows reading gates.
Rows queue behind a gate's dark road veil, so play resumes without waiting for
a completely new obstacle batch. Collision and drawing share one height model:
high jumps miss ground coins, slides clear overhead beams, and carriage ramps
support the runner and elevated coins. Near-obstacle hints help time actions.

These are focused local measurements, not a claim of 60 FPS on every device.
