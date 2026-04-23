import { PanoramaViewer } from './viewer.js';

// DOM要素
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileSelectBtn = document.getElementById('file-select-btn');
const viewerEl = document.getElementById('viewer');
const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');
const backBtn = document.getElementById('back-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const fullscreenIcon = document.getElementById('fullscreen-icon');
const exitFullscreenIcon = document.getElementById('exit-fullscreen-icon');
const videoControls = document.getElementById('video-controls');
const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const seekBar = document.getElementById('seek-bar');
const timeDisplay = document.getElementById('time-display');
const muteBtn = document.getElementById('mute-btn');
const volumeIcon = document.getElementById('volume-icon');
const muteIcon = document.getElementById('mute-icon');
const volumeBar = document.getElementById('volume-bar');

let panoramaViewer = null;
let isSeeking = false;

// ----- ファイル選択 -----
fileSelectBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// ----- ドラッグ&ドロップ -----
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

// ----- トースト通知 -----
function showToast(message, duration = 3000) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ----- ファイル処理 -----
async function handleFile(file) {
    const type = file.type;

    if (!type.startsWith('image/') && !type.startsWith('video/')) {
        showToast('画像または動画ファイルを選択してください');
        return;
    }

    showLoading(true);

    // viewerを先に表示してcanvasサイズを確保（0x0対策）
    switchToViewer();

    try {
        if (!panoramaViewer) {
            panoramaViewer = new PanoramaViewer(canvas);
        }

        if (type.startsWith('image/')) {
            await panoramaViewer.loadImage(file);
            showVideoControls(false);
        } else {
            await panoramaViewer.loadVideo(file);
            // モバイル自動再生ポリシー対応: 最初はmutedで再生
            panoramaViewer.setVideoMuted(true);
            volumeIcon.classList.add('hidden');
            muteIcon.classList.remove('hidden');
            volumeBar.value = 0;
            await panoramaViewer.playVideo();
            showVideoControls(true);
            updatePlayPauseIcon(true);
            // updateTimeDisplayはvideoのloadedmetadataイベントで自動開始
        }
    } catch (err) {
        console.error(err);
        showToast('ファイルの読み込みに失敗しました');
    } finally {
        showLoading(false);
    }
}

// ----- 画面切り替え -----
function switchToViewer() {
    dropZone.classList.add('hidden');
    viewerEl.classList.remove('hidden');

    // canvasが表示されてからレンダラーサイズを更新（0x0対策）
    if (panoramaViewer) {
        setTimeout(() => panoramaViewer.onResize(), 0);
    }
}

function switchToDropZone() {
    viewerEl.classList.add('hidden');
    dropZone.classList.remove('hidden');

    if (panoramaViewer) {
        panoramaViewer.destroy();
        panoramaViewer = null;
    }

    fileInput.value = '';
    isSeeking = false;
}

function showLoading(show) {
    loading.classList.toggle('hidden', !show);
}

function showVideoControls(show) {
    videoControls.classList.toggle('hidden', !show);
}

// ----- 戻る -----
backBtn.addEventListener('click', switchToDropZone);

// ----- フルスクリーン（ベンダープレフィックス対応） -----
function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) {
        await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
    }
}

async function exitFullscreen() {
    if (document.exitFullscreen) {
        await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
    }
}

fullscreenBtn.addEventListener('click', () => {
    if (!isFullscreen()) {
        enterFullscreen().catch(() => {});
    } else {
        exitFullscreen().catch(() => {});
    }
});

function onFullscreenChange() {
    const fs = isFullscreen();
    fullscreenIcon.classList.toggle('hidden', fs);
    exitFullscreenIcon.classList.toggle('hidden', !fs);
}

document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// ----- 動画コントロール -----
playPauseBtn.addEventListener('click', () => {
    if (!panoramaViewer) return;

    if (panoramaViewer.isVideoPlaying()) {
        panoramaViewer.pauseVideo();
        updatePlayPauseIcon(false);
    } else {
        panoramaViewer.playVideo();
        updatePlayPauseIcon(true);
    }
});

function updatePlayPauseIcon(playing) {
    playIcon.classList.toggle('hidden', playing);
    pauseIcon.classList.toggle('hidden', !playing);
}

// シークバー
seekBar.addEventListener('mousedown', () => { isSeeking = true; });
seekBar.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });

seekBar.addEventListener('input', () => {
    if (!panoramaViewer) return;
    const ratio = parseFloat(seekBar.value) / 100;
    panoramaViewer.seekVideo(ratio);
});

seekBar.addEventListener('change', () => { isSeeking = false; });
seekBar.addEventListener('touchend', () => { isSeeking = false; });

// 音量
muteBtn.addEventListener('click', () => {
    if (!panoramaViewer) return;
    const muted = !panoramaViewer.getVideoMuted();
    panoramaViewer.setVideoMuted(muted);
    volumeIcon.classList.toggle('hidden', muted);
    muteIcon.classList.toggle('hidden', !muted);
});

volumeBar.addEventListener('input', () => {
    if (!panoramaViewer) return;
    const vol = parseFloat(volumeBar.value);
    panoramaViewer.setVideoVolume(vol);
    if (vol > 0 && panoramaViewer.getVideoMuted()) {
        panoramaViewer.setVideoMuted(false);
        volumeIcon.classList.remove('hidden');
        muteIcon.classList.add('hidden');
    }
});

// ----- 時間更新 -----
function formatTime(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateTimeDisplay() {
    if (!panoramaViewer || !panoramaViewer.isVideo) return;

    requestAnimationFrame(updateTimeDisplay);

    const current = panoramaViewer.getVideoCurrentTime();
    const duration = panoramaViewer.getVideoDuration();

    if (!isSeeking) {
        const progress = panoramaViewer.getVideoProgress();
        seekBar.value = progress * 100;
    }

    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;

    // 再生状態の同期（外部操作で停止した場合）
    if (panoramaViewer.video && panoramaViewer.video.paused) {
        updatePlayPauseIcon(false);
    } else {
        updatePlayPauseIcon(true);
    }
}

// 動画読み込み完了後にタイム更新を開始
let timeUpdateStarted = false;

document.addEventListener('panoramaReady', () => {
    if (!timeUpdateStarted) {
        timeUpdateStarted = true;
        updateTimeDisplay();
    }
});

// ビューワー切り替え時にフラグをリセット
const originalSwitchToDropZone = switchToDropZone;
switchToDropZone = function() {
    timeUpdateStarted = false;
    originalSwitchToDropZone();
};
