// ===== Senior Java Interview Prep - Main App =====

import { login, logout, handleRedirect, isLoggedIn, getUser } from './auth.js';
import { pullProgress, schedulePush, clearGistCache, fetchLeaderboard } from './sync.js';
import { isSyncConfigured, CONFIG } from './config.js';

const STORAGE_KEYS = {
    SHEET_URL: 'jip_sheet_url',
    PROGRESS: 'jip_progress',
    STREAK: 'jip_streak',
    LAST_DATE: 'jip_last_date',
    DAILY_SET: 'jip_daily_set',
    LAST_WRONG_RESET: 'jip_last_wrong_reset',
};

// ===== State =====
let allQuestions = [];
let filteredQuestions = [];
let progress = loadProgress();
let isDailyActive = false; // tracks whether the daily set view is currently active
// Unsubmitted multi-answer selections, keyed by question id.
const pendingSelections = new Map();

// ===== DOM Elements =====
const elements = {
    questionsList: document.getElementById('questionsList'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    topicFilter: document.getElementById('topicFilter'),
    difficultyFilter: document.getElementById('difficultyFilter'),
    statusFilter: document.getElementById('statusFilter'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    dailySetBtn: document.getElementById('dailySetBtn'),
    dailySetSize: document.getElementById('dailySetSize'),
    resetProgressBtn: document.getElementById('resetProgressBtn'),
    totalQuestions: document.getElementById('totalQuestions'),
    completedToday: document.getElementById('completedToday'),
    streak: document.getElementById('streak'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    sheetUrl: document.getElementById('sheetUrl'),
    saveConfigBtn: document.getElementById('saveConfigBtn'),
    uploadCsvBtn: document.getElementById('uploadCsvBtn'),
    csvFileInput: document.getElementById('csvFileInput'),
    // Auth / sync
    loginBtn: document.getElementById('loginBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    authUser: document.getElementById('authUser'),
    authAvatar: document.getElementById('authAvatar'),
    authName: document.getElementById('authName'),
    syncStatus: document.getElementById('syncStatus'),
    backToTopBtn: document.getElementById('backToTopBtn'),
    jumpToBottomBtn: document.getElementById('jumpToBottomBtn'),
    leaderboardList: document.getElementById('leaderboardList'),
    leaderboardRefreshBtn: document.getElementById('leaderboardRefreshBtn'),
    leaderboardToggleBtn: document.getElementById('leaderboardToggleBtn'),
    leaderboardSection: document.getElementById('leaderboardSection'),
};

// ===== Init =====
async function init() {
    setupEventListeners();
    loadConfig();
    updateStreak();

    // Complete any pending GitHub OAuth redirect before loading data.
    let justLoggedIn = false;
    try {
        const result = await handleRedirect();
        justLoggedIn = result.justLoggedIn;
    } catch (e) {
        console.warn('OAuth redirect handling failed:', e);
    }

    updateAuthUI();
    updateDailySetUI();
    await loadQuestions({ deferSync: true });

    // If logged in, pull remote progress and merge it in.
    if (isLoggedIn()) {
        await syncPull(justLoggedIn);
    }

    // Once per day, reset wrong-answer questions so they can be retried.
    maybeResetWrongAnswersForNewDay();
}

// Reset wrong answers when the day rolls over, independent of clicking the
// Daily Set button. Tracks the last reset date so it only runs once per day.
function maybeResetWrongAnswersForNewDay() {
    const today = new Date().toISOString().split('T')[0];
    const lastReset = localStorage.getItem(STORAGE_KEYS.LAST_WRONG_RESET);
    if (lastReset === today) return;

    resetWrongAnswers();
    localStorage.setItem(STORAGE_KEYS.LAST_WRONG_RESET, today);

    // Refresh the view so unlocked questions render as answerable again.
    applyFilters();
    updateStats();
}

// ===== Data Loading =====
async function loadQuestions({ deferSync = false } = {}) {
    showLoading(true);
    pendingSelections.clear();

    // Prefer a Google Sheet so edits to the sheet show up on the site:
    // use the user's saved URL if set, otherwise the default from config.
    // Fall back to the bundled local CSV only if there's no sheet URL.
    const sheetUrl = localStorage.getItem(STORAGE_KEYS.SHEET_URL) || CONFIG.DEFAULT_SHEET_URL;

    try {
        if (sheetUrl) {
            allQuestions = await fetchFromGoogleSheets(sheetUrl);
        } else {
            allQuestions = await fetchLocalQuestions();
        }

        finalizeQuestionsLoad({ deferSync });
        showLoading(false);
    } catch (error) {
        console.error('Failed to load questions:', error);
        // Fallback to local
        try {
            allQuestions = await fetchLocalQuestions();
            finalizeQuestionsLoad({ deferSync });
        } catch (e) {
            showError('Failed to load questions. Check console for details.');
        }
        showLoading(false);
    }
}

function finalizeQuestionsLoad({ deferSync = false } = {}) {
    // Clean up stored answers whose shape no longer matches the question.
    // During startup we defer the push until after syncPull(), so a device with
    // stale local data cannot overwrite newer remote progress.
    migrateLegacyAnswerShapes({ push: !deferSync });
    populateTopicFilter();
    applyFilters();
    updateStats();
}

function migrateLegacyAnswerShapes({ push = true } = {}) {
    let changed = false;

    for (const question of allQuestions) {
        const entry = progress[question.id];
        if (!entry) continue;

        // A multi-answer question expects an array; a single-answer question
        // expects a number. Ids are shared across question banks, so an answer
        // stored for the same id in another bank can have the wrong shape.
        const hasWrongShape = isMultiAnswer(question)
            ? typeof entry.answered === 'number'
            : Array.isArray(entry.answered);

        if (!hasWrongShape) continue;

        // The old single-answer logic stored one index for multi-answer
        // questions and could mark them completed with the fallback answer.
        delete entry.answered;
        delete entry.completed;
        delete entry.completedDate;

        if (!Object.keys(entry).length) delete progress[question.id];
        changed = true;
    }

    if (changed) saveProgress({ push });
}

async function fetchFromGoogleSheets(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`);

    const csvText = await response.text();
    return parseCSV(csvText);
}

// Parse the entire CSV text at once so quoted fields containing newlines,
// commas, and escaped quotes stay part of the same record.
function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    text = text.replace(/^\uFEFF/, '');

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"' && field === '') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function parseCSV(csv) {
    const rows = parseCSVRows(csv);
    if (rows.length < 2) return [];

    // First row is headers: id, topic, difficulty, question, ...
    const headers = rows[0].map(h => h.toLowerCase().trim());

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
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < 4) continue;

        const questionId = values[idIdx] || String(i);
        const rawCorrect = (values[correctIdx] || 'A').trim().toUpperCase();
        const correctLetters = [...new Set(rawCorrect.match(/[A-D]/g) || [])].sort();
        const correctIndexes = correctLetters
            .map(letter => ['A', 'B', 'C', 'D'].indexOf(letter))
            .filter(index => index >= 0);

        if (!correctIndexes.length) {
            console.warn(`Question ${questionId}: invalid correct value "${rawCorrect}", defaulting to A`);
            correctIndexes.push(0);
        }

        const choices = [
            (values[choiceAIdx] || '').trim(),
            (values[choiceBIdx] || '').trim(),
            (values[choiceCIdx] || '').trim(),
            (values[choiceDIdx] || '').trim(),
        ];

        if (correctIndexes.some(index => !choices[index])) {
            console.warn(`Question ${questionId}: correct answer points to an empty choice`);
        }

        questions.push({
            id: questionId,
            topic: (values[topicIdx] || 'General').trim(),
            difficulty: (values[diffIdx] || 'medium').trim().toLowerCase(),
            question: (values[questionIdx] || '').trim(),
            choices,
            correctIndexes,
            correctIndex: correctIndexes[0],
            explanation: (values[explanationIdx] || '').trim(),
        });
    }

    return questions.filter(q => q.question);
}

function getCorrectIndexes(question) {
    if (Array.isArray(question.correctIndexes) && question.correctIndexes.length) {
        return question.correctIndexes;
    }
    return [question.correctIndex ?? 0];
}

function isMultiAnswer(question) {
    return getCorrectIndexes(question).length > 1;
}

async function fetchLocalQuestions() {
    const response = await fetch('data/questions.csv');
    if (!response.ok) throw new Error('Local questions not found');
    const csvText = await response.text();
    return parseCSV(csvText);
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
        refreshScrollButtons();
        return;
    }

    elements.questionsList.innerHTML = questions.map((q, idx) => {
        const status = progress[q.id] || {};
        const isCompleted = status.completed;
        const isBookmarked = status.bookmarked;
        const answered = status.answered; // single index, or an array for multi-answer
        // A "retry" question was answered wrong on a previous day, unlocked for
        // another attempt (has wrongDate, not completed, no current answer).
        const isRetry = status.wrongDate && !isCompleted && answered === undefined;

        const cardClass = [
            'question-card',
            isCompleted ? 'question-card--completed' : '',
            isBookmarked ? 'question-card--bookmarked' : '',
            isRetry ? 'question-card--retry' : '',
        ].filter(Boolean).join(' ');

        const letters = ['A', 'B', 'C', 'D'];
        const choices = (q.choices || [])
            .map((text, index) => ({ text, index }))
            .filter(c => c.text.trim() !== '');

        const correctIndexes = getCorrectIndexes(q);
        const isMulti = correctIndexes.length > 1;
        const correctIdx = correctIndexes[0] ?? 0;
        const hasAnswered = answered !== undefined;

        const answeredIndexes = Array.isArray(answered)
            ? answered
            : (typeof answered === 'number' ? [answered] : []);
        const pending = isMulti && !hasAnswered
            ? [...(pendingSelections.get(q.id) || [])]
            : [];
        const selectedIndexes = isMulti
            ? [...new Set(hasAnswered ? answeredIndexes : pending)].sort((a, b) => a - b)
            : answeredIndexes;

        const isSelected = index => selectedIndexes.includes(index);
        const isCorrectChoice = index => correctIndexes.includes(index);
        const isFullyCorrect = isMulti && hasAnswered &&
            selectedIndexes.length === correctIndexes.length &&
            selectedIndexes.every((index, i) => index === correctIndexes[i]);
        const isPartial = isMulti && hasAnswered && !isFullyCorrect &&
            selectedIndexes.length > 0 &&
            selectedIndexes.every(index => isCorrectChoice(index));

        const choicesHtml = choices.map(({ text, index }) => {
            let stateClass = '';

            if (isMulti) {
                if (hasAnswered) {
                    if (isCorrectChoice(index)) {
                        stateClass = 'choice--correct';
                        if (!isSelected(index)) stateClass += ' choice--missed';
                    } else if (isSelected(index)) {
                        stateClass = 'choice--wrong';
                    }
                    stateClass += ' choice--disabled';
                } else if (isSelected(index)) {
                    stateClass = 'choice--selected';
                }
            } else if (hasAnswered) {
                if (index === correctIdx) stateClass = 'choice--correct';
                else if (index === answered) stateClass = 'choice--wrong';
                stateClass += ' choice--disabled';
            }

            return `
                <div class="choice ${stateClass}" 
                     onclick="selectChoice('${q.id}', ${index})"
                     data-index="${index}">
                    <span class="choice__letter">${letters[index]}</span>
                    <span class="choice__text">${escapeHtml(text)}</span>
                </div>
            `;
        }).join('');

        const multiHintHtml = isMulti && !hasAnswered
            ? '<p class="question-card__hint">Select all that apply.</p>'
            : '';

        const submitHtml = isMulti && !hasAnswered
            ? `<button class="btn btn--primary btn--small question-card__submit"
                       onclick="submitMultiAnswer('${q.id}')"
                       ${selectedIndexes.length ? '' : 'disabled'}>
                   Check answer
               </button>`
            : '';

        let resultHtml = '';
        if (hasAnswered) {
            if (isMulti) {
                const correctAnswerText = correctIndexes.map(index => letters[index]).join(', ');
                if (isFullyCorrect) {
                    resultHtml = '<span class="question-card__result question-card__result--correct">&#10003; Correct</span>';
                } else if (isPartial) {
                    resultHtml = `<span class="question-card__result question-card__result--partial">&#9680; Partially correct &mdash; Answers: ${correctAnswerText}</span>`;
                } else {
                    resultHtml = `<span class="question-card__result question-card__result--wrong">&#10007; Wrong &mdash; Answers: ${correctAnswerText}</span>`;
                }
            } else {
                resultHtml = answered === correctIdx
                    ? '<span class="question-card__result question-card__result--correct">&#10003; Correct</span>'
                    : `<span class="question-card__result question-card__result--wrong">&#10007; Wrong &mdash; Answer: ${letters[correctIdx]}</span>`;
            }
        }

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
                        ${isRetry ? '<span class="question-card__retry-badge">&#8635; Retry</span>' : ''}
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
                ${multiHintHtml}
                <div class="question-card__choices">
                    ${choicesHtml}
                </div>
                ${submitHtml}
                ${resultHtml}
                ${explanationHtml}
            </article>
        `;
    }).join('');

    // List height just changed; re-evaluate the floating scroll buttons.
    refreshScrollButtons();
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
    // Changing a filter exits daily set mode.
    setDailyActive(false);

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
    const question = allQuestions.find(q => q.id === id);
    if (!question) return;

    const correctIndexes = getCorrectIndexes(question);

    if (correctIndexes.length > 1) {
        // Multi-answer: toggle the selection until the user submits.
        if (progress[id]?.answered !== undefined) return;

        const selected = pendingSelections.get(id) || new Set();
        if (selected.has(chosenIndex)) {
            selected.delete(chosenIndex);
        } else {
            selected.add(chosenIndex);
        }

        if (selected.size) {
            pendingSelections.set(id, selected);
        } else {
            pendingSelections.delete(id);
        }

        renderQuestions(filteredQuestions);
        return;
    }

    if (!progress[id]) progress[id] = {};
    // Don't allow re-answering
    if (progress[id].answered !== undefined) return;

    const correctIdx = correctIndexes[0] ?? 0;
    const today = new Date().toISOString().split('T')[0];
    progress[id].answered = chosenIndex;

    if (chosenIndex === correctIdx) {
        // Correct: mark complete and clear any "wrong" tracking.
        progress[id].completed = true;
        progress[id].completedDate = today;
        delete progress[id].wrongDate;
    } else {
        // Wrong: remember the day so it can be prioritized in a later daily set.
        progress[id].wrongDate = today;
    }

    saveProgress();
    // Re-render just this card for instant feedback
    renderQuestions(filteredQuestions);
    updateStats();
};

window.submitMultiAnswer = function (id) {
    const question = allQuestions.find(q => q.id === id);
    if (!question) return;

    const correctIndexes = getCorrectIndexes(question);
    if (correctIndexes.length <= 1) return;
    if (progress[id]?.answered !== undefined) return;

    const selected = [...(pendingSelections.get(id) || [])].sort((a, b) => a - b);
    if (!selected.length) return;

    const today = new Date().toISOString().split('T')[0];
    const isCorrect =
        selected.length === correctIndexes.length &&
        selected.every((index, i) => index === correctIndexes[i]);

    if (!progress[id]) progress[id] = {};
    progress[id].answered = selected;

    if (isCorrect) {
        progress[id].completed = true;
        progress[id].completedDate = today;
        delete progress[id].wrongDate;
    } else {
        progress[id].completed = false;
        delete progress[id].completedDate;
        progress[id].wrongDate = today;
    }

    pendingSelections.delete(id);
    saveProgress();
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

function generateDailySet(forceNew = false) {
    const size = getDailySetSize();
    const today = new Date().toISOString().split('T')[0];
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_SET) || '{}');

    // Reuse today's set only if it matches the current size and we're not forcing a new one.
    if (!forceNew && stored.date === today && stored.size === size && stored.ids) {
        const dailyQuestions = stored.ids
            .map(id => allQuestions.find(q => q.id === id))
            .filter(Boolean);

        if (dailyQuestions.length > 0) {
            filteredQuestions = dailyQuestions;
            renderQuestions(filteredQuestions);
            updateProgressBar();
            setDailyActive(true);
            return;
        }
    }

    // Wrong-answer questions are reset once per day at app start via
    // maybeResetWrongAnswersForNewDay(), which unlocks them but keeps `wrongDate`.
    // Build the set with those retry questions FIRST, then fill with unseen ones.
    const isRetry = q => progress[q.id]?.wrongDate && !progress[q.id]?.completed;

    const retry = allQuestions.filter(isRetry);
    const unseen = allQuestions.filter(q => !isRetry(q) && !progress[q.id]?.completed);

    const shuffledRetry = [...retry].sort(() => Math.random() - 0.5);
    const shuffledUnseen = [...unseen].sort(() => Math.random() - 0.5);

    // Retry questions first (guaranteed), then unseen, capped at the set size.
    let dailySet = [...shuffledRetry, ...shuffledUnseen].slice(0, size);

    // If everything is completed, fall back to a random slice of all questions.
    if (dailySet.length === 0) {
        dailySet = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, size);
    }

    // Save for today
    localStorage.setItem(STORAGE_KEYS.DAILY_SET, JSON.stringify({
        date: today,
        size,
        ids: dailySet.map(q => q.id),
    }));

    filteredQuestions = dailySet;
    renderQuestions(filteredQuestions);
    updateProgressBar();
    setDailyActive(true);
}

// Recompute floating scroll-button visibility (page height changes when the
// question list re-renders). Fires the same handler the scroll listener uses.
function refreshScrollButtons() {
    window.dispatchEvent(new Event('scroll'));
}

// Exit daily set mode and restore the full filtered list.
function exitDailySet() {
    setDailyActive(false);
    applyFilters();
}

// Set the daily-active state and sync the button's highlighted appearance.
function setDailyActive(active) {
    isDailyActive = active;
    if (elements.dailySetBtn) {
        elements.dailySetBtn.classList.toggle('btn--primary', active);
        elements.dailySetBtn.classList.toggle('btn--secondary', !active);
        elements.dailySetBtn.classList.remove('btn--active');
        const size = getDailySetSize();
        elements.dailySetBtn.innerHTML = active
            ? `&#10006; Daily Set (${size})`
            : `&#127919; Daily Set (${size})`;
    }
}

