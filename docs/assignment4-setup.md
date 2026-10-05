# Assignment 4: Caption Lab

Signed-in members choose an illustration, add a scene, and generate three original AI captions using DeepSeek. The scene and exact system prompt are stored privately with the model, style, image ID, and generation state. Generated captions appear in the members' feed and can each receive one upvote or downvote. Each rating inserts a new `caption_votes` row; the database blocks duplicate votes and votes attributed to another user.

The daily campus/NYC brief changes at midnight in New York. Members can create up to five rounds per day, with three captions each. This small creative prompt makes the site useful to Sam, the Columbia student described in the assignment, without a crowded feature set. Newest/top sorting, unrated filtering, and a private vote history make it easy to find fresh content and see what lands.

## Activate the database

1. Open the existing Supabase project `amzkiegbewixbbvdmjwn` and its SQL Editor.
2. Run `supabase/migrations/202610050001_assignment4.sql` once as the project owner. It preserves existing rows, creates four related tables, enables RLS on all seven public app tables, and replaces permissive policies with authenticated/owner restrictions. It stops if unexpected tables or Storage buckets need review.
3. Run `supabase/verification.sql`. Every public table must show RLS enabled; anonymous roles must have no new app-table or RPC access. The final integrity query should return no rows.
4. Keep `punchline_private` out of the API's exposed schemas. The app only calls the authenticated public wrappers.

The SQL is intended for this project's existing schema, rather than an instructor's separate database. The October 5 assignment screenshots explicitly require enabling RLS and adding AI generation; they supersede the earlier pasted summary about an unidentified shared database and unchanged RLS.

## Configure DeepSeek securely

Use an existing DeepSeek API key. Keep it out of chat, Git, browser code, and any variable beginning with `NEXT_PUBLIC_`.

Add this variable to `.env.local` in the original project and restart the local app:

```dotenv
DEEPSEEK_API_KEY=your_key_here
```

In Vercel, open **week1-hello-world → Settings → Environment Variables**. Add **DEEPSEEK_API_KEY** for **Production and Preview**, using the sensitive/secret option if offered. Redeploy after saving it. No Supabase service-role key is needed.

The optional server variable `DEEPSEEK_MODEL` defaults to `deepseek-flash`, the model currently listed in DeepSeek's official API documentation. All calls use the fixed official API host, JSON output mode, a short output limit, and a 25-second timeout. Keys and provider errors are never returned to the browser.

Official API references: [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/), [JSON Output](https://api-docs.deepseek.com/guides/json_mode/), and [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/).

## Verify the deployed result

Sign in using Google, open Caption Lab, and create a round. Confirm that three captions appear, retain their chosen illustration, and remain after a reload. Submit an upvote and a downvote on different captions. Confirm they appear in My votes, persist after a reload, and cannot be submitted twice. In Supabase, inspect your own generation and verify both prompts, the model, image relation, three caption rows, and linked vote rows.

In an incognito browser, the public deployment URL should open the application's Google login page, without a Vercel protection screen. Caption pages require sign-in; anonymous API requests return 401. Deliver the successful commit-specific Vercel URL for the course submission.

Build and isolated tests verify code behavior; they do not replace the real Google, DeepSeek, and Supabase round-trip above. Live activation requires the database migration and API environment variable.
