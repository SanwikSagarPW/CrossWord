document.addEventListener('DOMContentLoaded', () => {
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
    const analytics = new AnalyticsManager();
    analytics.initialize('crossword_puzzle', 'session_' + Date.now());
    let levelStartTime = 0;
    let currentLevelId = null;
    let checkAttempts = 0;

    // --- GAME FLOW & INITIALIZATION ---

    async function startGame() {
        try {
            const response = await fetch('puzzle.json');
            currentPuzzleData = await response.json();
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

            // Start analytics tracking for this level
            currentLevelId = 'level_' + metadata.title.toLowerCase().replace(/\s+/g, '_');
            analytics.startLevel(currentLevelId);
            levelStartTime = Date.now();
            console.log('[Analytics] Level started:', currentLevelId);
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
        
        analytics.recordTask(
            currentLevelId,
            'check_attempt_' + checkAttempts,
            `Check Puzzle Attempt #${checkAttempts}`,
            'all_correct',
            allCorrect ? 'all_correct' : 'has_errors',
            Date.now() - levelStartTime,
            allCorrect ? 50 : 10
        );
        
        // Add metrics
        analytics.addRawMetric('check_attempts', checkAttempts);
        analytics.addRawMetric('accuracy_percent', accuracy);
        analytics.addRawMetric('correct_cells', correctCount);
        analytics.addRawMetric('incorrect_cells', incorrectCount);
        analytics.addRawMetric('empty_cells', emptyCount);
        
        console.log('[Analytics] Metrics tracked:', analytics.getReportData().rawData);
        
        if (allCorrect) {
            const timeTaken = Date.now() - levelStartTime;
            const baseXP = 100;
            const timeBonus = Math.max(0, 50 - Math.floor(timeTaken / 10000)); // Bonus for speed
            const attemptBonus = Math.max(0, 50 - (checkAttempts - 1) * 10); // Bonus for fewer attempts
            const totalXP = baseXP + timeBonus + attemptBonus;
            
            console.log('[Analytics] Puzzle completed!', {
                timeTaken: (timeTaken / 1000).toFixed(2) + 's',
                baseXP: baseXP,
                timeBonus: timeBonus,
                attemptBonus: attemptBonus,
                totalXP: totalXP
            });
            
            analytics.endLevel(currentLevelId, true, timeTaken, totalXP);
            
            // Log full analytics report before submission
            console.log('[Analytics] Full Report:', analytics.getReportData());
            
            analytics.submitReport();
            
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
    
    // Track incomplete sessions when user leaves
    window.addEventListener('beforeunload', () => {
        if (currentLevelId && levelStartTime > 0) {
            const level = analytics._getLevelById(currentLevelId);
            if (level && !level.successful) {
                const timeTaken = Date.now() - levelStartTime;
                analytics.endLevel(currentLevelId, false, timeTaken, 0);
                analytics.submitReport();
                console.log('[Analytics] Session ended (incomplete)');
            }
        }
    });
    
    // Start Game
    startGame();
});