// Clear the "answered" state for questions that were answered incorrectly
// (answered but not completed). This lets the user retry them on a new day
// while keeping correctly-completed questions locked. Bookmarks and completed
// state are preserved.
function resetWrongAnswers() {
    let changed = false;
    for (const id in progress) {
        if (id === SETTINGS_KEY) continue;
        const p = progress[id];
        if (!p || typeof p !== 'object') continue;
        // Wrong = an answer was chosen but the question isn't marked completed.
        // Clear the chosen answer so it's answerable again, but keep `wrongDate`
        // so the daily set can still prioritize it as a question to retry.
        if (p.answered !== undefined && !p.completed) {
            delete p.answered;
            changed = true;
        }
    }
    if (changed) saveProgress();
}

function resetProgress() {
    if (!confirm('Reset all progress? This cannot be undone.')) return;
    // Keep user settings (e.g. daily-set size); only clear question progress.
    const keptSettings = getSettings();
    progress = {};
    if (Object.keys(keptSettings).length) progress[SETTINGS_KEY] = keptSettings;
    saveProgress();
    localStorage.removeItem(STORAGE_KEYS.DAILY_SET);
    pendingSelections.clear();
    applyFilters();
    updateStats();
}

// ===== Settings (synced via the progress gist under a reserved key) =====
const SETTINGS_KEY = '__settings';
const DEFAULT_DAILY_SIZE = 10;

