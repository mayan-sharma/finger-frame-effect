# Contributing

Thanks for wanting to help. New effects are the most welcome contribution:
each one is a single file, and [docs/EFFECTS.md](docs/EFFECTS.md) walks
through writing one. Other good contributions:

- **Tuning on real hands.** Pose thresholds were tuned on a few people and a
  few rooms. If an effect misfires or won't fire for you, open an issue that
  says what you tried, your lighting, and how far you were from the camera.
- **Bug fixes**, with the browser, the OS and any console error.
- **Docs**, especially anything that tripped you up.

## Setup

You need Node 18+ and Google Chrome (for the tests).

```sh
npm install      # the test runner; the app itself has no dependencies
npm start        # http://localhost:8123 (add ?demo if you have no camera)
npm test         # every effect, headless
```

There is no build step. Edit a file and reload: the dev server turns caching
off.

## Where things live

| Path | What |
| ---- | ---- |
| `src/effects/` | One file per effect, plus `index.js` (the list) and two `_template-*.js` files |
| `src/api.js` | Everything an effect may import, with a comment on every group |
| `src/core/` | The app shell: the effect registry, the frame loop, the finger frame and its dials, the trackers, keys and swipes |
| `src/lib/` | Helpers shared by effects: hands, face, person mask, particles, scenes, demo stand-ins |
| `test/` | The smoke test, and the fake tracker it runs on |
| `terminal/` | The Python terminal edition (separate; see the README) |

## Ground rules

- **An effect is one file, plus one line in `src/effects/index.js`.** If you
  need to touch anything else, say why in the PR.
- **Effects import only from `src/api.js`.** If an effect needs something
  that isn't exported, add it to `api.js` with a comment, in the same PR.
- **No new runtime dependencies.** MediaPipe from a CDN is the only one, and
  the app stays a folder you can serve as-is.
- **Keep it fast.** Everything shares one 16 ms frame. Don't allocate
  canvases or big arrays per frame; make them once with `makeScratch()`.
- **`npm test` must pass.** CI runs it on every pull request.

## Code style

Match the code around you:

- Modern JavaScript, ES modules, no build. 2-space indent, double quotes,
  semicolons.
- Constants in `UPPER_CASE` at the top of the file, each with a comment that
  says what it is in real units (seconds, palm lengths, metres).
- Comments explain *why*: the threshold that was measured, the obvious
  approach that didn't work. Not what the next line does.
- Small, focused pull requests. For anything visual, put a GIF or a
  screenshot in the description.

## Pull requests

1. Fork, then branch from `main`.
2. Make the change, and run `npm test`.
3. For effects, try it with real hands (and a real face, if it uses one).
4. Open the PR and fill in the checklist.

By contributing, you agree that your contribution is licensed under the
[MIT License](LICENSE).

## Conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
