# Senior Java Interview Prep

Daily practice questions for senior-level Java interviews. 144+ questions covering JVM internals, concurrency, Spring, design patterns, microservices, and more.

## Features

- 144+ curated senior Java interview questions with detailed answers
- Topic & difficulty filters (Medium / Hard / Expert)
- Daily set (10 / 15 / 20) — wrong answers reset the next day and appear first
- Progress tracking with streak counter
- Bookmark questions for review
- Retry badge on questions you previously got wrong
- **Leaderboard** — see how you rank against friends (fixed top-right panel)
- **Cross-device sync** via GitHub login (progress stored in Cloudflare D1)
- Google Sheets integration for adding your own questions
- Dark theme, responsive, works on mobile
- Zero frontend dependencies — pure HTML/CSS/JS

## Quick Start (Local)

1. Clone or download this folder
2. Serve with any static server:
   ```bash
   # Python
   python -m http.server 8000

   # Node.js
   npx serve .

   # VS Code Live Server extension — just right-click index.html
   ```
3. Open `http://localhost:8000`

The site loads questions from `data/questions.csv` by default.

## Deploy to GitHub Pages (Free)

1. Create a new GitHub repository (e.g., `interview-prep`)
2. Push this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/interview-prep.git
   git push -u origin main
   ```
3. Go to **Settings → Pages** in your GitHub repo
4. Under "Source", select **Deploy from a branch**
5. Select **main** branch, root folder (`/`), click Save
6. Your site will be live at: `https://YOUR_USERNAME.github.io/interview-prep/`

---

## Cross-Device Sync + Leaderboard

Progress is saved in `localStorage` by default. Logging in with GitHub syncs progress to a shared **Cloudflare D1 database** and enables the public **Leaderboard**.

### Architecture

```
Browser  --OAuth code-->  Cloudflare Worker  (/exchange)
                                |
                          D1 Database
                         /            \
         POST /progress               GET /leaderboard
         (save per user)              (public stats, no raw data)
```

Each user's progress is stored as a separate row keyed by GitHub ID — completely isolated. The leaderboard shows only public stats (username, avatar, completed count) — raw answer data is never exposed.

---

### Step 1 — Register a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name**: `Java Interview Prep`
   - **Homepage URL**: `https://YOUR_USERNAME.github.io/interview-prep/`
   - **Authorization callback URL**: `https://YOUR_USERNAME.github.io/interview-prep/`
   - Uncheck **Expire user access tokens**
3. Click **Register application**
4. Copy the **Client ID**, then click **Generate a new client secret** and copy it

---

### Step 2 — Create the D1 Database

Requires a free Cloudflare account and Wrangler CLI:

```bash
npm install -g wrangler
wrangler login
```

Create the database:

```bash
cd worker
npx wrangler d1 create jip-progress
```

Copy the `database_id` from the output and paste it into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "jip-progress"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

Create the table (run once):

```bash
npx wrangler d1 execute jip-progress --remote --command "CREATE TABLE IF NOT EXISTS progress (github_id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);"
```

---

### Step 3 — Deploy the Cloudflare Worker

```bash
cd worker
npm install

# Store OAuth credentials as encrypted secrets (never committed):
npx wrangler secret put GITHUB_CLIENT_ID       # paste the Client ID
npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the Client Secret

npx wrangler deploy
```

Wrangler prints the Worker URL, e.g. `https://jip-oauth.your-subdomain.workers.dev`.

Make sure `ALLOWED_ORIGIN` in `wrangler.toml` matches your site's origin exactly:

```toml
[vars]
ALLOWED_ORIGIN = "https://YOUR_USERNAME.github.io"
```

---

### Step 4 — Point the frontend at your Worker

Edit `js/config.js`:

```js
export const CONFIG = {
    GITHUB_CLIENT_ID: 'your_real_client_id',
    WORKER_URL: 'https://jip-oauth.your-subdomain.workers.dev',
    OAUTH_SCOPE: 'read:user',
};
```

Commit and push. The **Login with GitHub** button appears on the site. After login, progress syncs automatically and the leaderboard shows all users who have signed in.