function getSettings() {
    return (progress && progress[SETTINGS_KEY]) || {};
}

function getDailySetSize() {
    const s = getSettings().dailySetSize;
    return [10, 15, 20].includes(s) ? s : DEFAULT_DAILY_SIZE;
}

function setDailySetSize(size) {
    if (!progress[SETTINGS_KEY]) progress[SETTINGS_KEY] = {};
    progress[SETTINGS_KEY].dailySetSize = size;
    saveProgress(); // persists locally + pushes to gist when logged in
}

// Reflect the current size in the dropdown + button label.
function updateDailySetUI() {
    const size = getDailySetSize();
    if (elements.dailySetSize) elements.dailySetSize.value = String(size);
    if (elements.dailySetBtn) {
        elements.dailySetBtn.innerHTML = isDailyActive
            ? `&#10006; Daily Set (${size})`
            : `&#127919; Daily Set (${size})`;
    }
}

// ===== Progress & Stats =====
function loadProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROGRESS) || '{}');
    } catch {
        return {};
    }
}

function saveProgress({ push = true } = {}) {
    // Instant local write (offline cache + fallback).
    localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progress));

    // If logged in, push to the gist (debounced).
    if (push && isLoggedIn()) {
        setSyncStatus('saving');
        schedulePush(
            () => progress,
            (err) => setSyncStatus(err ? 'error' : 'synced')
        );
    }
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

