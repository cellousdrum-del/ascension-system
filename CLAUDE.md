# Ascension System

A gamified workout/habit tracker inspired by *Solo Leveling*: you are a "Hunter", every workout is a "Gate", and XP, levels, ranks (E → S), stats and streaks reward showing up every day. It is an installable PWA backed by Firebase (Auth + Firestore + Hosting). Live at https://solo-leveling-fdd0f.web.app. It was built for one person and a handful of friends and family, so it favours simplicity and the free tier over scale.

If you are here to build a **new, separate app** from this one, read "Building your own app from this" at the bottom first.

## Contents

1. Files
2. Architecture
3. Game systems
4. Rules to keep in mind when editing
5. Checking and deploying changes
6. Admin-only flags
7. Building your own app from this

## 1. Files

| File | What it is |
|---|---|
| `index.html` | **The entire app**: HTML, CSS and JS in one file (~4,500 lines). No build step, no framework, no npm. |
| `firestore.rules` | Firestore security rules (a copy of what is deployed). |
| `firebase.json`, `.firebaserc` | Firebase Hosting config and project id. `index.html` is served with `Cache-Control: no-cache` (without it, users see a stale app for about an hour after each deploy). |
| `sw.js`, `manifest.json`, `icon-*.png`, `apple-touch-icon.png` | PWA: network-first service worker with an offline fallback, plus the install manifest and icons. |
| `.github/workflows/` | Deploys to Firebase Hosting (needs a `FIREBASE_SERVICE_ACCOUNT` secret) and to GitHub Pages on every push to `main`. |
| `backups/` | Dated full copies of `index.html` taken before each change. History only; not deployed. |

## 2. Architecture

`index.html` has two scripts.

1. **A module script** imports the Firebase SDK from the gstatic CDN, initializes Auth and Firestore, and exposes everything on `window.fb`. Firestore uses `persistentLocalCache` with a multi-tab manager, so the app works offline and syncs later.
2. **A classic script** holds all app logic, written as plain global functions and constants.

Core flow:

- **State.** One global object `S` holds everything for the logged-in user: xp, stats, streak, today's checkmarks, history, routines and so on.
- **Storage.** `S` is stored as one Firestore doc, `users/{uid}`. `save()` debounces `pushCloud()`, which `setDoc`s the whole of `S`. No other per-user storage exists.
- **Login.** `onAuthReady(user)` loads that doc into `S`. `S === null` means the user hasn't done onboarding yet, so `renderOnboarding()` / `startGame()` builds the first `S`. Accounts created after `EMAIL_VERIFICATION_CUTOFF_MS` must verify their email first, unless the doc has `emailGateExempt: true`.
- **Rendering.** `render()` rebuilds `app.innerHTML` from `S` in one big template literal, switched by `currentTab` (`home`, `progress`, `routine`, `social`, `avatar`, `account`). Every user action follows the same pattern: mutate `S` → `save()` → `render()`. Escape any user text with `esc()`.
- **Migrations.** The top of `render()` fills defaults for fields added later (`if(S.x===undefined) S.x = ...`). New fields need a default there, in `startGame()`'s initial object and, if per-day, in the day-rollover reset.
- **Day rollover.** It also lives in `render()`: `if(S.day !== today())`. It judges whether yesterday was "active", advances the rotation, applies streak breaks and penalties, and resets the per-day fields.

Collections: `users` (publicly readable, which powers the leaderboard and friend lookup), `messages` (global chat), `dmMessages`, `friendRequests`, and `contactEmails` (real emails, admin-only, kept out of the public `users` doc).

## 3. Game systems

### Levels and ranks
- `levelFromXp()` turns XP into a level, with `xpNeeded(lvl) = 180 + (lvl-1)*15`, up to a maximum of 100.
- `RANKS` maps level to rank: E <15, D <30, C <50, B <70, A <90, S ≥90.
- The rank drives colors (`RANK_COLORS` / `RANK_RGB`, `.rank-x` CSS classes) and the content tier, via `gateTierIndex(level)`.

