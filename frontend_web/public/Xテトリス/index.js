// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Xテトリス.js - サイバーテーマのテトリスゲーム

class CyberTetris {
    constructor() {
        // ボード設定
        this.BOARD_WIDTH = 10;
        this.BOARD_HEIGHT = 20;
        this.board = [];
        
        // ゲーム状態
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.gameRunning = false;
        this.gamePaused = false;
        this.gameOver = false;
        
        // 現在のピースと次のピース
        this.currentPiece = null;
        this.nextPiece = null;
        this.currentX = 0;
        this.currentY = 0;
        this.pieceLocked = false;
        
        // タイマー
        this.gameLoop = null;
        this.pendingTimers = [];
        this.dropSpeed = 1000; // 1秒
        
        // テトリスピースの定義（I, O, T, S, Z, J, L）
        this.pieces = {
            I: {
                shape: [
                    [[1, 1, 1, 1]],
                    [[1],
                     [1],
                     [1],
                     [1]]
                ],
                color: 'cyan'
            },
            O: {
                shape: [
                    [[1, 1],
                     [1, 1]]
                ],
                color: 'yellow'
            },
            T: {
                shape: [
                    [[0, 1, 0],
                     [1, 1, 1]],
                    [[1, 0],
                     [1, 1],
                     [1, 0]],
                    [[1, 1, 1],
                     [0, 1, 0]],
                    [[0, 1],
                     [1, 1],
                     [0, 1]]
                ],
                color: 'purple'
            },
            S: {
                shape: [
                    [[0, 1, 1],
                     [1, 1, 0]],
                    [[1, 0],
                     [1, 1],
                     [0, 1]]
                ],
                color: 'green'
            },
            Z: {
                shape: [
                    [[1, 1, 0],
                     [0, 1, 1]],
                    [[0, 1],
                     [1, 1],
                     [1, 0]]
                ],
                color: 'red'
            },
            J: {
                shape: [
                    [[1, 0, 0],
                     [1, 1, 1]],
                    [[1, 1],
                     [1, 0],
                     [1, 0]],
                    [[1, 1, 1],
                     [0, 0, 1]],
                    [[0, 1],
                     [0, 1],
                     [1, 1]]
                ],
                color: 'blue'
            },
            L: {
                shape: [
                    [[0, 0, 1],
                     [1, 1, 1]],
                    [[1, 0],
                     [1, 0],
                     [1, 1]],
                    [[1, 1, 1],
                     [1, 0, 0]],
                    [[1, 1],
                     [0, 1],
                     [0, 1]]
                ],
                color: 'orange'
            }
        };
        
        this.pieceTypes = Object.keys(this.pieces);
        this.pieceBag = []; // 7種1巡のバッグ方式用

        this.initializeGame();
        this.setupEventListeners();
    }
    
    initializeGame() {
        // ボードを初期化
        this.board = Array(this.BOARD_HEIGHT).fill().map(() => Array(this.BOARD_WIDTH).fill(null));
        
        // スコア等をリセット
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.gameRunning = false;
        this.gamePaused = false;
        this.gameOver = false;
        this.currentPiece = null;
        this.currentX = 0;
        this.currentY = 0;
        this.pieceLocked = false;
        this.dropSpeed = 1000;
        this.pieceBag = [];

        // 次のピースを生成
        this.nextPiece = this.generateRandomPiece();
        
        // ボードを描画
        this.renderBoard();
        this.renderNextPiece();
        this.updateUI();
    }
    
    setupEventListeners() {
        $('#start-btn').click(() => this.startGame());
        $('#pause-btn').click(() => this.pauseGame());
        $('#reset-btn').click(() => this.resetGame());
        
        // キーボード操作
        $(document).on('keydown', (e) => this.handleKeyPress(e));
        
        // ウィンドウリサイズ
        $(window).on('resize', () => this.handleResize());
        this.handleResize();
    }
    