// Load questions from a CSV file the user picks from their own computer.
// Uses FileReader so it works even when opened via file:// (no server needed).
function handleCsvUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    pendingSelections.clear();
    showLoading(true);
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const parsed = parseCSV(e.target.result);
            if (parsed.length === 0) {
                showError('No questions found in that CSV. Check the header row: id, topic, difficulty, question, choice_a, choice_b, choice_c, choice_d, correct, explanation.');
                showLoading(false);
                return;
            }
            // Switch off any Google Sheet source so this upload is what's shown.
            localStorage.removeItem(STORAGE_KEYS.SHEET_URL);
            elements.sheetUrl.value = '';

            allQuestions = parsed;
            finalizeQuestionsLoad();
            showLoading(false);
        } catch (err) {
            console.error('Failed to parse uploaded CSV:', err);
            showError('Could not read that CSV file. Check the format and try again.');
            showLoading(false);
        }
    };

    reader.onerror = () => {
        showError('Could not read the selected file.');
        showLoading(false);
    };

    reader.readAsText(file);
    // Reset so selecting the same file again still fires "change".
    event.target.value = '';
}

// ===== Auth & Sync =====
function updateAuthUI() {
    const configured = isSyncConfigured();
    const loggedIn = isLoggedIn();
    const user = getUser();

    if (elements.loginBtn) {
        // Hide login entirely if sync isn't set up yet.
        elements.loginBtn.style.display = !configured || loggedIn ? 'none' : '';
        elements.loginBtn.disabled = !configured;
    }
    if (elements.authUser) {
        elements.authUser.style.display = loggedIn ? 'flex' : 'none';
    }
    if (loggedIn && user) {
        if (elements.authAvatar) {
            elements.authAvatar.src = user.avatar_url || '';
            elements.authAvatar.alt = user.login || 'user';
        }
        if (elements.authName) {
            elements.authName.textContent = user.name || user.login || 'GitHub user';
        }
    }
    if (!configured) {
        setSyncStatus('unconfigured');
    } else if (loggedIn) {
        setSyncStatus('synced');
    } else {
        setSyncStatus('local');
    }
}