### Gates (the workout)
- The day comes from `CYCLE = push,pull,legs,push,pull,legs,rest` and `S.cycleIndex`.
- Each gate in `GATES` has six `tiers`, one per rank, each a list of exercises `{n: name, t: '4x8-12', d: description}`. The leading `Nx` is the number of sets you check off.
- Variants: `dumbbellTiers` (the "Dumbbells Today" toggle) and `wandererTiers` (the "Wanderer Mode" toggle). `WARMUPS` holds the warm-ups.
- Close to a rank boundary, a deterministic hash sometimes serves the next tier as a **Trial Gate** (`isTrialToday`), worth +20 XP.
- Clearing a gate (`completeGate`) is worth +100 XP. A "half-complete" option (`completeGateHalf`) gives half, and finishing later tops up to exactly the full amount.
- Tapping a day chip switches today's gate (`switchGate`) until a gate is cleared.

### Custom routines
Users can replace PPL with up to 5 routines of up to 6 custom days. Each routine has a mandatory rest day every `restCycle` training days. See the "Custom routine editor" section.

### Daily Quest
- A grip task plus a rotating mystery task (`MYSTERY_QUESTS`), each claimed separately (`claimDailyPart`) for +15 XP. Both together count as an "active" day.
- One account (`isGripGateUser()`, username `txetxe`) gets a rank-tiered **Grip Gate** (`GRIP_GATE_TIERS`) in its own section instead of the flat grip checkbox.

### Other daily items
- **Flexibility:** `FLEXIBILITY_TIERS`, +20 XP, no stat attached.
- **Weight log:** +10 XP.

### Stats
STR/VIT/END/AGI rise by 4 points per claim, split by `statSplitShape(seed)`. The split is deterministic and weighted towards the lowest stat.

### Streaks
- A day counts if the Gate is cleared, the Daily Quest is fully claimed, or a rest day is confirmed.
- Up to 3 quest-only days in a row are tolerated; after that a "monster" warning says only a Gate saves the streak.
- Missing a day breaks the streak and applies a penalty (`applyStreakPenalty`) plus a "Weakened" day: half XP and doubled grip reps. Backfilling past days can undo a break.
- **The log.** Days can be backfilled (`logPastWorkout`), and manually logged days can be deleted (`deleteHistoryEntry`). Deleting reverts the exact XP and stats the entry recorded and removes that day's weigh-in. If the day was inside the current streak, the streak shortens to the days after it, and the day becomes a pending break gap, so re-logging it restores the streak. Days recorded live can't be deleted, because they don't store their stat gains.
- Streak milestones drop mystery boxes holding avatar cosmetics (`AVATAR_ITEMS`, `grantBoxIfEarned`). Titles (`TITLES`) change every 10 levels.

### Social
Friends (requests), DMs, global chat and a leaderboard.

### Admin
Admin is set by `isAdmin: true` on the user doc. Admins can ban users and open anyone's account read-only ("dive in", `viewOnly`). On admin login, re-engagement emails go to users inactive for 2 or 5 days, through EmailJS's free tier (`EMAILJS_*` constants).

## 4. Rules to keep in mind when editing

- **No `Math.random()` for content or rewards.** Anything that must look the same on every device (mystery quest order, stat splits, trial days) is hashed from the date and the user. Random is only used for ids.
- **Exercise checkmarks are index-based** (`S.exSets[i]`). If an action changes today's exercise list (toggles, switching gates, editing a custom day), reset `S.exSets = {}`, or the checkmarks land on the wrong exercises.
- **Merge history, don't overwrite it.** Several actions on the same day write to `S.history[S.day]`, so always merge: `Object.assign({}, S.history[S.day], {...})`.
- **Split rewards via the stored total.** Anything claimed in parts (half-gate, the two daily-quest halves) freezes the full amount on the first claim. The second claim pays the exact remainder, so rounding never gives 29 or 31.
- **Streak checks must agree.** `bumpStreak()` (the live counter) and the rollover's "was the day active" check must use the same rule. If they disagree, the counter goes up today and the streak silently breaks tomorrow.
- **`users/{uid}` is public.** Never put private data (emails, notes) in `S`.

