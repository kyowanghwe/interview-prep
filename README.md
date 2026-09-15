# Senior Java Interview Prep

Daily practice questions for senior-level Java interviews. 100 questions covering JVM internals, concurrency, Spring, design patterns, microservices, and more.

## Features

- 100 curated senior Java interview questions with detailed answers
- Topic & difficulty filters (Medium / Hard / Expert)
- Daily set of 10 random questions
- Progress tracking with streak counter (localStorage)
- Bookmark questions for review
- Google Sheets integration for adding your own questions
- Dark theme, responsive, works on mobile
- Zero dependencies — pure HTML/CSS/JS

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

1. Create a new GitHub repository (e.g., `java-interview-prep`)
2. Push this folder:
   ```bash
   cd java-interview-prep
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/kyowanghwe/interview-prep.git
   git push -u origin main
   ```
3. Go to **Settings → Pages** in your GitHub repo
4. Under "Source", select **Deploy from a branch**
5. Select **main** branch, root folder (`/`), click Save
6. Your site will be live at: `https://kyowanghwe.github.io/interview-prep/`

## Google Sheets Integration

Load questions dynamically from a Google Sheet — edit the spreadsheet and your site updates automatically.

### Step 1: Create the Google Sheet

Create a new Google Sheet with these exact column headers in Row 1:

| id | topic | difficulty | question | answer |
|----|-------|-----------|----------|--------|
| 1  | JVM Internals | hard | What is escape analysis? | Escape analysis determines... |
| 2  | Spring Framework | medium | Explain @Transactional | Spring creates a proxy... |

- **id**: unique identifier (number or string)
- **topic**: category name (e.g., "JVM Internals", "Concurrency", "Spring Framework")
- **difficulty**: one of `medium`, `hard`, `expert`
- **question**: the interview question
- **answer**: detailed answer (supports `code blocks` with backticks)

### Step 2: Publish the Sheet

1. In Google Sheets, go to **File → Share → Publish to web**
2. Select the sheet tab with your questions
3. Change format from "Web page" to **Comma-separated values (.csv)**
4. Click **Publish**
5. Copy the URL — it looks like:
   ```
   https://docs.google.com/spreadsheets/d/e/2PACX-1v.../pub?gid=0&single=true&output=csv
   ```

### Step 3: Configure the Site

1. Open your deployed site
2. Scroll to the "Data Source" section at the bottom
3. Paste your published CSV URL
4. Click "Save & Reload"

That's it! Questions now load from your sheet. Edit the sheet anytime — changes appear on next page load.

### Tips for Google Sheets

- You can have multiple sheets (tabs) — just publish each one separately
- For answers with code, use backticks: `` `HashMap<String, List<Integer>>` ``
- For multi-line answers, just type normally in the cell (Sheets handles newlines in CSV)
- Add new questions at any time — just append rows
- Share the sheet with your study group for collaborative question building

## Cross-Device Sync (GitHub Login)

By default, progress is saved in `localStorage` (per-browser). To sync progress
across devices, the app can log you in with GitHub and store your progress in a
private **GitHub Gist**. A tiny **Cloudflare Worker** performs the OAuth token
exchange (the OAuth client secret must never live in the browser).

```
Browser (GitHub Pages)  --code-->  Cloudflare Worker  --secret-->  GitHub OAuth
        ^                                  |
        +------------- access_token -------+
        |
        +--> GitHub Gist API (read/write jip-progress.json) directly
```

