# Mira.ai — Warrior II Prototype

A working, browser-based build of the loop from the spec:

**Camera → Pose landmarks → Joint-angle checks → Coaching → 4s wait → Recheck → Confirm or re-coach**

Everything runs **client-side** — pose detection (MediaPipe Pose Landmarker, WASM/GPU), the
angle math, the state machine, and the coaching voice (browser speech synthesis) all happen
in your browser, on your machine. The only network calls are the one-time loads of the
pose model and the MediaPipe runtime from a CDN; after that, the camera never leaves your
laptop. No backend, no build step.

## Run it

Browsers block camera access on a plain `file://` page, so serve the folder over `http://localhost`:

```bash
# from inside this folder — any static server works, pick one:
python3 -m http.server 8080
# or
npx serve .
```

Then open **http://localhost:8080** in Chrome or Edge (best WebGL/WASM support), allow
camera access, and step back so your whole body is in frame.

## Deploy to GitHub Pages

This is a static site (no backend, no build step), so GitHub Pages can serve it as-is.
Every asset reference in `index.html`/`js/`/`style.css` is a relative path, so it works
whether Pages serves the repo at the domain root or under a project subpath like
`https://<user>.github.io/mira.ai/`.

**Option A — GitHub Actions (already set up in this repo):**
Push to `main` and the workflow in `.github/workflows/pages.yml` publishes the site
automatically. One-time setup: in the repo, go to **Settings → Pages → Source** and
choose **GitHub Actions**. The next push (or a manual run from the **Actions** tab)
deploys it.

**Option B — Deploy from a branch (no Actions):**
**Settings → Pages → Source** → **Deploy from a branch** → pick `main` and `/ (root)` →
**Save**. GitHub publishes the same files without running any workflow.

Either way, camera access works fine — GitHub Pages serves everything over HTTPS, which
is required for `getUserMedia`. `.nojekyll` is included so GitHub doesn't run the site
through Jekyll first.

## Try it

1. Stand facing the camera, full body visible.
2. Move into Warrior II — front knee bent, back leg straight, arms out to the sides.
3. The app will call out the single most important correction first (e.g. front knee
   depth), wait 4 seconds for you to adjust, then silently recheck.
4. Once every check passes, the skeleton turns green and it tells you to hold.

Deliberately try it *wrong* a couple of ways (knee too straight, knee caving in, arms
drooping) to see each correction — good for the demo script.

## What's real vs. what's a placeholder

| Piece | Status |
|---|---|
| Pose detection, angle math, entry gate | Real — MediaPipe landmarks, live joint angles |
| Warrior II checks (knee angle, knee tracking, arms level, back leg) | Real, thresholds in `js/warriorTwo.js` |
| 4s wait / recheck state machine | Real, see `js/stateMachine.js` |
| Coaching voice | Browser `speechSynthesis` (built-in, zero setup). Swap for pre-recorded clips in `js/coaching.js` for a more polished demo voice |
| Reference pose image | Simple illustrative SVG (`assets/warrior2-reference.svg`) — swap for a real photo if you have one |
| LLM-phrased coaching | Stubbed out (`getCoachingLine()` in `js/coaching.js`), not wired up — optional stretch |

## Tuning

If corrections trigger too eagerly or not eagerly enough for your camera angle/body,
adjust the tolerance bands at the top of `js/warriorTwo.js` (`> 100` / `< 80` for the
knee angle, `0.15` for knee tracking, `0.12` for arm level, `165` for the back leg).

## On-device path (Qualcomm AI Hub)

This prototype and the eventual Snapdragon/iQOO build share the same model family
(BlazePose) and the same angle/state-machine logic — only the model *runtime* changes,
from MediaPipe's WASM/GPU delegate here to a Qualcomm AI Hub-compiled model running on
the Snapdragon NPU on-device. The checks in `warriorTwo.js` and the state machine in
`stateMachine.js` are written as plain functions over a landmark array, so they should
port with minimal change once the on-device runtime is producing the same 33-point
output shape.
