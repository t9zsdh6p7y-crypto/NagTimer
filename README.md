# Nag v1

A small installable web app for planning a week's practice, checking in daily, and getting firm nudges when a session starts or you fall behind. The built-in coach is **Reed** — warm but firm.

v1 is a solo foundation. There are no accounts, no social features, and no gamification.

## What it does

1. **Setup, two ways**
   - *Talk with Reed*: a guided conversation (type, or speak where the browser supports it) that fills the same plan as the form.
   - *Manual form*: type/tap everything. The app works fully without voice or any AI service.
2. **Activity + week plan.** Name an activity (for example, piano lessons), set a weekly time total, number of sessions, days, and start times. Session length is derived from weekly total ÷ sessions, or set by you (the app warns if they don't line up). Script or edit the current week.
3. **Daily check-in.** At a time you choose, Nag asks whether today's session happened and how many minutes, and counts it toward the weekly total.
4. **Timer.** Start / pause / stop against today's session. Progress shows time remaining or over, plus the week total.
5. **Nudges.** Gentle / Moderate (default) / Strict. Intensity changes reminder frequency, how repeats escalate, how many snoozes you get, and the wording. Nudges fire when a session starts and when you are behind. A full-screen overlay, optional sound and vibration, and browser notifications (while the app or its service worker is active).

Reed is rule-based in this version. A live model can be plugged in later through a `CoachEngine` interface; v1 includes a stub and **does not call any API or ship any keys**.

## Run it locally

The app is static files. Serve the project folder over HTTP (opening `index.html` as a file will not register the service worker reliably).

```bash
cd nag-timer
python3 -m http.server 8080 --bind 0.0.0.0
```

Then open http://127.0.0.1:8080/

From this repo you can also run `npm test` (logic tests) and `npm run test:e2e` (headless Chrome). E2E needs Chrome and the `ws` dev dependency (`npm install`).

## Public access

A temporary public tunnel (Cloudflare quick tunnel, localtunnel, SSH reverse tunnels) was attempted from the build machine so you could open the app on a phone without a hosting account. Those tunnels could not stay connected from this environment (the protocols they need are blocked). **There is no working public URL right now.**

To put it on the internet without leaving files on this machine:

- Unzip `nag-timer-v1.zip` and serve the `nag-timer` folder on any static host (GitHub Pages, Cloudflare Pages, Netlify, Surge). Those need *your* account; this project does not sign up for you.
- Or run it on your computer as shown above, then open the same Wi-Fi URL on your phone (`http://YOUR-LAN-IP:8080/`).

## Install on a phone

1. Open the app URL in the phone's browser (Safari on iPhone, Chrome on Android).
2. Add to Home Screen:
   - **iPhone / iPad (Safari):** Share → Add to Home Screen.
   - **Android (Chrome):** menu → Install app, or Add to Home screen.
3. Open it from the home screen icon (standalone display).

Allow notifications if you want system banners. On iOS, notifications for a home-screen web app are limited, and **neither iOS nor Android will nag you after the app is fully closed** until a later version adds a push server.

## Voice

- If the browser supports Speech Recognition, a **Speak** button appears in Reed's chat.
- If it only supports speech synthesis, Reed can still speak replies (toggle in Settings).
- If neither is available, voice controls are hidden. You can type to Reed or use the manual form.

Chrome and Edge on desktop, and Chrome on Android, usually support both. Safari is more limited (especially recognition). Permission for the microphone is required for Speak.

## Data

Everything is stored in this browser (`localStorage`). Settings → Export JSON to back it up, or Clear all data to reset the plan. Clearing the plan keeps a hidden stable user id so a later friend layer can still recognize this install.

## Honest limitations

- **No web push server in v1.** Reminders can run while the tab or installed app (and its service worker) is active. If you swipe the app away or the phone sleeps the page, nudges will not fire. That needs a push service in a later build.
- Voice depends on the browser. There is no cloud speech or LLM in v1.
- One activity at a time, one typical session per chosen weekday.
- No calendar sync, no accounts, no social features in this version.

## What's next

- Permanent hosting (this zip can go on any static host; a signed-in Cloudflare Pages / Netlify / GitHub Pages account is enough).
- A push server so nags work when the app is closed.
- Optional live coach backend behind the existing `CoachEngine` (v1's `LlmCoachStub` is the seam).
- Themes: all colors and fonts already live in `css/theme.css` as CSS custom properties.
- **Social layer (not in v1):** see below.

### Next build: social layer

Do not ship this until the solo app is in use. The client is already prepared with:

- a stable generated **user id** per install
- a timestamped **progress history** (daily and weekly snapshots per activity, with change-over-time helpers)
- a **nudge-source** interface (`ExternalNudgeSource.ingest`) so a remote “friend nag” uses the same overlay, sound, and wording path as a local reminder

A later social build would need:

1. **Backend.** A small API (not more static files) to hold user records, the friend graph, invite tokens, a nudge relay, and opt-in shared progress snapshots. The local history already matches the shape you'd share: period, date/week, activity id, logged minutes, target, timestamp.
2. **Auth and invites.** Claim the existing local user id on first sign-in (magic link or Sign in with Apple/Google). Friends only via invite link or code — no search directory, no public profiles. Accepting an invite creates a bidirectional friendship.
3. **Push.** VAPID web push (and APNs if you wrap a native shell later) so a friend tapping “Nag” can reach you when the app is closed, and so the existing session/behind nudges survive a killed app. The service worker already displays notifications when it is awake.
4. **Client UI (only after the API exists).** Invite a friend; a Nag button that posts to the relay and lands on `ingest()`; a simple per-friend view of their shared weekly/daily totals and change over time. No feeds, comments, or public profiles.

## Project layout

```
css/theme.css          Design tokens only (swap or add a theme later)
css/app.css            Layout; uses tokens, not raw palettes
js/plan.js             Week scripting and validation
js/checkin.js          Daily check-in and weekly totals
js/timer.js            Start / pause / stop math
js/nags.js             Intensity, timing, when to nag
js/nudge-sources.js    Local + external (friend) nudge seam
js/identity.js         Stable local user id
js/history.js          Day/week progress snapshots
js/coach/              Reed's copy, rule-based dialogue, LLM stub, speech
```
