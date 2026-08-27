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

The site loads questions from `data/questions.json` by default.

## Deploy to GitHub Pages (Free)

1. Create a new GitHub repository (e.g., `java-interview-prep`)
2. Push this folder:
   ```bash
   cd java-interview-prep
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/java-interview-prep.git
   git push -u origin main
   ```
3. Go to **Settings → Pages** in your GitHub repo
4. Under "Source", select **Deploy from a branch**
5. Select **main** branch, root folder (`/`), click Save
6. Your site will be live at: `https://YOUR_USERNAME.github.io/java-interview-prep/`

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

## Adding Questions Locally

Edit `data/questions.json` directly. Each question follows this structure:

```json
{
  "id": "101",
  "topic": "Spring Framework",
  "difficulty": "hard",
  "question": "How does Spring handle circular dependencies?",
  "answer": "Spring resolves circular deps for singleton beans using three-level cache..."
}
```

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
