# Assignment 4 database contract

Apply `supabase/migrations/202610050001_assignment4.sql` as the project owner in the Supabase SQL Editor. It runs in a transaction and preserves the Assignment 3 data. It deliberately stops if another public application table or another Storage bucket exists, so its permissions can be reviewed before continuing. The app must be deployed together with this schema.

The database stores the exact user prompt and system prompt sent to DeepSeek, the image relation, model, style, request ID, and generation state. Each successful generation publishes three caption rows atomically. Only its owner can read a generation's prompts. Signed-in members can read published captions, image descriptions, aggregate scores, and their own rating. No other member's identity or individual rating is returned by the feed.

`caption_votes` accepts one new row per member and caption, with `value` equal to `1` or `-1`. A unique constraint prevents repeated ratings, while grants and RLS prevent editing, deleting, or forging somebody else's rating. Only `caption_id`, `user_id`, and `value` can be inserted; the database supplies the ID and timestamp. The UI should lock a submitted rating and offer the next caption. Existing `votes` rows are retained and readable only by their owner; members can no longer insert, update, or delete legacy votes. New caption ratings use `caption_votes` only.

All seven public application tables have RLS enabled. Anonymous users have no table grants or RPC access. Profiles and legacy votes are private to their owner; legacy messages and illustrations are readable by authenticated members. Profile inserts and updates permit only `id`, `first_name`, `last_name`, and `avatar_url`, preserving normal upserts while preventing changes to creation timestamps. RLS prevents changing the profile's owner. All generation and caption mutations run through narrowly scoped RPCs. The privileged implementations use an empty search path and remain in `punchline_private`, outside the API's exposed schema; public functions are invoker wrappers. Do not add `punchline_private` to Supabase's exposed schemas.

The existing public `avatars` bucket preserves the profile photo URLs used by Assignment 3. Storage listing, upload, update, and deletion require the member's own ID as the first path folder. Photos addressed by an existing public URL remain public by design; prompts and generated-caption metadata do not.

## RPC signatures

`reserve_caption_generation(p_request_id uuid, p_image_id text, p_prompt text, p_style text, p_system_prompt text, p_model text)` returns an array containing exactly one reservation. The fields are `id`, `user_id`, `image_id`, `prompt`, `system_prompt`, `style`, `provider`, `model`, `request_id`, `status`, `created_at`, `completed_at`, and `is_new`. Only `is_new = true` should trigger an AI call. A retry returns the existing reservation, including when the daily quota has been reached; reuse with different input fails.

The reservation serializes concurrent requests for each user with a transaction advisory lock. Five attempts per New York calendar day are allowed. Successful, failed, and pending attempts count, protecting the API key from repeated failures and concurrent requests. A retry of a pending reservation older than two minutes marks it failed and returns `is_new = false`; it never calls the provider twice for the same request ID. A failed attempt requires a fresh request ID. Input validation permits 1–500 trimmed user-prompt characters, 1–8000 system-prompt characters, and styles `dry`, `chaotic`, or `wholesome`.

`complete_caption_generation(p_generation_id uuid, p_captions text[])` returns the three stored caption rows (`id`, `generation_id`, `content`, `position`, `created_at`). A pending reservation requires three captions distinct without regard to case, of 5–220 trimmed characters. An already completed reservation returns its existing rows, so a retry cannot duplicate results. Another user's generation is rejected.

`fail_caption_generation(p_generation_id uuid)` returns void. It marks only the caller's pending reservation failed; completed generations remain intact.

`get_caption_feed()` returns `id`, `content`, `image_id`, `created_at`, `style`, `laughs`, `groans`, `my_vote`, and `voted_at`. `my_vote` and `voted_at` are null until this caller rates the caption. Scores count all ratings without exposing the underlying user IDs. Results include every published caption, newest generation first and then each generation's three options in order.

`get_generation_allowance()` returns an integer from 0 to 5 for the caller's remaining attempts on the current New York calendar day. It uses the same boundaries as reservation, without downloading private prompts or relying on the browser's time zone.

Errors use SQLSTATE `42501` for unauthenticated access, `22023` for invalid inputs or request-ID reuse, and `P0001` with messages `GENERATION_LIMIT_REACHED`, `GENERATION_NOT_FOUND`, or `GENERATION_NOT_PENDING` for the corresponding state.

## Verification

Run `supabase/verification.sql` in the SQL Editor for read-only policy and integrity checks. `supabase/tests/assignment4_security.sql` exercises anonymous access, two member identities, prompt privacy, spoofed votes, insert-only ratings, idempotent retries, and the daily quota. It runs fixture operations in a transaction and rolls them back; use a local or staging database to avoid external auth-trigger side effects. Testing does not prove that production OAuth or the external DeepSeek request succeeds; verify those through the deployed app after configuration.
