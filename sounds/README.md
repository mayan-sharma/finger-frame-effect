# Your own sounds

Every sound in the app is synthesized, so the repository ships no audio. You
can swap in your own recordings, on your machine only:

1. Put the files in this folder (`.mp3`, `.wav`, `.ogg` or `.m4a`). Git ignores
   audio files here, so they never get committed.
2. List them in `sounds.json`, by sound name:

   ```json
   {
     "ryoiki-tenkai": "ryoiki-tenkai.mp3",
     "muryo-kusho": "muryo-kusho.mp3",
     "bang": "my-gunshot.wav"
   }
   ```

3. Reload. The first click or key press loads them.

To keep your edits to `sounds.json` out of commits for good:

```sh
git update-index --skip-worktree sounds/sounds.json
```

Any name from the Sound section of `src/api.js` can be replaced (`bang`,
`snikt`, `gong`, ...). Some effects also play lines that only exist as
recordings, and are silent without one:

| Name | Effect | When |
| ---- | ------ | ---- |
| `ryoiki-tenkai` | Infinite Void | as the domain opens (領域展開) |
| `muryo-kusho` | Infinite Void | with its title card, 1.5 s later (無量空処) |

Only use recordings you have the rights to, and don't commit them: please
don't add copyrighted clips to the repository.
