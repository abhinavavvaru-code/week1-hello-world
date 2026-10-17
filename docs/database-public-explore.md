# Public Explore and generation fixes

Apply `supabase/migrations/202610170001_public_explore.sql` after the Assignment 5 migration. This phase changes the existing main app only; it does not create the separate administrator application or grant any administrator access. Existing caption text and ratings are preserved.

Anonymous visitors can read published captions and their published photos through narrow RPCs. Direct table access to captions, image metadata, profiles, prompts, and individual rating rows remains restricted. Voting, creating generations, uploads, and account changes still require a signed-in member. The `caption-uploads` bucket remains private; unpublished uploads remain owner-only.

## Public read contract

`get_caption_feed_v6()` returns all V5 feed fields plus `author_key`, a stable string `creator-<SHA-256 of author UUID>`. Creator filters should use this key so they work both before and after sign-in. `author_id` is null for anonymous callers and the original UUID for authenticated members, supporting the signed-in My Posts filter. Anonymous `my_vote` and `voted_at` are always null; members receive only their own vote. Display names remain first name and last initial, with `Member` as the fallback. Email addresses and generation prompts are omitted.

For uploaded photos, `storage_path` is the marker `uploaded` for every caller. The feed adapter can use its truthiness to build `/api/captions/<caption UUID>/image`; it should not treat the marker as an actual Storage path. Preset illustrations retain their existing local `image_src`.

`get_caption_image_v6(p_caption_id uuid)` returns a scalar Storage path only for an existing caption belonging to a succeeded generation. Missing, unpublished, and preset-only paths return null. The image proxy uses the caller's anonymous or authenticated Supabase client to download that exact file. Owner UUIDs remain present in the underlying uploaded-file path; these identifiers are not credentials. The public feed itself uses opaque creator keys and the upload marker.

The anonymous Storage policy permits a published object's authenticated-download operation, or an exact trusted GET method/path for that same object. The compatibility fallback supports Storage releases with an empty or legacy operation context while still denying listing paths and requests without a recognized download context. The additive `202610170003_public_media_signing.sql` also permits a single published-object signature; the image proxy can request a sixty-second URL and fetch its bytes on the server when the direct download path fails. Bulk signing and private-photo signing remain denied. It uses the documented [`storage.allow_any_operation`](https://supabase.com/docs/guides/storage/schema/helper-functions) helper. The migration stops if this helper is unavailable or if the existing upload bucket is not private. It does not install custom functions in Supabase's managed Storage schema. Projects that already applied the initial migration can apply `202610170002_public_media_download.sql` for the same narrow GET-path fallback. The trusted method/path fields are populated by [Supabase Storage's database request scope](https://github.com/supabase/storage/blob/master/src/internal/database/postgres/scope.ts). Existing member and avatar policies remain unchanged.

The public API functions are invoker wrappers. Their tightly scoped implementations remain in `punchline_private` with empty search paths. Anonymous roles gain schema usage and execution only on the new public-reading helpers; they gain no write RPC execution or access to the underlying private application tables. Do not add `punchline_private` to the Data API's exposed schemas.

## Short new captions

`complete_caption_generation_v6(p_generation_id uuid,p_captions text[])` returns the same three stored caption rows as V5. New pending format-5 completions now accept at most ten words, preserving the 140-character limit and three distinct captions. The V5 implementation is tightened as well so calling an older completion RPC cannot bypass the rule. The Unicode whitespace handling continues to match JavaScript's word counter. Completed older captions remain unchanged and their idempotent retries return the saved results, including previously valid twelve-word captions. Existing format-4 historical behavior is retained.

## Retry-aware allowance

The five-generation New York daily allowance counts succeeded generations and active pending reservations. Failed requests refund their slot. Pending reservations older than two minutes are excluded from the displayed allowance immediately and are marked failed by the next reservation transaction. Owner status polling can also invoke the existing failure RPC for expired work; it cannot change a completed generation.

A separate cost guard permits at most twenty failures per member per New York day. Pending calls reserve a potential failure slot, so concurrent retries cannot race beyond this cap. Exceeding it returns SQLSTATE `P0001`, message `GENERATION_ATTEMPT_LIMIT_REACHED`; the API should distinguish this from `GENERATION_LIMIT_REACHED`. `get_generation_allowance()` continues to report only the five-success allowance, so it can return a positive number even when the separate failure cap has been reached. Existing request IDs remain idempotent: retrying a failed ID returns that failed record without a second provider request; a fresh attempt needs a new ID.

## Verification

Use `supabase/verification_public_explore.sql` for read-only live checks. The transaction-based `supabase/tests/public_explore_security.sql` tests anonymous and member access, public versus unpublished photos, denied listings and raw table reads, caller-only votes, stable creator keys, legacy text preservation, ten-word enforcement, refunded failures, expiry, and the separate failure cap. Its fixtures roll back.

`supabase/tests/concurrent_reservations.py` still checks the five-active-request bound. `supabase/tests/concurrent_retry_quota_v6.py` checks twelve simultaneous retries after nineteen failures, requiring exactly one acceptance. These scripts target an isolated local Postgres container. The Storage operation helper is represented by a documented-behavior stub in local tests; after applying the migration, verify one real anonymous image download and one denied anonymous bucket listing through the live Supabase API. Older versioned SQL suites contain the previous twelve-word and all-attempt quota expectations and should run against their corresponding pre-V6 migration stage.
