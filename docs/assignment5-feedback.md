# Week 5: feedback implementation

Punchline keeps a short flow: Google sign-in → community gallery or create a post → generate three captions → rate, copy, or download a meme. No mandatory profile setup.

| Feedback | Implementation |
| --- | --- |
| Upload personal pictures and create memes | JPEG/PNG/WebP photo picker, preview, local resizing, private Storage, real photo understanding, and downloadable PNG meme cards |
| Improve the AI; make jokes shorter and more specific | Existing DeepSeek Flash now receives the actual photo, a chosen topic and perspective, and a rewritten prompt for three distinct 8–10-word punchlines; outputs are limited to 12 words and 140 characters |
| Different joke types and customization | Dry, chaotic, wholesome, wordplay, and playful roast; seven themes; five perspectives |
| Recognize food and relate the joke to it | Food & coffee theme plus photo-grounding instructions that avoid invented ingredients |
| Prominent upvote and downvote controls | Both labeled buttons show counts; net score, saving state, saved verdict, and error recovery are visible |
| A global list with every generated caption | Community gallery retains all historical captions; each card carries its own image; load-more displays the full collection |
| See my own posts across pictures | Dedicated My posts page and Mine filter |
| Show who posted and find someone's posts | First name and last initial attribution, clickable creator, creator filter, and name/caption/theme search; emails and prompts remain private |
| Weekly, monthly, and all-time most-upvoted captions | Rankings use vote timestamps in New York time; weekly periods run Monday–Sunday and monthly periods use calendar months |
| Separate creation from browsing | Create page stays separate; home offers Browse gallery and Create a post |
| Select more than one caption | Cross-picture selection, copy selected, download selected text; individual PNG export |
| Better sign-in design; skip profile creation | Illustrated sign-in screen, Google login, automatic identity; existing optional profile remains |
| Reasons to return | Rotating campus/NYC brief, fresh community posts, rankings, and a personal collection to reuse in group chats |

The group mentions Gemini in feedback to several projects. This app uses the user's existing DeepSeek key; native photo input and short-caption generation are implemented without requiring another provider key. No model fine-tuning or fake generated results are used.

The earlier assignment's authenticated insert-only vote behavior remains: one persisted verdict per caption. Prompts remain private, uploaded images are shared with signed-in members after publication, and database RLS stays enabled.