function setSyncStatus(state) {
    if (!elements.syncStatus) return;
    const map = {
        unconfigured: '',
        local: '&#128421;&#65039; Local only (not signed in)',
        saving: '&#8635; Syncing\u2026',
        synced: '&#9989; Synced to GitHub',
        error: '&#9888;&#65039; Sync failed \u2014 saved locally',
        pulling: '&#8635; Loading your progress\u2026',
    };
    elements.syncStatus.innerHTML = map[state] ?? '';
    elements.syncStatus.dataset.state = state;
}

// Pull remote progress and merge it into local state.
async function syncPull(justLoggedIn) {
    setSyncStatus('pulling');
    try {
        const remote = await pullProgress();

        // Remote is the source of truth on load. If it already has progress, adopt it
        // as-is and DO NOT push local back up — this prevents a device with stale local
        // data from clobbering newer progress that was synced from another device.
        const remoteHasProgress = remote && hasRealProgress(remote);

        if (remoteHasProgress) {
            progress = remote;
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progress));
        } else {
            // Remote is empty (new account). Seed it from whatever is local, so a
            // first-time login doesn't lose work already done offline on this device.
            const localHasProgress = hasRealProgress(progress);
            localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progress));
            if (localHasProgress) {
                schedulePush(() => progress, (err) => setSyncStatus(err ? 'error' : 'synced'));
            }
        }

        pendingSelections.clear();
        migrateLegacyAnswerShapes();
        updateDailySetUI();
        applyFilters();
        updateStats();
        setSyncStatus('synced');
    } catch (e) {
        console.warn('Initial sync pull failed:', e);
        setSyncStatus('error');
    }
}