    handleResize() {
        // リサイズ処理（必要に応じて）
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    
    generateRandomPiece() {
        // 7種1巡のバッグ方式（同じピースばかり続く偏りを防ぐ）
        if (this.pieceBag.length === 0) {
            this.pieceBag = [...this.pieceTypes];
            for (let i = this.pieceBag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.pieceBag[i], this.pieceBag[j]] = [this.pieceBag[j], this.pieceBag[i]];
            }
        }
        const randomType = this.pieceBag.pop();
        return {
            type: randomType,
            rotation: 0,
            shape: this.pieces[randomType].shape[0],
            color: this.pieces[randomType].color
        };
    }
    
    startGame() {
        if (this.gameOver) {
            this.resetGame();
        }
        
        if (!this.gameRunning) {
            this.gameRunning = true;
            this.gamePaused = false;
            this.spawnNewPiece();
            this.startGameLoop();
            $('#start-btn').text('RUNNING');
        }
    }
    
    pauseGame() {
        if (!this.gameRunning) return;
        
        this.gamePaused = !this.gamePaused;
        
        if (this.gamePaused) {
            this.stopGameLoop();
            $('#pause-btn').text('RESUME');
            this.showMessage('PAUSED', false);
        } else {
            this.startGameLoop();
            $('#pause-btn').text('PAUSE');
            this.hideMessage();
        }
    }
    
    resetGame() {
        this.stopGameLoop();
        this.clearPendingTimers();
        this.initializeGame();
        $('#start-btn').text('START');
        $('#pause-btn').text('PAUSE');
        this.hideMessage();
    }

    setManagedTimeout(callback, delay) {
        const timerId = setTimeout(() => {
            this.pendingTimers = this.pendingTimers.filter((id) => id !== timerId);
            callback();
        }, delay);
        this.pendingTimers.push(timerId);
        return timerId;
    }

    clearPendingTimers() {
        this.pendingTimers.forEach((timerId) => clearTimeout(timerId));
        this.pendingTimers = [];
    }
    
    spawnNewPiece() {
        if (!this.gameRunning || this.gameOver) return;
        this.pieceLocked = false;
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.generateRandomPiece();
        this.currentX = Math.floor(this.BOARD_WIDTH / 2) - Math.floor(this.currentPiece.shape[0].length / 2);
        this.currentY = 0;
        
        // ゲームオーバーチェック
        if (!this.canPlacePiece(this.currentX, this.currentY, this.currentPiece)) {
            this.endGame();
            return;
        }
        
        this.renderNextPiece();
        this.renderBoard();
    }
    
    startGameLoop() {
        this.stopGameLoop();
        this.gameLoop = setInterval(() => {
            if (!this.gamePaused && this.gameRunning) {
                this.movePieceDown();
            }
        }, this.dropSpeed);
    }
    