### Step 1 — Register a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name**: `Java Interview Prep`
   - **Homepage URL**: `https://kyowanghwe.github.io/interview-prep/`
   - **Authorization callback URL**: `https://kyowanghwe.github.io/interview-prep/`
     (must match the deployed page URL exactly — same origin + path)
   - Uncheck **Expire user access tokens** (the app doesn't implement refresh tokens)
3. Click **Register application**
4. Copy the **Client ID**, then **Generate a new client secret** and copy it too

### Step 2 — Deploy the Cloudflare Worker

Requires a free Cloudflare account and the Wrangler CLI (`npm i -g wrangler`).

```bash
cd worker
npm install

# wrangler.toml already sets ALLOWED_ORIGIN to your site's ORIGIN (no path):
#   ALLOWED_ORIGIN = "https://kyowanghwe.github.io"

# Store the OAuth credentials as encrypted secrets (not committed):
wrangler secret put GITHUB_CLIENT_ID       # paste the Client ID
wrangler secret put GITHUB_CLIENT_SECRET   # paste the Client secret

wrangler deploy
```

Wrangler prints the Worker URL, e.g. `https://jip-oauth.your-subdomain.workers.dev`.

### Step 3 — Point the frontend at your Worker

Edit `js/config.js`:

```js
export const CONFIG = {
    GITHUB_CLIENT_ID: 'your_real_client_id',
    WORKER_URL: 'https://jip-oauth.your-subdomain.workers.dev',
    // ...leave the rest as-is
};
```

Commit and push. On the deployed site a **Login with GitHub** button appears.
Click it, authorize (scope: `gist` only), and your progress now syncs to a
private gist named `jip-progress.json` on any device where you sign in.

### How sync behaves

- **Local first**: every change is written to `localStorage` immediately, so the
  app is instant and works offline.
- **Push**: after a change, progress is pushed to the gist (debounced ~1.5s).
- **Pull + merge on login**: remote progress is merged with local using
  last-write-wins per question (completed wins; bookmarks/answers are OR-merged).
- **Not signed in**: behaves exactly as before — local-only.

### Security notes

- The OAuth **client secret** lives only as a Cloudflare Worker secret — never in
  the browser or the repo.
- The Worker only accepts requests from `ALLOWED_ORIGIN` and only returns the
  access token for a valid `code`.
- The token requests just the `gist` scope, so it cannot touch your repos or account settings.
- The progress gist is **secret** (not listed publicly), though anyone with its
  exact URL could read it — don't store anything sensitive in progress data.

## Adding Questions Locally

Edit `data/questions.csv` directly. It's a multiple-choice format with these columns:

```
id,topic,difficulty,question,choice_a,choice_b,choice_c,choice_d,correct,explanation
```

- **id**: unique identifier
- **topic**: category name (e.g. "Spring Framework")
- **difficulty**: `medium`, `hard`, or `expert`
- **question**: the question text
- **choice_a … choice_d**: the four answer options
- **correct**: the correct letter — `A`, `B`, `C`, or `D`
- **explanation**: why the answer is correct

Wrap any field containing a comma in double quotes, and escape inner quotes by doubling them (`""`). Example row:

```
"126","Spring Framework","hard","How does Spring handle circular dependencies?","Throws immediately","Uses a three-level cache exposing early references","Serializes beans to disk","Creates prototype proxies","B","Spring exposes A's early reference to B via the singletonFactories cache..."
```

The Google Sheet uses these same columns, so local CSV and the sheet stay interchangeable.

## Topic Categories

| Topic | Count | Covers |
|-------|-------|--------|
| JVM Internals | 13 | GC, JIT, memory model, class loading, safepoints |
| Concurrency | 14 | Threads, locks, atomics, virtual threads, ForkJoin |
| Spring Framework | 13 | Bean lifecycle, AOP, transactions, WebFlux, Security |
| Design Patterns | 13 | Strategy, Builder, Circuit Breaker, CQRS, Saga |
| Collections | 8 | HashMap, TreeMap, ConcurrentHashMap, EnumSet |
| Streams & Lambdas | 8 | Functional interfaces, parallel streams, collectors |
| Performance | 10 | Profiling, pooling, JMH, N+1, memory-mapped files |
| Microservices | 10 | API Gateway, service mesh, distributed tracing |
| Testing | 8 | Mockito, Testcontainers, contract testing, TDD |
| Modern Java | 8 | Records, sealed classes, pattern matching, Panama |

## Keyboard Shortcuts

(Planned for future update)

## License

Free to use and modify. Add your own questions and share with others.
