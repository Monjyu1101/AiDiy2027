// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Xリバーシ.js - エフェクト満載のリバーシゲーム

class ReversiGame {
    constructor() {
        this.board = [];
        this.currentPlayer = 'black'; // 'black' または 'white'
        this.gameOver = false;
        this.isThinking = false;
        this.lastMoveWasPass = false; // 前回のターンがパスかどうか
        
        // ボードサイズ
        this.BOARD_SIZE = 8;
        
        // 方向ベクトル（8方向）
        this.directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];
        
        this.initializeBoard();
        this.setupEventListeners();
        this.renderBoard();
        this.updateScore();
        this.showValidMoves();
    }
    
    initializeBoard() {
        // 8x8のボードを初期化
        this.board = Array(this.BOARD_SIZE).fill().map(() => Array(this.BOARD_SIZE).fill(null));
        
        // 初期配置
        const center = this.BOARD_SIZE / 2;
        this.board[center - 1][center - 1] = 'white';
        this.board[center - 1][center] = 'black';
        this.board[center][center - 1] = 'black';
        this.board[center][center] = 'white';
        
        this.currentPlayer = 'black';
        this.gameOver = false;
        this.lastMoveWasPass = false;
    }
    
    setupEventListeners() {
        $('#reset-btn').click(() => this.resetGame());
        $('#hint-btn').click(() => this.showHint());
        
        // ウィンドウリサイズイベント
        $(window).on('resize', () => this.handleResize());
        
        // 初期リサイズ実行
        this.handleResize();
    }
    
    // ウィンドウリサイズ処理
    handleResize() {
        // ビューポートの実際のサイズを取得
        const vh = window.innerHeight * 0.01;
        const vw = window.innerWidth * 0.01;
        
        // CSS変数として設定
        document.documentElement.style.setProperty('--vh', `${vh}px`);
        document.documentElement.style.setProperty('--vw', `${vw}px`);
        
        // ゲームコンテナの動的サイズ調整
        this.adjustGameContainerSize();
    }
    
    // ゲームコンテナサイズ動的調整
    adjustGameContainerSize() {
        const container = $('.game-container');
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // 縦長・横長の判定
        const isPortrait = windowHeight > windowWidth;
        
        // ブラウザUIを考慮した実用的なビューポート計算
        const usableHeight = windowHeight * (isPortrait ? 0.98 : 0.95);
        const usableWidth = windowWidth * (isPortrait ? 0.98 : 0.95);
        
        // 縦長画面と横長画面で異なる調整
        let containerWidth, containerHeight;
        
        if (isPortrait) {
            // 縦長画面（Portrait）の場合
            if (windowWidth >= 1000 && windowWidth <= 1200) {
                // 1080x1920のような縦長画面
                containerWidth = Math.min(usableWidth * 0.95, 1000);
                containerHeight = Math.min(usableHeight * 0.95, 1800);
            } else if (windowWidth >= 768) {
                // タブレット縦
                containerWidth = Math.min(usableWidth * 0.98, 700);
                containerHeight = Math.min(usableHeight * 0.98, 1000);
            } else {
                // モバイル縦
                containerWidth = usableWidth * 0.99;
                containerHeight = usableHeight * 0.99;
            }
        } else {
            // 横長画面（Landscape）の場合
            if (windowWidth >= 1400 && windowHeight >= 900) {
                // 大画面: より余裕を持たせる
                containerWidth = Math.min(usableWidth * 0.8, 800);
                containerHeight = Math.min(usableHeight * 0.85, 900);
            } else if (windowWidth >= 992) {
                // 中画面: バランス良く
                containerWidth = Math.min(usableWidth * 0.9, 700);
                containerHeight = Math.min(usableHeight * 0.9, 800);
            } else if (windowWidth >= 768) {
                // 小画面: より多くの面積を使用
                containerWidth = Math.min(usableWidth * 0.95, 600);
                containerHeight = Math.min(usableHeight * 0.95, 700);
            } else {
                // モバイル横: ほぼフルスクリーン
                containerWidth = usableWidth * 0.98;
                containerHeight = usableHeight * 0.98;
            }
        }
        
        // CSSで動的にサイズ設定
        container.css({
            'max-width': `${containerWidth}px`,
            'max-height': `${containerHeight}px`
        });
        
        // ボードサイズも調整
        this.adjustBoardSize(containerWidth, containerHeight, isPortrait);
    }
    
    // ボードサイズ動的調整
    adjustBoardSize(containerWidth, containerHeight, isPortrait = false) {
        const board = $('.board');
        
        // ヘッダー、情報パネル、コントロールの高さを概算
        const headerHeight = $('.game-header').outerHeight() || 80;
        const infoHeight = $('.game-info').outerHeight() || 60;
        const controlsHeight = $('.controls').outerHeight() || 60;
        const padding = 40; // 各種余白
        
        const availableHeight = containerHeight - headerHeight - infoHeight - controlsHeight - padding;
        const availableWidth = containerWidth - padding;
        
        // 縦長画面での特別処理
        let boardSize;
        if (isPortrait) {
            // 縦長画面では幅を基準にしつつ、高さも考慮してバランスよく配置
            const maxSizeByWidth = availableWidth * 0.9;
            const maxSizeByHeight = availableHeight * 0.9;
            boardSize = Math.min(maxSizeByWidth, maxSizeByHeight);
            
            // 最小・最大サイズ制約（縦長画面用）
            boardSize = Math.max(280, Math.min(boardSize, 600));
        } else {
            // 横長画面では従来の処理
            boardSize = Math.min(availableHeight, availableWidth, containerWidth * 0.8);
        }
        
        board.css({
            'width': `${boardSize}px`,
            'height': `${boardSize}px`,
            'max-width': `${boardSize}px`,
            'max-height': `${boardSize}px`
        });
    }
    
    renderBoard() {
        const boardElement = $('#game-board');
        boardElement.empty();
        
        for (let row = 0; row < this.BOARD_SIZE; row++) {
            for (let col = 0; col < this.BOARD_SIZE; col++) {
                const cell = $(`<div class="cell" data-row="${row}" data-col="${col}"></div>`);
                
                const piece = this.board[row][col];
                if (piece) {
                    const pieceElement = $(`<div class="piece ${piece}"></div>`);
                    cell.append(pieceElement);
                }
                
                cell.click(() => this.makeMove(row, col));
                boardElement.append(cell);
            }
        }
    }
    
    showValidMoves() {
        $('.cell').removeClass('valid-move valid-move-human valid-move-ai');
        $('.cell .flip-count').remove();

        if (this.gameOver || this.isThinking) return;

        // 手番の色に合わせてハイライトを色分け（HUMAN=シアン / A.I.=マゼンタ）
        const turnClass = this.currentPlayer === 'black' ? 'valid-move-human' : 'valid-move-ai';
        const validMoves = this.getValidMoves(this.currentPlayer);
        validMoves.forEach(([row, col]) => {
            const cell = $(`.cell[data-row="${row}"][data-col="${col}"]`);
            cell.addClass(`valid-move ${turnClass}`);

            // 人間の手番なら「裏返せる枚数」をバッジ表示（戦略の楽しさアップ）
            if (this.currentPlayer === 'black') {
                const count = this.evaluateMove(row, col, 'black');
                cell.append($(`<span class="flip-count">${count}</span>`));
            }
        });
    }
    
    getValidMoves(player) {
        const validMoves = [];
        
        for (let row = 0; row < this.BOARD_SIZE; row++) {
            for (let col = 0; col < this.BOARD_SIZE; col++) {
                if (this.isValidMove(row, col, player)) {
                    validMoves.push([row, col]);
                }
            }
        }
        
        return validMoves;
    }
    
    isValidMove(row, col, player) {
        if (this.board[row][col] !== null) return false;
        
        const opponent = player === 'black' ? 'white' : 'black';
        
        for (const [dr, dc] of this.directions) {
            let r = row + dr;
            let c = col + dc;
            let hasOpponent = false;
            
            while (r >= 0 && r < this.BOARD_SIZE && c >= 0 && c < this.BOARD_SIZE) {
                if (this.board[r][c] === opponent) {
                    hasOpponent = true;
                } else if (this.board[r][c] === player && hasOpponent) {
                    return true;
                } else {
                    break;
                }
                r += dr;
                c += dc;
            }
        }
        
        return false;
    }
    
    makeMove(row, col) {
        if (this.gameOver || this.isThinking || !this.isValidMove(row, col, this.currentPlayer)) {
            return;
        }
        
        // バッジとハイライトは手を打った瞬間に消す
        $('.cell').removeClass('valid-move valid-move-human valid-move-ai');
        $('.cell .flip-count').remove();

        this.placePiece(row, col, this.currentPlayer);
        this.flipPieces(row, col, this.currentPlayer);
        this.addPieceWithAnimation(row, col, this.currentPlayer);
        this.createParticleEffect(row, col);
        
        setTimeout(() => {
            this.updateScore();
            this.switchPlayer();
            
            if (this.checkGameOver()) {
                this.endGame();
            } else if (this.currentPlayer === 'white' && this.getValidMoves('white').length > 0) {
                // CPUの手番（打つ手がある場合のみ）
                setTimeout(() => this.cpuMove(), 1000);
            }
        }, 600);
    }
    
    placePiece(row, col, player) {
        this.board[row][col] = player;
    }
    
    flipPieces(row, col, player) {
        const opponent = player === 'black' ? 'white' : 'black';
        const toFlip = [];
        
        for (const [dr, dc] of this.directions) {
            const line = [];
            let r = row + dr;
            let c = col + dc;
            
            while (r >= 0 && r < this.BOARD_SIZE && c >= 0 && c < this.BOARD_SIZE) {
                if (this.board[r][c] === opponent) {
                    line.push([r, c]);
                } else if (this.board[r][c] === player) {
                    toFlip.push(...line);
                    break;
                } else {
                    break;
                }
                r += dr;
                c += dc;
            }
        }
        
        // 盤面データは即時更新（スコア計算・合法手判定・CPU思考を正しくするため）
        toFlip.forEach(([r, c]) => {
            this.board[r][c] = player;
        });

        // 見た目だけ順番にアニメーションさせる
        toFlip.forEach(([r, c], index) => {
            setTimeout(() => {
                this.animateFlip(r, c, player);
            }, index * 100);
        });
    }
    
    addPieceWithAnimation(row, col, player) {
        const cell = $(`.cell[data-row="${row}"][data-col="${col}"]`);
        const piece = $(`<div class="piece ${player} new"></div>`);
        cell.append(piece);
        
        setTimeout(() => {
            piece.removeClass('new');
        }, 500);
    }
    
    animateFlip(row, col, newPlayer) {
        const cell = $(`.cell[data-row="${row}"][data-col="${col}"]`);
        const piece = cell.find('.piece');
        
        piece.addClass('flip');
        
        setTimeout(() => {
            piece.removeClass('black white flip').addClass(newPlayer);
        }, 300);
        
        setTimeout(() => {
            piece.removeClass('flip');
        }, 600);
    }
    
    createParticleEffect(row, col) {
        const cell = $(`.cell[data-row="${row}"][data-col="${col}"]`);
        const cellOffset = cell.offset();
        const cellWidth = cell.width();
        const cellHeight = cell.height();
        
        for (let i = 0; i < 12; i++) {
            const particle = $('<div class="cyber-particle"></div>');
            const colors = ['#00ffff', '#ff00ff', '#ffff00', '#00ff00'];
            particle.css({
                left: cellOffset.left + cellWidth / 2 + (Math.random() - 0.5) * cellWidth,
                top: cellOffset.top + cellHeight / 2 + (Math.random() - 0.5) * cellHeight,
                background: colors[Math.floor(Math.random() * colors.length)],
                animationDelay: `${Math.random() * 0.5}s`
            });
            
            $('body').append(particle);
            
            setTimeout(() => {
                particle.remove();
            }, 3000);
        }
    }
    
    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
        this.lastMoveWasPass = false; // 通常の手の場合はパスフラグをリセット
        this.updateTurnDisplay();
        this.checkForPass();
    }
    
    checkForPass() {
        if (this.gameOver) return;

        // まず64手完了（盤面埋まり）をチェック
        if (this.isBoardFull()) {
            this.endGame();
            return;
        }
        
        const validMoves = this.getValidMoves(this.currentPlayer);
        
        if (validMoves.length === 0) {
            // 打つ手がない場合は自動パス
            this.handlePass();
        } else {
            this.showValidMoves();
        }
    }
    
    isBoardFull() {
        for (let row = 0; row < this.BOARD_SIZE; row++) {
            for (let col = 0; col < this.BOARD_SIZE; col++) {
                if (this.board[row][col] === null) {
                    return false;
                }
            }
        }
        return true;
    }
    
    handlePass() {
        if (this.gameOver) return;

        if (this.lastMoveWasPass) {
            // 両者連続パス → ゲーム終了
            setTimeout(() => this.endGame(), 1000);
            return;
        }

        // パス表示
        this.showPassMessage();
        this.lastMoveWasPass = true;

        // 1秒後にターン交代
        setTimeout(() => {
            this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
            this.updateTurnDisplay();
            this.checkForPass();

            // パス後に CPU の手番なら思考を開始する（人間パス時のフリーズ対策）
            if (!this.gameOver && !this.isThinking
                && this.currentPlayer === 'white'
                && this.getValidMoves('white').length > 0) {
                setTimeout(() => this.cpuMove(), 500);
            }
        }, 1500);
    }
    
    showPassMessage() {
        const playerName = this.currentPlayer === 'black' ? 'HUMAN' : 'A.I.';
        const passMessage = $(`<div class="pass-message">${playerName} PASS</div>`);
        
        $('body').append(passMessage);
        
        setTimeout(() => {
            passMessage.remove();
        }, 1500);
    }
    
    updateTurnDisplay() {
        const turnText = this.currentPlayer === 'black' ? 'HUMAN TURN' : 'A.I. PROCESSING';
        $('#current-turn').text(turnText);
    }
    
    updateScore() {
        let blackCount = 0;
        let whiteCount = 0;
        
        for (let row = 0; row < this.BOARD_SIZE; row++) {
            for (let col = 0; col < this.BOARD_SIZE; col++) {
                if (this.board[row][col] === 'black') blackCount++;
                else if (this.board[row][col] === 'white') whiteCount++;
            }
        }
        
        $('#black-score').text(blackCount);
        $('#white-score').text(whiteCount);
    }
    
    cpuMove() {
        if (this.gameOver) return;
        
        this.isThinking = true;
        this.showMessage('A.I. ANALYZING...', 'info');
        
        const validMoves = this.getValidMoves('white');
        
        if (validMoves.length === 0) {
            // CPUも打つ手がない場合は自動的にhandlePassが呼ばれる
            this.isThinking = false;
            this.hideMessage();
            return;
        }
        
        // 簡単なAI: ランダムに有効な手を選ぶ（改良可能）
        let bestMove = this.getBestMove(validMoves);
        
        setTimeout(() => {
            this.isThinking = false;
            this.hideMessage();
            this.makeMove(bestMove[0], bestMove[1]);
        }, 1500);
    }
    
    getBestMove(validMoves) {
        // 簡単な評価関数を使用
        let bestScore = -Infinity;
        let bestMove = validMoves[0];
        
        for (const [row, col] of validMoves) {
            let score = this.evaluateMove(row, col, 'white');

            const isCorner = (row === 0 || row === 7) && (col === 0 || col === 7);
            if (isCorner) {
                // 角の重み付け
                score += 100;
            } else {
                // 辺の重み付け
                if (row === 0 || row === 7 || col === 0 || col === 7) {
                    score += 10;
                }
                // 空いている角の周囲（X打ち・C打ち）は角を献上しやすいので減点
                for (const [cr, cc] of [[0, 0], [0, 7], [7, 0], [7, 7]]) {
                    if (Math.abs(row - cr) <= 1 && Math.abs(col - cc) <= 1 && this.board[cr][cc] === null) {
                        score -= (row !== cr && col !== cc) ? 60 : 30; // X打ちは特に重く減点
                        break;
                    }
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestMove = [row, col];
            }
        }
        
        return bestMove;
    }
    
    evaluateMove(row, col, player) {
        // この手で裏返せるピースの数を計算
        const opponent = player === 'black' ? 'white' : 'black';
        let score = 0;
        
        for (const [dr, dc] of this.directions) {
            let r = row + dr;
            let c = col + dc;
            let count = 0;
            
            while (r >= 0 && r < this.BOARD_SIZE && c >= 0 && c < this.BOARD_SIZE) {
                if (this.board[r][c] === opponent) {
                    count++;
                } else if (this.board[r][c] === player) {
                    score += count;
                    break;
                } else {
                    break;
                }
                r += dr;
                c += dc;
            }
        }
        
        return score;
    }
    
    
    checkGameOver() {
        // 64手完了（盤面埋まり）が最優先
        if (this.isBoardFull()) {
            return true;
        }
        
        const blackMoves = this.getValidMoves('black');
        const whiteMoves = this.getValidMoves('white');
        
        return blackMoves.length === 0 && whiteMoves.length === 0;
    }
    
    endGame() {
        if (this.gameOver && $('#game-message').hasClass('winner')) return; // 二重終了ガード
        this.gameOver = true;
        $('.cell').removeClass('valid-move valid-move-human valid-move-ai');
        $('.cell .flip-count').remove();

        // スコアは DOM ではなく盤面から直接カウントする
        let blackScore = 0;
        let whiteScore = 0;
        for (let row = 0; row < this.BOARD_SIZE; row++) {
            for (let col = 0; col < this.BOARD_SIZE; col++) {
                if (this.board[row][col] === 'black') blackScore++;
                else if (this.board[row][col] === 'white') whiteScore++;
            }
        }
        this.updateScore();
        
        let message;
        if (blackScore > whiteScore) {
            message = ` HUMAN VICTORY! (${blackScore} - ${whiteScore})`;
        } else if (whiteScore > blackScore) {
            message = ` A.I. SUPREMACY! (${whiteScore} - ${blackScore})`;
        } else {
            message = `⚡ SYSTEM DRAW! (${blackScore} - ${whiteScore})`;
        }
        
        this.showMessage(message, 'winner');
        this.createCelebrationEffect();
    }
    
    createCelebrationEffect() {
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                const particle = $('<div class="cyber-particle"></div>');
                const colors = ['#00ffff', '#ff00ff', '#ffff00', '#ffd700', '#00ff00'];
                particle.css({
                    left: Math.random() * window.innerWidth,
                    top: Math.random() * window.innerHeight / 2,
                    background: colors[Math.floor(Math.random() * colors.length)],
                    width: Math.random() * 8 + 4,
                    height: Math.random() * 8 + 4,
                    animationDuration: `${Math.random() * 2 + 2}s`
                });
                
                $('body').append(particle);
                
                setTimeout(() => {
                    particle.remove();
                }, 4000);
            }, i * 80);
        }
    }
    
    showHint() {
        if (this.gameOver || this.currentPlayer !== 'black') return;

        $('.cell').removeClass('valid-move valid-move-human valid-move-ai');

        const validMoves = this.getValidMoves('black');
        if (validMoves.length === 0) {
            this.showMessage('NO VALID MOVES DETECTED', 'info');
            return;
        }

        const bestMove = this.getBestMove(validMoves);
        const cell = $(`.cell[data-row="${bestMove[0]}"][data-col="${bestMove[1]}"]`);

        cell.addClass('valid-move valid-move-human');
        cell.css({
            'animation': 'pulse 0.5s ease-in-out 3',
            'background': '#f39c12'
        });
        
        setTimeout(() => {
            cell.css({
                'animation': '',
                'background': ''
            });
            this.showValidMoves();
        }, 2000);
        
        this.showMessage('TACTICAL ANALYSIS COMPLETE', 'info');
        setTimeout(() => this.hideMessage(), 2000);
    }
    
    showMessage(text, type = 'info') {
        const messageElement = $('#game-message');
        messageElement.text(text);
        messageElement.removeClass('show winner');
        
        if (type === 'winner') {
            messageElement.addClass('winner');
        }
        
        setTimeout(() => {
            messageElement.addClass('show');
        }, 100);
    }
    
    hideMessage() {
        // winner クラスも外さないと、リセット後も勝利バナーが画面に残り続ける
        $('#game-message').removeClass('show winner');
    }
    
    resetGame() {
        this.hideMessage();
        this.initializeBoard();
        this.renderBoard();
        this.updateScore();
        this.updateTurnDisplay();
        this.showValidMoves();
    }
}

// ゲーム開始
$(document).ready(function() {
    const game = new ReversiGame();
    
    // デバッグログ（必要時のみ）:  エフェクト満載のリバーシゲームが開始されました！
    // デバッグログ（必要時のみ）: ✨ 美しいアニメーションをお楽しみください！
});