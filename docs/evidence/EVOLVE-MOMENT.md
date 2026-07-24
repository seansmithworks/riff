# The evolve moment — captured evidence

Recorded 2026-07-24 against the deployed production build at https://riff-navy.vercel.app.
Raw artifacts: `artifact-before.json`, `artifact-after.json`.

This is the behavior Riff exists to demonstrate: an artifact that is **edited**, not regenerated.

## What was said

**First brief:**
> "A mobile app for booking a dog walker. Browse walkers nearby, view a walker profile, and confirm a booking."

**Then, 12.8 seconds later, one follow-up sentence:**
> "Add a screen where they pick a time slot and pay."

## What happened

```
BEFORE — 3 screens                  AFTER — 4 screens
──────────────────────────          ──────────────────────────────────────────
Browse Walkers                      Browse Walkers                  ← unchanged
Walker Profile                      Walker Profile                  ← unchanged
Confirm Booking                     Booking Details                 ← RENAMED
  button: "Confirm Booking"           button: "Choose Time Slot & Pay"  ← RELABELED
                                    Select Time Slot & Pay          ← INSERTED
                                      button: "Pay & Confirm Booking"
```

Three things happened that nobody asked for:

1. **The first two screens survived untouched.** Not regenerated with slight variations — preserved. To a designer, a screen that shifts when you weren't looking at it reads as broken.
2. **The new screen went in at the right point in the flow**, between the profile and the confirmation, not appended to the end.
3. **A screen that wasn't mentioned rewrote itself.** "Confirm Booking" became "Booking Details," and its button changed from *"Confirm Booking"* to *"Choose Time Slot & Pay"* — because that screen is no longer the last step. Its role in the flow changed, so its copy changed.

That third one is the whole argument. A generator produces a new artifact. A collaborator reasons about what the change means for everything around it.

## Timing

- Initial generation: **12.8s** (3 screens)
- Evolve: **35.1s** (uncapped — the evolve prompt deliberately has no screen limit, unlike initial generation which is pinned to exactly 3)

The wait is real and was designed around rather than hidden: `render_artifact` is fire-and-forget, so the conversation keeps running while the canvas fills in out of band.

## Why this was hard

The default behavior of any model handed an artifact plus a change request is to return a fresh, slightly different artifact. Getting existing screens to survive a revision byte-identical took several passes at both the prompt and the schema. The single decision that made it work: when an artifact already exists, it goes back into the request with instructions to **edit** it, not to regenerate from the brief.
