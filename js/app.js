// ===== Senior Java Interview Prep - Main App =====

const STORAGE_KEYS = {
    SHEET_URL: 'jip_sheet_url',
    PROGRESS: 'jip_progress',
    STREAK: 'jip_streak',
    LAST_DATE: 'jip_last_date',
    DAILY_SET: 'jip_daily_set',
};

// ===== State =====
let allQuestions = [];
let filteredQuestions = [];
let progress = loadProgress();

// ===== DOM Elements =====
const elements = {
    questionsList: document.getElementById('questionsList'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    topicFilter: document.getElementById('topicFilter'),
    difficultyFilter: document.getElementById('difficultyFilter'),
    statusFilter: document.getElementById('statusFilter'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    dailySetBtn: document.getElementById('dailySetBtn'),
    resetProgressBtn: document.getElementById('resetProgressBtn'),
    totalQuestions: document.getElementById('totalQuestions'),
    completedToday: document.getElementById('completedToday'),
    streak: document.getElementById('streak'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    sheetUrl: document.getElementById('sheetUrl'),
    saveConfigBtn: document.getElementById('saveConfigBtn'),
    useLocalBtn: document.getElementById('useLocalBtn'),
};

// ===== Init =====
async function init() {
    setupEventListeners();
    loadConfig();
    updateStreak();
    await loadQuestions();
}

// ===== Data Loading =====
async function loadQuestions() {
    showLoading(true);

    const sheetUrl = localStorage.getItem(STORAGE_KEYS.SHEET_URL);

    try {
        if (sheetUrl) {
            allQuestions = await fetchFromGoogleSheets(sheetUrl);
        } else {
            allQuestions = await fetchLocalQuestions();
        }

        populateTopicFilter();
        applyFilters();
        updateStats();
        showLoading(false);
    } catch (error) {
        console.error('Failed to load questions:', error);
        // Fallback to local
        try {
            allQuestions = await fetchLocalQuestions();
            populateTopicFilter();
            applyFilters();
            updateStats();
        } catch (e) {
            showError('Failed to load questions. Check console for details.');
        }
        showLoading(false);
    }
}

async function fetchFromGoogleSheets(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`);

    const csvText = await response.text();
    return parseCSV(csvText);
}

function parseCSV(csv) {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    // First line is headers: id, topic, difficulty, question, answer
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

    const idIdx = headers.indexOf('id');
    const topicIdx = headers.indexOf('topic');
    const diffIdx = headers.indexOf('difficulty');
    const questionIdx = headers.indexOf('question');
    const choiceAIdx = headers.indexOf('choice_a');
    const choiceBIdx = headers.indexOf('choice_b');
    const choiceCIdx = headers.indexOf('choice_c');
    const choiceDIdx = headers.indexOf('choice_d');
    const correctIdx = headers.indexOf('correct');
    const explanationIdx = headers.indexOf('explanation');

    const questions = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < 4) continue;

        const correctLetter = (values[correctIdx] || 'A').trim().toUpperCase();
        const correctIndex = ['A', 'B', 'C', 'D'].indexOf(correctLetter);

        questions.push({
            id: values[idIdx] || String(i),
            topic: (values[topicIdx] || 'General').trim(),
            difficulty: (values[diffIdx] || 'medium').trim().toLowerCase(),
            question: (values[questionIdx] || '').trim(),
            choices: [
                (values[choiceAIdx] || '').trim(),
                (values[choiceBIdx] || '').trim(),
                (values[choiceCIdx] || '').trim(),
                (values[choiceDIdx] || '').trim(),
            ],
            correctIndex: correctIndex >= 0 ? correctIndex : 0,
            explanation: (values[explanationIdx] || '').trim(),
        });
    }

    return questions.filter(q => q.question);
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

async function fetchLocalQuestions() {
    const response = await fetch('data/questions.json');
    if (!response.ok) throw new Error('Local questions not found');
    return await response.json();
}

// ===== Rendering =====
function renderQuestions(questions) {
    if (questions.length === 0) {
        elements.questionsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">&#128218;</div>
                <p class="empty-state__text">No questions match your filters. Try adjusting the filters above.</p>
            </div>
        `;
        return;
    }

    elements.questionsList.innerHTML = questions.map((q, idx) => {
        const status = progress[q.id] || {};
        const isCompleted = status.completed;
        const isBookmarked = status.bookmarked;
        const answered = status.answered; // index of chosen answer

        const cardClass = [
            'question-card',
            isCompleted ? 'question-card--completed' : '',
            isBookmarked ? 'question-card--bookmarked' : '',
        ].filter(Boolean).join(' ');

        const letters = ['A', 'B', 'C', 'D'];
        const choices = q.choices || [];
        const correctIdx = q.correctIndex ?? 0;
        const hasAnswered = answered !== undefined;

        const choicesHtml = choices.map((choice, i) => {
            let stateClass = '';
            if (hasAnswered) {
                if (i === correctIdx) stateClass = 'choice--correct';
                else if (i === answered && i !== correctIdx) stateClass = 'choice--wrong';
                stateClass += ' choice--disabled';
            }

            return `
                <div class="choice ${stateClass}" 
                     onclick="selectChoice('${q.id}', ${i})"
                     data-index="${i}">
                    <span class="choice__letter">${letters[i]}</span>
                    <span class="choice__text">${escapeHtml(choice)}</span>
                </div>
            `;
        }).join('');

        const resultHtml = hasAnswered
            ? (answered === correctIdx
                ? `<span class="question-card__result question-card__result--correct">&#10003; Correct</span>`
                : `<span class="question-card__result question-card__result--wrong">&#10007; Wrong — Answer: ${letters[correctIdx]}</span>`)
            : '';

        const explanationHtml = q.explanation
            ? `<div class="question-card__explanation ${hasAnswered ? 'question-card__explanation--visible' : ''}">${formatExplanation(q.explanation)}</div>`
            : '';

        return `
            <article class="${cardClass}" data-id="${q.id}">
                <div class="question-card__header">
                    <div class="question-card__meta">
                        <span class="question-card__topic">${escapeHtml(q.topic)}</span>
                        <span class="question-card__difficulty question-card__difficulty--${q.difficulty}">
                            ${q.difficulty}
                        </span>
                    </div>
                    <div class="question-card__actions">
                        <button class="question-card__btn" onclick="toggleBookmark('${q.id}')" 
                            title="${isBookmarked ? 'Remove bookmark' : 'Bookmark'}">
                            ${isBookmarked ? '&#11088;' : '&#9734;'}
                        </button>
                        <button class="question-card__btn" onclick="toggleComplete('${q.id}')"
                            title="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">
                            ${isCompleted ? '&#9989;' : '&#9898;'}
                        </button>
                    </div>
                </div>
                <p class="question-card__question">
                    <span class="question-card__number">#${idx + 1}</span>
                    ${escapeHtml(q.question)}
                </p>
                <div class="question-card__choices">
                    ${choicesHtml}
                </div>
                ${resultHtml}
                ${explanationHtml}
            </article>
        `;
    }).join('');
}

function formatExplanation(text) {
    return text
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Filters =====
function populateTopicFilter() {
    const topics = [...new Set(allQuestions.map(q => q.topic))].sort();
    elements.topicFilter.innerHTML = '<option value="all">All Topics</option>' +
        topics.map(t => `<option value="${t}">${t}</option>`).join('');
}

function applyFilters() {
    const topic = elements.topicFilter.value;
    const difficulty = elements.difficultyFilter.value;
    const status = elements.statusFilter.value;

    filteredQuestions = allQuestions.filter(q => {
        if (topic !== 'all' && q.topic !== topic) return false;
        if (difficulty !== 'all' && q.difficulty !== difficulty) return false;

        if (status === 'unseen') {
            return !progress[q.id]?.completed;
        } else if (status === 'completed') {
            return progress[q.id]?.completed;
        } else if (status === 'bookmarked') {
            return progress[q.id]?.bookmarked;
        }

        return true;
    });

    renderQuestions(filteredQuestions);
    updateProgressBar();
}

// ===== Actions =====
window.selectChoice = function (id, chosenIndex) {
    if (!progress[id]) progress[id] = {};
    // Don't allow re-answering
    if (progress[id].answered !== undefined) return;

    const question = allQuestions.find(q => q.id === id);
    if (!question) return;

    const correctIdx = question.correctIndex ?? 0;
    progress[id].answered = chosenIndex;

    // Auto-mark complete if correct
    if (chosenIndex === correctIdx) {
        progress[id].completed = true;
        progress[id].completedDate = new Date().toISOString().split('T')[0];
    }

    saveProgress();
    // Re-render just this card for instant feedback
    renderQuestions(filteredQuestions);
    updateStats();
};

window.toggleComplete = function (id) {
    if (!progress[id]) progress[id] = {};
    progress[id].completed = !progress[id].completed;

    if (progress[id].completed) {
        progress[id].completedDate = new Date().toISOString().split('T')[0];
    }

    saveProgress();
    applyFilters();
    updateStats();
};

window.toggleBookmark = function (id) {
    if (!progress[id]) progress[id] = {};
    progress[id].bookmarked = !progress[id].bookmarked;
    saveProgress();
    applyFilters();
};

function shuffleQuestions() {
    filteredQuestions = [...filteredQuestions].sort(() => Math.random() - 0.5);
    renderQuestions(filteredQuestions);
}

function generateDailySet() {
    const today = new Date().toISOString().split('T')[0];
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_SET) || '{}');

    // If we already have a set for today, use it
    if (stored.date === today && stored.ids) {
        const dailyQuestions = stored.ids
            .map(id => allQuestions.find(q => q.id === id))
            .filter(Boolean);

        if (dailyQuestions.length > 0) {
            filteredQuestions = dailyQuestions;
            renderQuestions(filteredQuestions);
            return;
        }
    }

    // Generate new daily set — prefer unseen questions
    const unseen = allQuestions.filter(q => !progress[q.id]?.completed);
    const pool = unseen.length >= 20 ? unseen : allQuestions;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const dailySet = shuffled.slice(0, 20);

    // Save for today
    localStorage.setItem(STORAGE_KEYS.DAILY_SET, JSON.stringify({
        date: today,
        ids: dailySet.map(q => q.id),
    }));

    filteredQuestions = dailySet;
    renderQuestions(filteredQuestions);
}

function resetProgress() {
    if (!confirm('Reset all progress? This cannot be undone.')) return;
    progress = {};
    saveProgress();
    localStorage.removeItem(STORAGE_KEYS.DAILY_SET);
    applyFilters();
    updateStats();
}

// ===== Progress & Stats =====
function loadProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROGRESS) || '{}');
    } catch {
        return {};
    }
}

