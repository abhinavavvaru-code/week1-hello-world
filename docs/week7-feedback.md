# Week 7: feedback implementation

## Main app

- Anonymous arrows explain “Sign in to vote” on hover/focus and take the reader to Google sign-in with an exact caption return link.
- Signed-in members can switch a rating or click the selected arrow to undo it. The database serializes changes and returns authoritative totals.
- Smaller image/caption cards put the rating controls at the top right of the text area. One-at-a-time mode offers previous/next and arrow-key voting when the card has focus. Keyboard shortcuts do not intercept form controls.
- Filters use compact dropdowns; voting tips have an explicit Close button.
- Three licensed real-photo presets are bundled alongside the historical illustrations. Existing captions retain their original images. See photo-credits.md.
- Tone, theme, point of view, and extra context have usable defaults. Blank extra context uses the selected photo, while upload publication/AI consent remains explicit. Archived presets are omitted from new creation.
- Actual generation calls record the chosen prompt chain, executed prompt and response, provider model, timing and returned token usage. Repeated request IDs recover the same generation rather than charging twice.

## Separate admin app

The admin repository adds date-aware statistics and daily charts; searchable users and individual ratings; prompt-chain and ordered-step inspection; editable weighted chain selection; catalog create/read/update/archive/restore for humor terms, AI examples, models, providers, signup domains and allowed emails; generation-request and actual response inspection; and image upload, metadata editing, archive and restore. Existing caption moderation remains available.

Every privileged route and RPC still requires a verified Google session plus the existing database admin flag. Catalogs contain no API keys or editable connection endpoints. Domain/email catalogs are managed configuration; editing them does not silently restrict current Google sign-ins. Archived images remain visible in existing captions and are unavailable for future generations.

## Validation

Production builds, TypeScript and lint are checked for both apps. Isolated behavior checks cover rating changes/undo, stale refreshes, retries, API authorization and byte limits, CRUD confirmation and validation, autocomplete, period controls, legacy null telemetry and active-photo selection. Database tests cover security, catalog boundaries, real runtime snapshots, archive behavior, and concurrent ratings, generation reservations, retry limits and uploads. Live deployment verification is recorded in the task handoff after migration and deployment.
