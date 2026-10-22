// Page-level settings read from the URL.
//   ?demo        no camera: a synthetic scene and stand-in hands and faces
//   ?fx=<id|n>   start on this effect (its id, or its 1-based position)
// Effects can read their own parameters from `urlParams` (Portal's ?scene=).

export const urlParams = new URLSearchParams(location.search);

export let demoMode = urlParams.has("demo");

// No camera or tracker after all: run the demo instead.
export function enterDemoMode() {
  demoMode = true;
}
