# HubD

Play the original **Diablo II** in a web browser, including Safari on iPhone,
using your own copy of the game.

HubD doesn't rewrite the game. It runs the real Windows `Game.exe` in
[Boxedwine](https://github.com/danoon2/Boxedwine), which emulates an x86 CPU
and runs Wine compiled to WebAssembly. HubD adds:

- a **launcher** where you pick a zip of your installed game. The zip is
  stored on your device in the browser's storage and is never uploaded;
- a **service worker** that hands that zip to Boxedwine, joins the Wine
  files back together and adds the headers the multi-threaded engine needs;
- **touch controls**: tap or hold for a left click, an **R** button for right
  click, and on-screen buttons for the keys Diablo II uses;
- a **GitHub Actions workflow** that builds Boxedwine and publishes everything
  to GitHub Pages.

> **Expect it to be slow.** Every x86 instruction is translated in the browser,
> and iPhones limit how much memory a web page can use. Menus and town should
> work, but busy fights may stutter, and a large install can make Safari reload
> the page. See [Making it run better](#making-it-run-better).

## Setup (one time)

1. **Make the repo public**, or use a GitHub plan that allows Pages on private
   repos. The repo holds no game files, so it's safe to make public.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run **Actions → Build and deploy → Run workflow**). The
   first build compiles Boxedwine twice and takes a while (roughly 30–60 minutes).
4. When it finishes, the site is at `https://<your-user>.github.io/<repo>/`.

## Preparing your game

1. Install Diablo II on a Windows PC. Version **1.14d** (the current installer
   from your Blizzard account) runs without the CD.
2. Zip the **contents of the install folder** (the folder with `Game.exe` and
   the `.mpq` files).
3. Optional, to save memory: leave out `d2video.mpq` / `d2xvideo.mpq`
   (cutscenes). Put them back if the game won't start without them.
4. Get the zip onto your iPhone (iCloud Drive, AirDrop to the Files app…).

## Playing on iPhone

1. You need **iOS 18.4 or newer**, because Boxedwine uses WebAssembly
   features older Safari lacks.
2. Open the site in **Safari** (not a private tab), tap **Choose zip…**, and
   pick your game zip. Saving a large zip takes a minute.
3. For full screen: **Share → Add to Home Screen**, then open HubD from the
   home screen and hold the phone sideways.
4. Tap **Play**. The first launch downloads Wine (about 170 MB) and sets it up;
   later launches reuse it.

| Control | Does |
| --- | --- |
| Tap / hold / drag | Left click: move, attack, pick up |
| **R** | Next touch is a right click. Double-tap to keep it on |
| ⌨ | Shows game keys: Alt, Shift (stay down until tapped again), Esc, Tab, Inv, Char, Skills, 1–4, F1–F4… |
| ☰ | Shows Boxedwine's controls and log, for troubleshooting |

## Making it run better

- Try both **Engine** options. Multi-threaded may run faster; single-threaded
  is the safer fallback.
- Use **640 × 480**.
- Turn **Sound** off.
- Keep the zip small (see above). The whole zip is loaded into memory.
- If the game starts but shows a black or garbled screen, try turning
  **GDI renderer** off.
- If it fails to start, open ☰ and read the log, or try it first in a desktop
  browser (Chrome or Firefox), where it's easier to debug.

## Repository layout

```
web/                      launcher + layer injected into Boxedwine's page
  index.html, launcher.*  game picker, settings, Play button
  sw.js                   service worker
  touch.js, touch.css     touch controls and full-screen layout for the game page
scripts/assemble-site.sh  combines Boxedwine builds, Wine and web/ into the site
.github/workflows/        build + deploy to GitHub Pages
```

The Boxedwine commit, Emscripten version and Wine filesystem are pinned in
`.github/workflows/deploy.yml`. To try a different Wine build, run the workflow
by hand and fill in `wine_url` (and `wine_sha256`).

## Legal

Diablo II is © Blizzard Entertainment. This project contains no Blizzard files.
Use your own legally owned copy, and **never commit game files (`*.mpq`,
`Game.exe`, …) to this repository**. `.gitignore` blocks the usual ones.
