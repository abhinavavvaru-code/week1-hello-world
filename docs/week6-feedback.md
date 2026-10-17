# Week 6 feedback iteration

Explore is public at `/` and `/explore`; creation, personal pages, and votes require Google sign-in. Published photos are served as JPEG bytes through a narrow caption lookup. The private upload bucket, unpublished photos, prompts, and personal votes remain protected. A 60-second server-side signed fetch handles Storage versions that deny direct anonymous downloads; browser clients never receive its token.

The gallery has a visible humor-flavor dropdown with legacy-style support, clearer personal unrated counts, larger image cards, compact accessible vote controls, and a temporary saved toast. Signing in returns to the clicked caption. Captions appear below their images; optional sharing controls are collapsed.

Create exposes photo upload, accepts a blank optional image description, and distinguishes descriptions from joke context. “Use this scene in my prompt” fills and focuses the prompt box. Generation continues in the shared bottom-right status widget while browsing and resumes status checks after refresh without a second AI call. Server errors distinguish provider setup, credits, busy responses, timeouts, and unusable output. New captions contain at most ten words. Failed attempts return the successful-generation allowance while a separate attempt cap controls repeated calls. Uploaded images receive a suitability check before caption generation.

The separate Week 6 admin application adds Google-plus-database-role authorization and recoverable media moderation; its migration also updates all public and legacy feeds to honor removal.
