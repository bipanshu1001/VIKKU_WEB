/*
  Cinematics (Theatre.js) + UI motion (Motion)
  --------------------------------------------
  - Theatre.js owns the authored camera moves: the intro shot and the dive through the window.
    It animates a small "camera rig" (orbit / lift / dolly / fov / roll) that main.js layers on top of
    whatever view the camera is flying to, so the shots work at any screen size.
  - Keyframes live in theatre-state.json. To edit them visually, open /?studio, tweak, then use
    Studio's "Export" on the project and replace theatre-state.json with the downloaded file.
  - Motion does the HTML side: staggered reveals and springy hotspots.
  Both load from a CDN. If either fails, main.js just runs without it (same site, less motion).
*/

export const NEUTRAL_RIG = { orbit: 0, lift: 0, dolly: 1, fov: 45, roll: 0 };

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

export async function loadMotion() {
  try {
    const { animate, stagger, spring } = await withTimeout(import('motion'), 2500);
    return { animate, stagger, spring };
  } catch (err) {
    console.warn('Motion unavailable, UI animations off.', err);
    return null;
  }
}

export async function loadCinematics() {
  try {
    const core = await withTimeout(import('@theatre/core'), 2500);
    const { getProject, types, val } = core.default ?? core;

    const studioMode = new URLSearchParams(location.search).has('studio');
    if (studioMode) {
      const mod = await import('@theatre/studio');
      // The CDN build wraps the studio object a couple of levels deep.
      const studio = [mod.default?.default, mod.default, mod].find(s => s?.initialize);
      studio.initialize();
    }

    // In studio mode the editor's own saved state (localStorage) wins, so edits survive reloads.
    const state = await fetch(new URL('theatre-state.json', import.meta.url)).then(r => r.json()).catch(() => null);
    const project = getProject('Desk portfolio', state ? { state } : {});

    const rigProps = {
      orbit: types.number(NEUTRAL_RIG.orbit, { range: [-Math.PI, Math.PI], nudgeMultiplier: 0.01 }),
      lift:  types.number(NEUTRAL_RIG.lift,  { range: [-1, 4], nudgeMultiplier: 0.01 }),
      dolly: types.number(NEUTRAL_RIG.dolly, { range: [0.1, 4], nudgeMultiplier: 0.01 }),
      fov:   types.number(NEUTRAL_RIG.fov,   { range: [10, 110] }),
      roll:  types.number(NEUTRAL_RIG.roll,  { range: [-0.6, 0.6], nudgeMultiplier: 0.005 }),
    };
    const shot = name => {
      const sheet = project.sheet(name);
      return { sheet, rig: sheet.object('Camera rig', rigProps), length: () => val(sheet.sequence.pointer.length) };
    };
    const shots = { intro: shot('Intro'), portal: shot('Portal') };

    await withTimeout(project.ready, 2500);
    return { shots, studioMode };
  } catch (err) {
    console.warn('Theatre.js unavailable, camera shots off.', err);
    return null;
  }
}
