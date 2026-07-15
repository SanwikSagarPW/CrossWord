document.addEventListener('DOMContentLoaded', () => {
    const ENABLE_DEV_COMPLETE_SHORTCUT = false;
    const CROSSWORD_MAX_TOTAL_XP = 200;

    // DOM Elements
    const gridElement = document.getElementById('crossword-grid');
    const acrossCluesElement = document.getElementById('across-clues');
    const downCluesElement = document.getElementById('down-clues');
    const titleElement = document.getElementById('puzzle-title');
    const levelElement = document.getElementById('puzzle-level');
    const checkButton = document.getElementById('check-btn');
    const successOverlay = document.getElementById('success-overlay');
    const adminPanel = document.getElementById('admin-panel');
    const gameContainer = document.querySelector('.game-container');

    // State Management
    let currentPuzzleData = null;
    let gridState;
    let currentDirection = 'across';
    let activeClueInfo = null;
    let lastFocusedCell = { row: -1, col: -1 };

    // Analytics Setup
    const analytics = AnalyticsManager.getInstance();
    let analyticsRunId = '';
    let levelStartTime = 0;
    let checkAttempts = 0;
    let crosswordLevels = [];
    const submittedCrosswordLevels = new Set();

    function createRunId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }

        return `crossword_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function postAnalyticsDebug(event, detail = {}) {
        try {
            window.parent.postMessage({
                __analyticsDebug: true,
                game: 'CrossWord',
                event,
                detail,
                at: new Date().toISOString()
            }, '*');
        } catch (_error) {
            // Debug-only for local harness visibility.
        }
    }

    function getAnswerLevelXp(levelNumber, totalLevels) {
        const baseXp = Math.floor(CROSSWORD_MAX_TOTAL_XP / totalLevels);
        const extraXpLevels = CROSSWORD_MAX_TOTAL_XP % totalLevels;
        return baseXp + (levelNumber <= extraXpLevels ? 1 : 0);
    }

    function buildCrosswordLevels(clues) {
        const allClues = [...clues.across, ...clues.down];
        return allClues.map((clue, index) => ({
            clue,
            levelNumber: index + 1,
            xp: getAnswerLevelXp(index + 1, allClues.length)
        }));
    }

    function isClueSolved(clue) {
        const expectedAnswer = clue.answer.toUpperCase();
        for (let i = 0; i < expectedAnswer.length; i++) {
            const row = clue.direction === 'across' ? clue.row : clue.row + i;
            const col = clue.direction === 'across' ? clue.col + i : clue.col;
            const input = document.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"] input`);
            if (!input || input.value.toUpperCase() !== expectedAnswer[i]) {
                return false;
            }
        }

        return true;
    }

    function startAnalyticsLevel(metadata) {
        analyticsRunId = createRunId();
        submittedCrosswordLevels.clear();
        checkAttempts = 0;
        analytics.initialize('CrossWord', analyticsRunId);
        crosswordLevels.forEach(({ clue, levelNumber, xp }) => {
            analytics.startLevel(levelNumber, { levelNumber });
            analytics.addRawMetric(`level_${levelNumber}_answer`, clue.answer.toUpperCase());
            analytics.addRawMetric(`level_${levelNumber}_clue`, clue.clue);
            analytics.addRawMetric(`level_${levelNumber}_xp`, String(xp));
        });
        analytics.addRawMetric('puzzle_title', metadata.title);
        analytics.addRawMetric('puzzle_author', metadata.author || 'unknown');
        analytics.addRawMetric('answer_count', String(crosswordLevels.length));
        analytics.addRawMetric('max_total_xp', String(CROSSWORD_MAX_TOTAL_XP));
        levelStartTime = Date.now();
        console.log('[Analytics] Answer levels started:', { count: crosswordLevels.length, runId: analyticsRunId });
        postAnalyticsDebug('levels_started', { count: crosswordLevels.length, runId: analyticsRunId, title: metadata.title });
    }

    function submitAnswerLevel(levelInfo, metrics = {}) {
        const { clue, levelNumber, xp } = levelInfo;
        if (submittedCrosswordLevels.has(levelNumber)) {
            postAnalyticsDebug('submit_skipped_duplicate', { level: levelNumber, runId: analyticsRunId });
            return null;
        }

        Object.entries(metrics).forEach(([key, value]) => {
            analytics.addRawMetric(key, String(value));
        });
        const timeTaken = Date.now() - levelStartTime;
        analytics.endLevel(levelNumber, true, timeTaken, xp);
        analytics.recordTask(
            levelNumber,
            `answer_${levelNumber}`,
            clue.clue,
            clue.answer.toUpperCase(),
            clue.answer.toUpperCase(),
            timeTaken,
            xp
        );

        const payload = analytics.submitLevel(levelNumber, { runId: analyticsRunId });
        if (payload && payload.success === false) {
            console.error('[Analytics] Level submit rejected:', payload.errors);
            postAnalyticsDebug('submit_rejected', { level: levelNumber, runId: analyticsRunId, errors: payload.errors });
            return payload;
        }

        submittedCrosswordLevels.add(levelNumber);
        try {
            window.parent.postMessage(payload, '*');
        } catch (_error) {
            // Bridge already attempted delivery; this supports the local harness.
        }
        console.log('[Analytics] Answer level submitted:', { level: levelNumber, runId: analyticsRunId, xp, answer: clue.answer });
        postAnalyticsDebug('submit_success', { level: levelNumber, runId: analyticsRunId, xpEarned: xp, answer: clue.answer });
        return payload;
    }

    function submitCompletedAnswers(metrics = {}) {
        let submittedCount = 0;
        crosswordLevels.forEach(levelInfo => {
            if (!submittedCrosswordLevels.has(levelInfo.levelNumber) && isClueSolved(levelInfo.clue)) {
                submitAnswerLevel(levelInfo, metrics);
                submittedCount++;
            }
        });

        return submittedCount;
    }

    function getSubmittedXpTotal() {
        return crosswordLevels.reduce((total, levelInfo) => {
            return total + (submittedCrosswordLevels.has(levelInfo.levelNumber) ? levelInfo.xp : 0);
        }, 0);
    }

    // --- GAME FLOW & INITIALIZATION ---

    async function startGame() {
        try {
            const response = await fetch('puzzle.json');
            currentPuzzleData = await response.json();
            crosswordLevels = buildCrosswordLevels(currentPuzzleData.clues);
            initializeGame();
        } catch(error) {
            console.error("Failed to start game:", error);
            alert("Could not load the initial puzzle. Please check puzzle.json and refresh.");
        }
    }

    function initializeGame() {
        lastFocusedCell = { row: -1, col: -1 };
        currentDirection = 'across';
        checkAttempts = 0;
        try {
            const { metadata, clues } = currentPuzzleData;
            const { rows, cols } = metadata.size;
            titleElement.textContent = metadata.title;
            levelElement.textContent = 'Level 1';
            gridState = Array(rows).fill(null).map(() => Array(cols).fill(null));
            gridElement.innerHTML = '';
            acrossCluesElement.innerHTML = '';
            downCluesElement.innerHTML = '';
            // Set CSS variables for grid dimensions
            gridElement.style.setProperty('--grid-rows', rows);
            gridElement.style.setProperty('--grid-cols', cols);
            populateGridState(clues.across);
            populateGridState(clues.down);
            renderGrid(rows, cols);
            renderClues(clues.across, acrossCluesElement, 'across');
            renderClues(clues.down, downCluesElement, 'down');

            // Start analytics tracking for this puzzle as level 1.
            startAnalyticsLevel(metadata);
        } catch (error) {
            console.error("CRITICAL ERROR building puzzle:", error);
            alert("A critical error occurred while building the puzzle.");
        }
    }

    // --- GRID & CLUE RENDERING ---

    function populateGridState(clueList) {
        clueList.forEach(clue => {
            const answer = clue.answer.toUpperCase();
            for (let i = 0; i < answer.length; i++) {
                const r = clue.direction === 'across' ? clue.row : clue.row + i;
                const c = clue.direction === 'across' ? clue.col + i : clue.col;
                if (!gridState[r][c]) {
                    gridState[r][c] = { answer: '', words: [] };
                }
                gridState[r][c].answer = answer[i];
                if (!gridState[r][c].words.some(w => w.number === clue.number && w.direction === clue.direction)) {
                    gridState[r][c].words.push({ number: clue.number, direction: clue.direction });
                }
                if (i === 0) gridState[r][c].clueNumber = clue.number;
            }
        });
    }

    function renderGrid(rows, cols) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cellData = gridState[r][c];
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                
                const devCoords = document.createElement('div');
                devCoords.className = 'dev-coords';
                devCoords.textContent = `${r},${c}`;
                cell.appendChild(devCoords);

                if (!cellData) {
                    cell.classList.add('empty');
                } else {
                    const devAnswer = document.createElement('div');
                    devAnswer.className = 'dev-answer';
                    devAnswer.textContent = cellData.answer;
                    cell.appendChild(devAnswer);

                    if (cellData.clueNumber) {
                        const numDiv = document.createElement('div');
                        numDiv.className = 'clue-number';
                        numDiv.textContent = cellData.clueNumber;
                        cell.appendChild(numDiv);
                    }
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.maxLength = 1;
                    input.className = 'cell-input';
                    input.dataset.answer = cellData.answer.toUpperCase();
                    input.addEventListener('input', handleCellInput);
                    input.addEventListener('focus', () => handleFocus(r, c));
                    input.addEventListener('keydown', handleKeyDown);
                    cell.appendChild(input);
                }
                gridElement.appendChild(cell);
            }
        }
    }

    function renderClues(clueList, listElement, direction) {
        clueList.forEach(clue => {
            const li = document.createElement('li');
            li.textContent = clue.number + '. ' + clue.clue;
            li.dataset.number = clue.number;
            li.dataset.direction = direction;
            li.addEventListener('click', handleClueClick);
            listElement.appendChild(li);
        });
    }

    // --- USER INPUT & INTERACTION ---

    function handleCellInput(e) {
        e.target.value = e.target.value.toUpperCase();
        if (e.target.value.length === 0) return;
        if (activeClueInfo) {
            const { row: startRow, col: startCol, answer } = activeClueInfo;
            const currentCellPos = e.target.parentElement.dataset;
            let currentWordIndex = (currentDirection === 'across')
                ? parseInt(currentCellPos.col) - startCol
                : parseInt(currentCellPos.row) - startRow;
            for (let i = currentWordIndex + 1; i < answer.length; i++) {
                const r = (currentDirection === 'across') ? startRow : startRow + i;
                const c = (currentDirection === 'across') ? startCol + i : startCol;
                const nextCell = document.querySelector(`.grid-cell[data-row="${r}"][data-col="${c}"]`);
                if (nextCell) {
                    const nextInput = nextCell.querySelector('input');
                    if (nextInput && nextInput.value === '' && !nextInput.readOnly) {
                        nextInput.focus();
                        return;
                    }
                }
            }
        }
    }

    function handleKeyDown(e) {
        const cell = e.target.parentElement;
        let { row, col } = cell.dataset;
        row = parseInt(row);
        col = parseInt(col);
        if (e.key === 'Backspace') {
            e.preventDefault();
            if (e.target.value !== '') {
                e.target.value = '';
                return;
            }
            if (activeClueInfo) {
                const isAtStart = (currentDirection === 'across' && col === activeClueInfo.col) ||
                                (currentDirection === 'down' && row === activeClueInfo.row);
                if (isAtStart) return;
            }
            let prevR = row, prevC = col;
            if (currentDirection === 'across') prevC--;
            else prevR--;
            const prevCell = document.querySelector(`.grid-cell[data-row="${prevR}"][data-col="${prevC}"]`);
            if (prevCell && prevCell.querySelector('input')) prevCell.querySelector('input').focus();
            return;
        }
        let nextR = row, nextC = col;
        switch (e.key) {
            case 'ArrowUp': nextR--; break;
            case 'ArrowDown': nextR++; break;
            case 'ArrowLeft': nextC--; break;
            case 'ArrowRight': nextC++; break;
            default: return;
        }
        const nextCell = document.querySelector(`.grid-cell[data-row="${nextR}"][data-col="${nextC}"]`);
        if (nextCell && nextCell.querySelector('input')) {
            e.preventDefault();
            nextCell.querySelector('input').focus();
        }
    }
    
    function handleFocus(row, col) {
        const cellData = gridState[row][col];
        if (!cellData) return;
        const hasAcross = cellData.words.some(w => w.direction === 'across');
        const hasDown = cellData.words.some(w => w.direction === 'down');
        if (lastFocusedCell.row === row && lastFocusedCell.col === col) {
            if (hasAcross && hasDown) {
                currentDirection = currentDirection === 'across' ? 'down' : 'across';
            }
        } else {
            const isCurrentDirectionValid = (currentDirection === 'across' && hasAcross) ||
                                            (currentDirection === 'down' && hasDown);
            if (!isCurrentDirectionValid) {
                currentDirection = hasAcross ? 'across' : 'down';
            }
        }
        lastFocusedCell = { row, col };
        highlightWord(row, col, currentDirection);
    }

    function handleClueClick(e) {
        const { number, direction } = e.target.dataset;
        const clue = currentPuzzleData.clues[direction].find(c => c.number == number);
        if (clue) {
            currentDirection = direction;
            const firstCellInput = document.querySelector(`.grid-cell[data-row="${clue.row}"][data-col="${clue.col}"] input`);
            if (firstCellInput) firstCellInput.focus();
        }
    }

    function highlightWord(row, col, direction) {
        document.querySelectorAll('.focused-word, li.highlighted').forEach(el => el.classList.remove('highlighted', 'focused-word'));
        const cellData = gridState[row][col];
        if (!cellData) return;
        const wordInfo = cellData.words.find(w => w.direction === direction);
        if (!wordInfo) return;
        activeClueInfo = currentPuzzleData.clues[direction].find(c => c.number === wordInfo.number);
        if (!activeClueInfo) return;
        document.querySelector(`li[data-number="${activeClueInfo.number}"][data-direction="${direction}"]`)?.classList.add('highlighted');
        const answerLength = activeClueInfo.answer.length;
        for (let i = 0; i < answerLength; i++) {
            const r = direction === 'across' ? activeClueInfo.row : activeClueInfo.row + i;
            const c = direction === 'across' ? activeClueInfo.col + i : activeClueInfo.col;
            document.querySelector(`.grid-cell[data-row="${r}"][data-col="${c}"]`)?.classList.add('focused-word');
        }
    }

    // --- PUZZLE CHECKING ---

    function checkPuzzle() {
        const inputs = document.querySelectorAll('.cell-input');
        let allCorrect = true;
        let correctCount = 0;
        let incorrectCount = 0;
        let emptyCount = 0;
        
        checkAttempts++;
        
        inputs.forEach(input => {
            input.classList.remove('correct', 'incorrect');
            const enteredValue = input.value.toUpperCase();
            const correctValue = input.dataset.answer;
            if (enteredValue) {
                if (enteredValue === correctValue) {
                    input.classList.add('correct');
                    input.readOnly = true;
                    correctCount++;
                } else {
                    allCorrect = false;
                    input.classList.add('incorrect');
                    input.readOnly = false;
                    incorrectCount++;
                }
            } else {
                allCorrect = false;
                input.readOnly = false;
                emptyCount++;
            }
        });

        // Track this check attempt as a task
        const totalCells = inputs.length;
        const accuracy = totalCells > 0 ? (correctCount / totalCells * 100).toFixed(1) : 0;
        
        console.log('[Analytics] Check attempt #' + checkAttempts, {
            correct: correctCount,
            incorrect: incorrectCount,
            empty: emptyCount,
            accuracy: accuracy + '%'
        });
        
        const submitMetrics = {
            check_attempts: checkAttempts,
            accuracy_percent: accuracy,
            correct_cells: correctCount,
            incorrect_cells: incorrectCount,
            empty_cells: emptyCount
        };
        const newlySubmittedAnswers = submitCompletedAnswers(submitMetrics);
        console.log('[Analytics] Newly completed answers submitted:', newlySubmittedAnswers);
        
        if (allCorrect) {
            const totalXP = getSubmittedXpTotal();
            
            console.log('[Analytics] Puzzle completed!', {
                totalXP: totalXP,
                maxTotalXP: CROSSWORD_MAX_TOTAL_XP
            });
            successOverlay.classList.remove('hidden');
        } else {
            alert('Not quite right! The incorrect cells are marked in red.');
        }
    }

    // --- SECRET CODES & EVENT LISTENERS ---

    let keySequence = "";
    const adminCode = "~asd";
    const devCode = "~dev";
    const devAnswersCode = "~adev";
    const stopDevCode = "~sdev";

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const key = (e.key === '`' || e.key === '~') ? '~' : e.key.toLowerCase();
        keySequence += key;

        if (keySequence.endsWith(adminCode)) {
            adminPanel.classList.toggle('hidden');
            keySequence = "";
        } else if (keySequence.endsWith(devAnswersCode)) {
            gameContainer.classList.add('dev-mode', 'dev-answers-mode');
            keySequence = "";
        } else if (keySequence.endsWith(devCode)) {
            gameContainer.classList.toggle('dev-mode');
            gameContainer.classList.remove('dev-answers-mode');
            keySequence = "";
        } else if (keySequence.endsWith(stopDevCode)) {
            gameContainer.classList.remove('dev-mode', 'dev-answers-mode');
            keySequence = "";
        }

        if (keySequence.length > 10) {
            keySequence = "";
        }
    });

    checkButton.addEventListener('click', checkPuzzle);

    function completeCurrentPuzzleForTest() {
        if (!ENABLE_DEV_COMPLETE_SHORTCUT) {
            console.log('DEV: Auto-complete ignored because debug shortcut is disabled.');
            return;
        }

        const inputs = document.querySelectorAll('.cell-input');
        if (!inputs.length) {
            console.log('DEV: Auto-complete ignored because puzzle inputs are not ready.');
            return;
        }

        inputs.forEach(input => {
            input.value = input.dataset.answer || '';
            input.readOnly = false;
        });
        console.log('DEV: Auto-completing crossword puzzle...');
        checkPuzzle();
    }

    window.__completeLevelForTest = completeCurrentPuzzleForTest;

    function handleDevCompleteKey(event) {
        if ((event.key && event.key.toLowerCase() === 'c') || event.code === 'KeyC') {
            if (event.__crosswordDevCompleteHandled) {
                return;
            }
            event.__crosswordDevCompleteHandled = true;
            event.preventDefault();
            completeCurrentPuzzleForTest();
        }
    }

    window.addEventListener('keydown', handleDevCompleteKey, true);
    document.addEventListener('keydown', handleDevCompleteKey, true);

    window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'DEV_COMPLETE_LEVEL') {
            completeCurrentPuzzleForTest();
        }
    });
    
    // Track incomplete sessions when user leaves
    window.addEventListener('beforeunload', () => {
        if (levelStartTime > 0 && submittedCrosswordLevels.size < crosswordLevels.length) {
            postAnalyticsDebug('session_ended_incomplete', {
                completedAnswers: submittedCrosswordLevels.size,
                totalAnswers: crosswordLevels.length
            });
        }
    });
    
    // Start Game
    startGame();
});