## 5. Checking and deploying changes

There is no build and no test suite. The usual loop:

1. **Back up first.** `git show HEAD:index.html > backups/index.backup-YYYY-MM-DD-what.html`
2. **Syntax check.** Extract each classic `<script>` and run it through `new Function(src)` in Node.
3. **Preview.** `firebase hosting:channel:deploy test-x --expires 1h` gives a temporary URL against the real backend. Test there.
4. **Test accounts.** If you create one, delete both its Firestore doc and its Auth user afterwards. New accounts hit the email-verification screen, and the client can't set `emailGateExempt` on itself, so set that flag with project-owner credentials (Firebase console or the Firestore REST API).
5. **Release.** `firebase deploy --only hosting`, then commit and push. Deploy rules separately with `firebase deploy --only firestore:rules`.

iOS home-screen PWAs can resume without reloading, which is why the app has a manual refresh button.

## 6. Admin-only flags

`isAdmin`, `banned` and `emailGateExempt` live on the user's own doc, but `firestore.rules` stops the owner from granting or changing them (`keepsPrivilegedFlags()`). The rules compare values with a `false` default rather than changed keys, because the client always saves the whole of `S`. Only an admin, or the Firebase console, can set them.

Two client pieces keep this working:

- **The sync watcher.** `startSyncWatcher()` copies those three flags from the server into `S`, so a ban or console change made while the app is open doesn't make that tab's next save fail.
- **Backup restore.** Restoring a backup keeps the account's current flags rather than the file's.

If you add another admin-only field, add it to all three places: the rules, the sync watcher and the restore.

## 7. Building your own app from this

This repo is meant as a **reference and starting point**. It is not a template to deploy as-is. Its Firebase keys point at the original owner's project, so an unmodified copy would read and write their users' data. Before anything else, set up separate infrastructure:

1. **Create your own Firebase project** (free Spark plan is enough):
   - Authentication → enable **Email/Password**.
   - Create a **Firestore** database.
   - Add a **Web app** and copy its config.
2. **Copy the code** (fork or download) into a new repo, and delete `backups/`.
3. **Point everything at your project:**
   - In `index.html`, replace `firebaseConfig`, set `ASCENSION_URL`, and swap the `EMAILJS_*` values for your own (or delete the inactivity-email feature).
   - In `.firebaserc` and `.github/workflows/firebase-hosting-deploy.yml`, change `solo-leveling-fdd0f` to your project id.
   - Delete `deploy-pages.yml` if you don't want a GitHub Pages copy.
4. **Remove owner-specific bits.**
   - The `txetxe` Grip Gate: `isGripGateUser`, `GRIP_GATE_TIERS` and the "Quest - Grip Gate" section in `render()`.
   - The workout content in `GATES`, `WARMUPS`, `MYSTERY_QUESTS` and `FLEXIBILITY_TIERS`. This is the owner's personal training plan, so rewrite it for your own sport.
5. **Deploy** the rules and the app:
   - Install the CLI and log in: `npm i -g firebase-tools`, then `firebase login`.
   - Run `firebase deploy --only firestore:rules,hosting`.
6. **Make yourself admin.** Sign up in your app, then in the Firebase console set `isAdmin: true` on your own `users/{uid}` doc.
7. **Rename and rebrand.** `<title>`, `manifest.json`, the icons, and the copy and theme in the CSS `:root` variables.

### Advice for adapting it

- **Decide what to keep.** The core loop (daily workout → XP → level/rank → streak) is the part worth reusing. Social, admin, avatar and custom routines are optional layers; dropping them makes the file far easier to work with.
- **One file is fine at this size.** If the app grows much beyond this one, splitting it into modules with a small build step (e.g. Vite) is reasonable.
- **Change one thing at a time** and test it in the browser before moving on. Most bugs in this app came from rewards and the streak getting out of sync, so test both claim orders and the next-day rollover whenever a reward or streak rule changes.
