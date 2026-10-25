# Bipanshu's 3D Portfolio

One site, two connected worlds:

- **`/` The desk** (main page). Click objects: laptop → projects, bookshelf → skills, calendar → timeline,
  frames → certificates, photo → about, phone → contact, lamp → light switch.
- **`/space/` The space journey.** Reached by clicking the **window** above the desk: the camera flies into
  the night sky and you arrive in space. "← Back to my desk" flies you back out through the window.

Everything is built in code (Three.js shapes + canvas textures). No model files, no build step.

## Run
```bash
npx serve -l 5173 .
```
Open http://localhost:5173 . Deep links work: `/#projects`, `/#skills`, `/space/#projects`.

## Files
| Path | What |
|---|---|
| `index.html`, `style.css`, `main.js` | Desk site. `VIEWS` = camera per object, `SHELVES` = books, `draw*` = canvas art |
| `space/index.html`, `space/style.css`, `space/main.js` | Space site. `STOPS` = planet positions/colours |
| `resume.html` | Standalone resume page (links from both desk and space) |
| `cinematics.js` | Loads Theatre.js (camera shots) and Motion (HTML animation) from a CDN; both optional |
| `theatre-state.json` | Theatre.js keyframes for the `Intro` and `Portal` shots |

### Camera shots (Theatre.js) and UI motion (Motion)
- Theatre animates a **camera rig** (`orbit`, `lift`, `dolly`, `fov`, `roll`) that `main.js` layers on top of
  the current view, so shots adapt to any screen size. `Intro` plays on a fresh visit; `Portal` is the dive
  through the window (played in reverse when you come back from space).
- **Edit shots visually:** open `http://localhost:5173/?studio`. Scrub/keyframe the `Camera rig` of either sheet
  (clicking the window previews the dive without leaving; `Esc` returns). Then click the project in Studio's
  outline → **Export** → replace `theatre-state.json` with the downloaded file. Clear site data to drop Studio's
  locally saved edits.
- Motion staggers the intro card, springs the hotspots in, and reveals each panel's content.
- If either CDN fails or is slower than 2.5 s, the site runs exactly as before without it. Reduced-motion users get neither.

**Content lives in two places** (`index.html` and `space/index.html`). When you change a project, update both.
The window's planets (`drawSky` in `main.js`) use the same colours as `STOPS` in `space/main.js`.

### How the window transition works
1. Desk: click window → camera flies to the glass → page fades to black → loads `space/#from-desk`.
2. Space: starts black and far away (`warp = 1`), fades in and flies to the galaxy.
3. Back: fade + fly out → loads `/#from-space` → desk starts at the window and pulls back into the room.
Both directions respect `prefers-reduced-motion` (instant navigation, no flights).

## Before sharing
- [x] ~~Emotion Detection accuracy TODO~~ — removed, showing "under 200 ms" result.
- [x] ~~GitHub repo link TODOs~~ — removed; links go to profile for now.
- [x] ~~AWS course verification TODOs~~ — removed.
- [x] ~~Add resume~~ — `resume.html` created with full details.
- [x] ~~Sync content~~ — desk and space pages now match (skills, about, hobbies, goals).
- [ ] Optional: replace the "BK" photo placeholder (`drawAvatar` in `main.js`) with a real photo.
- [ ] Optional: add individual GitHub repo links when repos are public.

## Deploy (GitHub Pages)
Push this folder to a repo → Settings → Pages → deploy from `main`, root. Relative links already work in a subfolder.

## Accessibility / fallbacks
- Hotspots are real buttons (keyboard + screen reader). `Esc` returns to the desk overview.
- "Plain view" on the desk shows everything as a normal page; it also turns on automatically if WebGL fails.
- The space site's text is normal HTML, so it is readable even without 3D.