function saveProgress() {
    localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progress));
}

function updateStats() {
    const total = allQuestions.length;
    const completed = Object.values(progress).filter(p => p.completed).length;
    const today = new Date().toISOString().split('T')[0];
    const completedToday = Object.values(progress)
        .filter(p => p.completed && p.completedDate === today).length;

    elements.totalQuestions.textContent = total;
    elements.completedToday.textContent = completedToday;
    elements.streak.textContent = getStreak();

    updateProgressBar();
}

function updateProgressBar() {
    const total = filteredQuestions.length;
    const completed = filteredQuestions.filter(q => progress[q.id]?.completed).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    elements.progressFill.style.width = `${pct}%`;
    elements.progressText.textContent = `${completed} / ${total} completed`;
}

function updateStreak() {
    const today = new Date().toISOString().split('T')[0];
    const lastDate = localStorage.getItem(STORAGE_KEYS.LAST_DATE);
    let streak = parseInt(localStorage.getItem(STORAGE_KEYS.STREAK) || '0', 10);

    if (lastDate === today) {
        // Already counted today
    } else if (lastDate === getYesterday()) {
        streak++;
        localStorage.setItem(STORAGE_KEYS.STREAK, streak);
        localStorage.setItem(STORAGE_KEYS.LAST_DATE, today);
    } else if (lastDate !== today) {
        // Streak broken (or first visit)
        streak = lastDate ? 0 : 0;
        localStorage.setItem(STORAGE_KEYS.STREAK, streak);
        localStorage.setItem(STORAGE_KEYS.LAST_DATE, today);
    }
}