    stopGameLoop() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
    }
    
    handleKeyPress(e) {
        if (!this.gameRunning || this.gamePaused || this.gameOver) return;
        if (!this.currentPiece || this.pieceLocked) return;
        
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.movePieceLeft();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.movePieceRight();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.movePieceDown(true);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.rotatePiece();
                break;
            case ' ': // Space key for hard drop
                e.preventDefault();
                this.hardDrop();
                break;
        }
    }
    
    canPlacePiece(x, y, piece) {
        if (!piece) return false;
        const shape = piece.shape;
        
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col] === 1) {
                    const newX = x + col;
                    const newY = y + row;
                    
                    // 境界チェック
                    if (newX < 0 || newX >= this.BOARD_WIDTH || newY >= this.BOARD_HEIGHT) {
                        return false;
                    }
                    
                    // 上部の範囲外は許可（スポーン位置）
                    if (newY < 0) {
                        continue;
                    }
                    
                    // 既に配置されているブロックとの衝突チェック
                    if (this.board[newY][newX] !== null) {
                        return false;
                    }
                }
            }
        }
        
        return true;
    }
    
    movePieceLeft() {
        if (!this.currentPiece || this.pieceLocked) return;
        if (this.canPlacePiece(this.currentX - 1, this.currentY, this.currentPiece)) {
            this.currentX--;
            this.renderBoard();
        }
    }
    
    movePieceRight() {
        if (!this.currentPiece || this.pieceLocked) return;
        if (this.canPlacePiece(this.currentX + 1, this.currentY, this.currentPiece)) {
            this.currentX++;
            this.renderBoard();
        }
    }
    
    movePieceDown(isSoftDrop = false) {
        if (!this.currentPiece || this.pieceLocked) return;
        if (this.canPlacePiece(this.currentX, this.currentY + 1, this.currentPiece)) {
            this.currentY++;
            if (isSoftDrop) {
                this.score += 1; // ソフトドロップボーナス（1点/マス）
                this.updateUI();
            }
            this.renderBoard();
        } else {
            this.placePiece();
        }
    }

    hardDrop() {
        if (!this.currentPiece || this.pieceLocked) return;
        let dropCells = 0;
        while (this.canPlacePiece(this.currentX, this.currentY + 1, this.currentPiece)) {
            this.currentY++;
            dropCells++;
        }
        if (dropCells > 0) {
            this.score += dropCells * 2; // ハードドロップボーナス（2点/マス）
            this.updateUI();
        }
        this.renderBoard();
        this.placePiece();
    }
    
    rotatePiece() {
        if (!this.currentPiece || this.pieceLocked) return;
        const currentRotation = this.currentPiece.rotation;
        const pieceType = this.currentPiece.type;
        const rotations = this.pieces[pieceType].shape;
        const nextRotation = (currentRotation + 1) % rotations.length;
        
        const rotatedPiece = {
            ...this.currentPiece,
            rotation: nextRotation,
            shape: rotations[nextRotation]
        };
        
        // 回転後の位置チェック（壁蹴り処理を含む）
        let newX = this.currentX;
        let newY = this.currentY;
        
        // 基本位置で配置可能かチェック
        if (this.canPlacePiece(newX, newY, rotatedPiece)) {
            this.currentPiece = rotatedPiece;
            this.renderBoard();
            return;
        }
        
        // 左右に調整してみる（壁蹴り）
        const adjustments = [-1, 1, -2, 2];
        for (const adj of adjustments) {
            if (this.canPlacePiece(newX + adj, newY, rotatedPiece)) {
                this.currentPiece = rotatedPiece;
                this.currentX = newX + adj;
                this.renderBoard();
                return;
            }
        }
        
        // 上に調整してみる
        if (this.canPlacePiece(newX, newY - 1, rotatedPiece)) {
            this.currentPiece = rotatedPiece;
            this.currentY = newY - 1;
            this.renderBoard();
        }
    }
    
    placePiece() {
        if (!this.currentPiece || this.pieceLocked) return;
        this.pieceLocked = true;
        const shape = this.currentPiece.shape;
        const color = this.currentPiece.color;
        
        // ボードにピースを固定
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col] === 1) {
                    const boardX = this.currentX + col;
                    const boardY = this.currentY + row;
                    
                    if (boardY >= 0 && boardX >= 0 && boardX < this.BOARD_WIDTH && boardY < this.BOARD_HEIGHT) {
                        this.board[boardY][boardX] = color;
                    }
                }
            }
        }
        
        // パーティクルエフェクト
        this.createPlaceEffect();
        
        const linesToClear = this.findCompletedLines();
        const clearedLines = linesToClear.length;
        
        // スコア更新
        this.updateScore(clearedLines);

        this.currentPiece = null;
        this.renderBoard();

        if (clearedLines > 0) {
            this.animateLineClear(linesToClear);
            this.setManagedTimeout(() => {
                if (!this.gameRunning || this.gameOver) return;
                this.removeCompletedLines(linesToClear);
                this.renderBoard();
                this.createClearEffect(clearedLines);
                this.setManagedTimeout(() => this.spawnNewPiece(), 100);
            }, 500);
        } else {
            this.setManagedTimeout(() => this.spawnNewPiece(), 100);
        }
    }
    
    findCompletedLines() {
        let linesToClear = [];
        
        // 完成した行を特定
        for (let row = this.BOARD_HEIGHT - 1; row >= 0; row--) {
            if (this.board[row].every(cell => cell !== null)) {
                linesToClear.push(row);
            }
        }
        return linesToClear;
    }

    removeCompletedLines(linesToClear) {
        const clearSet = new Set(linesToClear);
        const remainingRows = this.board.filter((_, rowIndex) => !clearSet.has(rowIndex));
        const emptyRows = Array.from(
            { length: linesToClear.length },
            () => Array(this.BOARD_WIDTH).fill(null)
        );
        this.board = [...emptyRows, ...remainingRows];
    }
    
    animateLineClear(lines) {
        lines.forEach(row => {
            for (let col = 0; col < this.BOARD_WIDTH; col++) {
                const cell = $(`.tetris-cell:eq(${row * this.BOARD_WIDTH + col})`);
                cell.addClass('clearing');
            }
        });
    }
    
    updateScore(clearedLines) {
        if (clearedLines > 0) {
            // スコア計算（テトリスの標準的な計算）
            const linePoints = [0, 100, 300, 500, 800];
            const points = linePoints[clearedLines] * this.level;
            this.score += points;
            this.lines += clearedLines;
            
            // レベルアップ（10行ごと）
            const newLevel = Math.floor(this.lines / 10) + 1;
            if (newLevel > this.level) {
                this.level = newLevel;
                this.dropSpeed = Math.max(100, 1000 - (this.level - 1) * 50);
                this.startGameLoop(); // 新しいスピードでループを再開
            }
            
            this.updateUI();
        }
    }
    
    createPlaceEffect() {
        const shape = this.currentPiece.shape;
        
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col] === 1) {
                    const boardX = this.currentX + col;
                    const boardY = this.currentY + row;
                    
                    if (boardY >= 0) {
                        this.createParticles(boardX, boardY);
                    }
                }
            }
        }
    }
    
    createClearEffect(lineCount) {
        const colors = ['#00ffff', '#ff00ff', '#ffff00', '#00ff00'];
        const particleCount = lineCount * 15;
        
        for (let i = 0; i < particleCount; i++) {
            setTimeout(() => {
                const particle = $('<div class="cyber-particle"></div>');
                particle.css({
                    left: Math.random() * window.innerWidth,
                    top: window.innerHeight * 0.3 + Math.random() * window.innerHeight * 0.4,
                    background: colors[Math.floor(Math.random() * colors.length)],
                    width: Math.random() * 8 + 4,
                    height: Math.random() * 8 + 4,
                    animationDuration: `${Math.random() * 1.5 + 1}s`
                });
                
                $('body').append(particle);
                
                setTimeout(() => {
                    particle.remove();
                }, 2000);
            }, i * 20);
        }
    }
    
    createParticles(x, y) {
        const boardElement = $('#tetris-board');
        const boardRect = boardElement[0].getBoundingClientRect();
        const cellWidth = boardRect.width / this.BOARD_WIDTH;
        const cellHeight = boardRect.height / this.BOARD_HEIGHT;
        
        for (let i = 0; i < 6; i++) {
            const particle = $('<div class="cyber-particle"></div>');
            const colors = ['#00ffff', '#ff00ff', '#ffff00'];
            
            particle.css({
                left: boardRect.left + (x + 0.5) * cellWidth + (Math.random() - 0.5) * cellWidth,
                top: boardRect.top + (y + 0.5) * cellHeight + (Math.random() - 0.5) * cellHeight,
                background: colors[Math.floor(Math.random() * colors.length)],
                animationDelay: `${Math.random() * 0.3}s`
            });
            
            $('body').append(particle);
            
            setTimeout(() => {
                particle.remove();
            }, 2000);
        }
    }
    
    renderBoard() {
        const boardElement = $('#tetris-board');
        boardElement.empty();
        
        // 全セルを生成
        for (let row = 0; row < this.BOARD_HEIGHT; row++) {
            for (let col = 0; col < this.BOARD_WIDTH; col++) {
                const cell = $('<div class="tetris-cell"></div>');
                
                // 固定されたピースを描画
                if (this.board[row][col] !== null) {
                    cell.addClass('filled').addClass(this.board[row][col]);
                }
                
                boardElement.append(cell);
            }
        }
        
        // 現在のピースを描画（ゴースト → 本体の順）
        if (this.currentPiece) {
            this.renderGhostPiece();
            this.renderCurrentPiece();
        }
    }

    renderGhostPiece() {
        // 落下予測位置（ゴーストピース）を描画
        let ghostY = this.currentY;
        while (this.canPlacePiece(this.currentX, ghostY + 1, this.currentPiece)) {
            ghostY++;
        }
        if (ghostY === this.currentY) return;

        const shape = this.currentPiece.shape;
        const color = this.currentPiece.color;

        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col] === 1) {
                    const boardX = this.currentX + col;
                    const boardY = ghostY + row;

                    if (boardY >= 0 && boardX >= 0 && boardX < this.BOARD_WIDTH && boardY < this.BOARD_HEIGHT) {
                        const cellIndex = boardY * this.BOARD_WIDTH + boardX;
                        $(`.tetris-cell:eq(${cellIndex})`).addClass('ghost').addClass(color);
                    }
                }
            }
        }
    }

    renderCurrentPiece() {
        const shape = this.currentPiece.shape;
        const color = this.currentPiece.color;
        
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col] === 1) {
                    const boardX = this.currentX + col;
                    const boardY = this.currentY + row;
                    
                    if (boardY >= 0 && boardX >= 0 && boardX < this.BOARD_WIDTH && boardY < this.BOARD_HEIGHT) {
                        const cellIndex = boardY * this.BOARD_WIDTH + boardX;
                        const cell = $(`.tetris-cell:eq(${cellIndex})`);
                        cell.removeClass('ghost').addClass('filled').addClass(color);
                    }
                }
            }
        }
    }
    
    renderNextPiece() {
        const nextElement = $('#next-piece');
        nextElement.empty();
        
        // 4x4グリッドを生成
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const cell = $('<div class="next-cell"></div>');
                nextElement.append(cell);
            }
        }
        
        if (this.nextPiece) {
            const shape = this.nextPiece.shape;
            const color = this.nextPiece.color;
            
            // 中央寄せのためのオフセット計算
            const offsetX = Math.floor((4 - shape[0].length) / 2);
            const offsetY = Math.floor((4 - shape.length) / 2);
            
            for (let row = 0; row < shape.length; row++) {
                for (let col = 0; col < shape[row].length; col++) {
                    if (shape[row][col] === 1) {
                        const cellIndex = (offsetY + row) * 4 + (offsetX + col);
                        const cell = $(`.next-cell:eq(${cellIndex})`);
                        cell.addClass('filled').addClass(color);
                    }
                }
            }
        }
    }
    
    updateUI() {
        $('#score').text(this.score.toLocaleString());
        $('#level').text(this.level);
        $('#lines').text(this.lines);
    }
    
    showMessage(text, isGameOver = false) {
        const message = $(`<div class="game-message${isGameOver ? ' game-over' : ''}">${text}</div>`);
        $('body').append(message);
        
        if (!isGameOver) {
            // 一時的なメッセージは3秒後に消す
            setTimeout(() => {
                message.remove();
            }, 3000);
        }
    }
    
    hideMessage() {
        $('.game-message').remove();
    }
    
    endGame() {
        this.gameRunning = false;
        this.gameOver = true;
        this.stopGameLoop();
        this.clearPendingTimers();
        this.currentPiece = null;
        this.pieceLocked = false;
        
        $('#start-btn').text('RESTART');
        
        this.showMessage(`GAME OVER<br>FINAL SCORE: ${this.score.toLocaleString()}`, true);
        this.createGameOverEffect();
    }
    
    createGameOverEffect() {
        // ゲームオーバー時のエフェクト
        for (let i = 0; i < 50; i++) {
            setTimeout(() => {
                const particle = $('<div class="cyber-particle"></div>');
                particle.css({
                    left: Math.random() * window.innerWidth,
                    top: Math.random() * window.innerHeight,
                    background: '#ff4757',
                    width: Math.random() * 10 + 6,
                    height: Math.random() * 10 + 6,
                    animationDuration: `${Math.random() * 2 + 1}s`
                });
                
                $('body').append(particle);
                
                setTimeout(() => {
                    particle.remove();
                }, 3000);
            }, i * 50);
        }
    }
}

// ゲーム開始
$(document).ready(function() {
    const game = new CyberTetris();
    
    // デバッグログ（必要時のみ）: サイバーテトリスシステム初期化完了
    // デバッグログ（必要時のみ）: ニューラルブロック組立システム起動中...
});
