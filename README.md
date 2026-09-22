# CareerPath

A skill-verification platform for students preparing for a specific career role. Pick a
target role, get the roadmap of skills it needs, learn each one through that role's lens,
and earn stars only by passing assessment. Nothing can be checked off by hand.

Built as the team prototype for MOR 531 at USC.

## What it does

**Four role tracks**, 21 skills. The same named skill is taught and assessed differently
per role: SQL for a Product Manager covers funnels, retention and experiment readouts,
while SQL for a Financial Analyst covers ledger periods and trial balance tie-outs. That
difference is the product thesis.

**Student side.** Sign up, choose a target role, work through course modules, attempt
practice exercises with progressive hints and an answer check, take a 10-question
assessment graded L1 to L5, earn one to five stars, download a certificate at three stars
or above, and compete on a leaderboard limited to your own school and target role.

**Admin side.** A separate role on the same application. Lessons publish directly.
Assessment questions go through draft, review and publish, and the version they replace is
archived, so a score recorded against v2 stays explainable after v3 goes live. Admins can
preview any content exactly as a student sees it, and can read student progress but never
change it.

**Study assistant.** Ask questions about the module you are reading, or select any text and
ask about that passage. It is switched off during a graded assessment, because a verified
star has to mean the student knew the answer.

## Running it

```bash
npm i -g vercel        # once
cp .env.example .env   # then paste your key into .env
vercel dev
```

Open http://localhost:3000.

The site itself is static and needs no build step. The only server-side piece is
`api/ask.js`, which the study assistant calls.

### Sign-in for the demo

| Role    | Email                    | Password  |
| ------- | ------------------------ | --------- |
| Student | student@careerpath.com   | student   |
| Admin   | admin@careerpath.com     | admin     |

Both appear as clickable cards on the sign-in screen.

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New > Project**, and import the repository.
3. Framework preset: **Other**. No build command. Output directory: `public`.
   Vercel detects this automatically from the repository layout.
4. Under **Settings > Environment Variables**, add three values. Tick Production,
   Preview and Development for each.

   For **Google Gemini**, which has a free tier:

   | Name          | Value                                                  |
   | ------------- | ------------------------------------------------------ |
   | `AI_API_KEY`  | your Gemini key from aistudio.google.com               |
   | `AI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
   | `AI_MODEL`    | a model id from AI Studio, e.g. `gemini-3.8-flash`     |

   For **OpenAI**:

   | Name          | Value                          |
   | ------------- | ------------------------------ |
   | `AI_API_KEY`  | your key from platform.openai.com |
   | `AI_BASE_URL` | `https://api.openai.com/v1`    |
   | `AI_MODEL`    | `gpt-4o-mini`                  |

5. Deploy. If you add the key after the first deploy, redeploy so the function picks it up.

The key is only ever read inside `api/ask.js`, which runs on Vercel's servers. It is never
sent to the browser and is not in this repository.

### Switching provider

`api/ask.js` speaks the OpenAI chat-completions format, which OpenAI, Gemini and several
other providers all serve. Changing provider means changing those three variables and
redeploying. No code changes.

## Tests

There is a browser test suite covering the student flow, the admin draft-and-publish
workflow, the assistant, and the deployed shape of the site.

```bash
npm i                        # installs playwright
npx playwright install chromium

npm run mock-provider        # terminal 1: stands in for the model, spends no key
AI_API_KEY=test-key AI_BASE_URL=http://localhost:3112 npm run serve   # terminal 2
npm test                     # terminal 3
```

`test/fakeopenai.mjs` speaks the streaming chat-completions format, so the whole request
path including `api/ask.js` is exercised without a real key. `test/devserver.mjs` mimics
what Vercel does: static files from `public/`, `/api/ask` routed to the function.

Set `FAIL_MODE` on the mock provider to exercise the failure paths: `quota`, `ratelimit`
or `model`. Each should produce a different, actionable message in the assistant panel.

## Layout

```
api/ask.js             Serverless function. Holds the API key, streams the reply back.
public/index.html      Markup and all styling.
public/app.js          The whole application: routing, scoring, admin, assistant.
public/data.js         Product Manager track.
public/data2.js        Business Analyst and Data Analyst tracks.
public/data3.js        Financial Analyst track.
public/data4.js        Practice exercises: prompts, schemas, hints, model answers.
public/data5.js        Answer-checking rules for practice exercises.
test/app.spec.mjs      Student and admin flows.
test/assistant.spec.mjs  Assistant, both backends, and the assessment lock.
test/deploy.spec.mjs   The deployed build: assets, encoding, /api/ask streaming.
test/devserver.mjs     Local stand-in for Vercel's routing.
test/fakeopenai.mjs    Local stand-in for the model provider.
```

`app.js` has two assistant backends behind one interface. On claude.ai it uses the
artifact runtime; anywhere else it posts to `/api/ask`. Opened as a local file with neither
available, the assistant hides itself and the rest of the app works normally.

## Known limits of the prototype

**Nothing persists.** All state is in memory, so a refresh resets everything and accounts
do not exist across devices. Adding a database is the next step, and the honest place to
draw the line between a prototype and a product.

**The answer check is structural.** A practice query is checked against what a correct
answer must contain and the mistakes that make one wrong. It does not execute the query,
because there is no database behind the page. Written answers are checked for concept
coverage, which reports whether an idea was raised, not how well it was argued. Both
caveats are printed in the app where a learner sees them.

**Question banks are demo-depth.** Ten questions per assessment, enough to demonstrate the
scoring honestly, not a full curriculum.

## Design decisions worth defending

**Progress is earned, not declared.** There is no way for a student or an admin to set a
star level. This is the difference between CareerPath and a self-reported skills list.

**Graded content is versioned.** Editing a live assessment question would make every past
score unexplainable and every certificate issued from it meaningless. So an edit creates a
draft, publishing archives the version it replaces, and each attempt records the version it
was scored against.

**Lessons and exams have different review policies.** A typo in a lesson carries no scoring
risk, so lessons publish immediately. Questions do not.

**AI helps you learn and is blocked while you are tested.** The assistant is available in
modules, practice and results, including an explanation of any question you got wrong. It
is unavailable during an assessment.