function getStreak() {
    return parseInt(localStorage.getItem(STORAGE_KEYS.STREAK) || '0', 10);
}

function getYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

// ===== Config =====
function loadConfig() {
    const savedUrl = localStorage.getItem(STORAGE_KEYS.SHEET_URL);
    if (savedUrl) {
        elements.sheetUrl.value = savedUrl;
    }
}

function saveConfig() {
    const url = elements.sheetUrl.value.trim();
    if (url) {
        localStorage.setItem(STORAGE_KEYS.SHEET_URL, url);
    } else {
        localStorage.removeItem(STORAGE_KEYS.SHEET_URL);
    }
    loadQuestions();
}

function useLocalData() {
    localStorage.removeItem(STORAGE_KEYS.SHEET_URL);
    elements.sheetUrl.value = '';
    loadQuestions();
}

// ===== Utilities =====
function showLoading(show) {
    if (show) {
        elements.loadingIndicator.style.display = 'block';
    } else {
        elements.loadingIndicator.style.display = 'none';
    }
}

function showError(message) {
    elements.questionsList.innerHTML = `
        <div class="empty-state">
            <div class="empty-state__icon">&#9888;&#65039;</div>
            <p class="empty-state__text">${message}</p>
        </div>
    `;
}

// ===== Event Listeners =====
function setupEventListeners() {
    elements.topicFilter.addEventListener('change', applyFilters);
    elements.difficultyFilter.addEventListener('change', applyFilters);
    elements.statusFilter.addEventListener('change', applyFilters);
    elements.shuffleBtn.addEventListener('click', shuffleQuestions);
    elements.dailySetBtn.addEventListener('click', generateDailySet);
    elements.resetProgressBtn.addEventListener('click', resetProgress);
    elements.saveConfigBtn.addEventListener('click', saveConfig);
    elements.useLocalBtn.addEventListener('click', useLocalData);
}

// ===== Start =====
init();