---

### Worker API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/exchange` | none | Exchange GitHub OAuth code for access token |
| `POST` | `/progress` | Bearer token | Save the authenticated user's progress |
| `GET`  | `/progress` | Bearer token | Load the authenticated user's progress |
| `GET`  | `/leaderboard` | none | Public stats for all users (no raw progress) |

---

### How sync behaves

- **Local first** — every change writes to `localStorage` immediately (instant, works offline)
- **Push** — progress is pushed to D1 after each change (debounced ~1.5s)
- **Pull + merge on login** — remote progress merges with local using last-write-wins per question (completed wins; bookmarks and answers are OR-merged)
- **Not signed in** — behaves exactly as before, local only

### Security notes

- The OAuth **client secret** lives only as a Cloudflare Worker secret — never in the browser or the repo
- The Worker rejects requests from any origin not in `ALLOWED_ORIGIN`
- The token requests only the `read:user` scope — it cannot touch your repos or account settings
- The leaderboard exposes only username, avatar URL, and completion counts — never which questions were answered or what choices were made
- Progress rows are keyed by GitHub user ID; no user can read or write another user's data

---

## Google Sheets Integration

Load questions dynamically from a Google Sheet — edit the spreadsheet and the site updates automatically.

### Sheet columns

| id | topic | difficulty | question | choice_a | choice_b | choice_c | choice_d | correct | explanation |
|----|-------|-----------|----------|----------|----------|----------|----------|---------|-------------|

- **id**: unique identifier (number or string)
- **topic**: category name (e.g. `JVM Internals`, `Spring Framework`)
- **difficulty**: `medium`, `hard`, or `expert`
- **correct**: the correct letter — `A`, `B`, `C`, or `D`
- **explanation**: why the answer is correct

### Setup

1. Create a Google Sheet with the columns above
2. Go to **File → Share → Publish to web**, select the tab, format **CSV**, click Publish
3. Copy the published URL
4. On the deployed site, scroll to **Data Source**, paste the URL, click **Save & Reload**

### CSV tips

- Wrap fields containing commas in double quotes
- Escape inner double quotes by doubling them (`""`)
- Avoid em-dashes (`—`) — use ` - ` instead (Google Sheets misparses multi-byte characters in some import modes)

---

## Adding Questions Locally

Edit `data/questions.csv` directly:

```
id,topic,difficulty,question,choice_a,choice_b,choice_c,choice_d,correct,explanation
```

Example row:

```
"141","Spring Framework","medium","What is the difference between @Component, @Service, and @Repository?","All three behave differently","@Service and @Component are identical; @Repository also enables exception translation","@Repository auto-creates JPA repos","@Service enables AOP","B","..."
```

---

## Daily Set & Wrong Answer Retry

- Click **Daily Set** to get a focused set of questions (10 / 15 / 20 — select from the dropdown)
- The button highlights in indigo when active; click again to return to the full list
- Questions you answer **correctly** are marked complete and excluded from future daily sets
- Questions you answer **wrong** are unlocked the next day, flagged with a **↻ Retry** badge, and placed **first** in the next daily set so you see them again
- The progress bar updates to reflect the daily set size while active

---

## Topic Categories

| Topic | Covers |
|-------|--------|
| JVM Internals | GC, JIT, memory model, class loading, safepoints |
| Concurrency | Threads, locks, atomics, virtual threads, ForkJoin |
| Spring Framework | Bean lifecycle, AOP, transactions, WebFlux, Security |
| Design Patterns | Strategy, Builder, Circuit Breaker, CQRS, Saga |
| Collections | HashMap, TreeMap, ConcurrentHashMap, EnumSet |
| Streams & Lambdas | Functional interfaces, parallel streams, collectors |
| Performance | Profiling, memory leaks, JMH, N+1, memory-mapped files |
| Microservices | 20NINE architecture, Kafka, saga, DynamoDB, gRPC |
| Testing | Mockito, Testcontainers, contract testing, TDD |
| Modern Java | Records, sealed classes, pattern matching, Panama |

## License

Free to use and modify. Add your own questions and share with others.
