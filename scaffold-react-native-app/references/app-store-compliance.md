# Store submission readiness

> Last reviewed: 2026-10-02. The specific requirement names and API
> categories below were correct at that time. Confirm each one against
> Apple's and Google's current developer documentation before relying on it;
> this file is a starting point, per operating principle 1 in `SKILL.md`, not
> a substitute for checking.

Neither platform will accept a build that is missing these, and both are easy
to forget because nothing in the development loop (lint, test, bundle) checks
for them. Treat this as a documentation checklist from the first commit, kept
up to date as capabilities are added, not a one-off task before submission.

## iOS

- **Privacy manifest (`PrivacyInfo.xcprivacy`).** Required once the app, or
  any SDK it depends on, uses a "required reason" API (for example file
  timestamp APIs, user defaults, or disk space APIs). Confirm the current
  list of required-reason API categories in Apple's documentation, since it
  has grown over time, and declare the accurate reason code for each one
  used, not the first one that compiles.
- **Usage description strings in `Info.plist`** (or, on the Expo path, the
  app config's `ios.infoPlist`). Every permission the app requests (camera,
  photo library, location, microphone, contacts, and so on) needs a human
  readable `NSXxxUsageDescription` string that explains why, in terms a
  reviewer and a user will both accept. A generic string ("we need this for a
  better experience") is a common rejection reason.
- **App Tracking Transparency**, if the app does any cross-app or cross-site
  tracking as Apple defines it. This is a legal and policy question, not only
  a technical one; flag it as an open question to the user rather than
  guessing whether their analytics setup counts.

## Android

- **Permission declarations in `AndroidManifest.xml`** (or, on the Expo path,
  the app config's `android.permissions`), limited to what the app actually
  uses. An unused permission is both a store review flag and a needless
  privacy surface.
- **Data Safety section**, filled in on the Play Console, describing what
  data is collected, why, and whether it is shared. This lives outside the
  repository, on the store listing itself, but the entity model and the data
  sources identified during intake (`intake.md`) are exactly what answers it,
  so record them in `docs/compliance/app-store.md` as the source of truth for
  whoever fills in the console form.

## What to produce

A `docs/compliance/app-store.md` file containing, for each platform, the
current list of capabilities the app uses that trigger one of the above, the
exact string or declaration used for each, and an explicit "not yet
applicable" note for anything the app does not currently do. Update it in the
same pull request that adds a capability which triggers a new entry, the same
discipline already required of the tooling baseline in `tooling.md`.

This file does not replace reading Apple's and Google's current policies
before a real submission. It exists so the question has an honest answer on
day one, rather than being discovered for the first time during review.