// True if the progress object has at least one real question entry
// (ignores the reserved __settings key).
function hasRealProgress(p) {
    if (!p) return false;
    return Object.keys(p).some((k) => k !== '__settings');
}

function handleLogin() {
    login();
}

function handleLogout() {
    logout();
    clearGistCache();
    updateAuthUI();
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
    elements.dailySetBtn.addEventListener('click', () => {
        if (isDailyActive) {
            exitDailySet();
        } else {
            generateDailySet();
        }
    });
    if (elements.dailySetSize) {
        elements.dailySetSize.addEventListener('change', (e) => {
            const size = parseInt(e.target.value, 10) || DEFAULT_DAILY_SIZE;
            setDailySetSize(size);
            updateDailySetUI();
            generateDailySet(true); // regenerate with the new size
        });
    }
    elements.resetProgressBtn.addEventListener('click', resetProgress);
    elements.saveConfigBtn.addEventListener('click', saveConfig);
    if (elements.uploadCsvBtn && elements.csvFileInput) {
        elements.uploadCsvBtn.addEventListener('click', () => elements.csvFileInput.click());
        elements.csvFileInput.addEventListener('change', handleCsvUpload);
    }
    if (elements.loginBtn) elements.loginBtn.addEventListener('click', handleLogin);
    if (elements.logoutBtn) elements.logoutBtn.addEventListener('click', handleLogout);
    if (elements.leaderboardRefreshBtn) {
        elements.leaderboardRefreshBtn.addEventListener('click', loadLeaderboard);
    }
    if (elements.leaderboardToggleBtn) {
        elements.leaderboardToggleBtn.addEventListener('click', () => {
            const collapsed = elements.leaderboardSection.classList.toggle('is-collapsed');
            const chevron = document.getElementById('leaderboardChevron');
            if (chevron) chevron.style.transform = collapsed ? 'rotate(180deg)' : 'rotate(0deg)';
            elements.leaderboardToggleBtn.title = collapsed ? 'Expand' : 'Collapse';
        });
    }

    // Scroll helpers: show "back to top" once scrolled down, and "jump to
    // bottom" while near the top (handy for long question lists).
    if (elements.backToTopBtn || elements.jumpToBottomBtn) {
        const toggleScrollButtons = () => {
            const scrolledDown = window.scrollY > 400;
            // There's meaningful content below only if the page is tall enough.
            const canScrollDown =
                document.documentElement.scrollHeight - window.innerHeight - window.scrollY > 400;

            if (elements.backToTopBtn) {
                elements.backToTopBtn.classList.toggle('is-visible', scrolledDown);
            }
            if (elements.jumpToBottomBtn) {
                elements.jumpToBottomBtn.classList.toggle('is-visible', !scrolledDown && canScrollDown);
            }
        };

        window.addEventListener('scroll', toggleScrollButtons, { passive: true });
        window.addEventListener('resize', toggleScrollButtons, { passive: true });
        toggleScrollButtons();

        if (elements.backToTopBtn) {
            elements.backToTopBtn.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
        if (elements.jumpToBottomBtn) {
            elements.jumpToBottomBtn.addEventListener('click', () => {
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
            });
        }
    }
}

// ===== Leaderboard =====
async function loadLeaderboard() {
    if (!elements.leaderboardList) return;
    elements.leaderboardList.innerHTML = '<p class="leaderboard__empty">Loading...</p>';
    try {
        const board = await fetchLeaderboard();
        renderLeaderboard(board);
    } catch (e) {
        elements.leaderboardList.innerHTML =
            '<p class="leaderboard__empty">Could not load leaderboard.</p>';
    }
}

function renderLeaderboard(board) {
    if (!board || board.length === 0) {
        elements.leaderboardList.innerHTML =
            '<p class="leaderboard__empty">No entries yet — be the first to log in!</p>';
        return;
    }

    const rankEmoji = (i) => {
        if (i === 0) return '&#127947;';
        if (i === 1) return '&#129352;';
        if (i === 2) return '&#129353;';
        return `${i + 1}`;
    };

    const timeAgo = (iso) => {
        if (!iso) return '';
        const diff = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };

    elements.leaderboardList.innerHTML = board.map((entry, i) => `
        <div class="leaderboard__row">
            <span class="leaderboard__rank leaderboard__rank--${i + 1}">${rankEmoji(i)}</span>
            <img class="leaderboard__avatar"
                 src="${escapeHtml(entry.avatar || '')}"
                 alt="${escapeHtml(entry.username || '')}"
                 width="32" height="32"
                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><circle cx=%2216%22 cy=%2216%22 r=%2216%22 fill=%22%236366f1%22/></svg>'">
            <span class="leaderboard__name">${escapeHtml(entry.username || 'unknown')}</span>
            <div class="leaderboard__stats">
                <span class="leaderboard__completed">&#9989; ${entry.completed}</span>
                ${entry.needsRetry > 0
                    ? `<span class="leaderboard__retry">&#8635; ${entry.needsRetry}</span>`
                    : ''}
                <span class="leaderboard__updated">${timeAgo(entry.updated_at)}</span>
            </div>
        </div>
    `).join('');
}

// ===== Start =====
init();
loadLeaderboard();
