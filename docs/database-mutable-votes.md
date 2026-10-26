# Mutable caption ratings

Apply `supabase/migrations/202610260001_mutable_votes.sql` after administrator migration `202610170004_admin_console.sql`. It preserves existing votes and adds server-owned `updated_at`, initially equal to `created_at`.

Authenticated members call `set_caption_vote_v7(p_caption_id uuid,p_value integer)` with -1, 1, or 0 to undo. It returns `{caption_id,value,laughs,groans,created_at,updated_at}`. Undo has null timestamps. Repeating the same rating is idempotent; a change preserves the initial creation time and advances the update time. A caption-row lock serializes changes, count calculation and moderator deletion. Hidden, nonexistent or non-succeeded captions return P0002; invalid/null values return 22023; anonymous access is denied.

Only the current user's unique rating can change. Raw UPDATE/DELETE remain ungranted, and private vote reads remain owner-only. The old deployed client's three-column INSERT `(caption_id,user_id,value)` is preserved for rollout compatibility, protected by owner RLS, a published-caption lock and server defaults. It cannot provide IDs or timestamps, impersonate another member, or rate a hidden caption. No client can write another user's vote.

All versioned feeds retain their existing shapes. `voted_at`, week/month upvotes, and admin rating activity now use the latest update time. Metrics count current ratings; undo removes a rating rather than creating an immutable activity event.

Local-only verification: `supabase/tests/mutable_votes_security.sql` rolls back fixtures and covers change/undo/counts/owner isolation, legacy INSERT, protected timestamps, invalid values and moderated captions. `concurrent_votes_v7.py CONTAINER` verifies concurrent same-user changes and undo cannot duplicate ratings or alter another user's vote. Existing public Explore privacy checks remain applicable.
