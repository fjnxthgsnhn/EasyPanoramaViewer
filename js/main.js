import { PanoramaViewer } from './viewer.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileSelectBtn = document.getElementById('file-select-btn');
const viewerEl = document.getElementById('viewer');
const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');
const backBtn = document.getElementById('back-btn');
const sensorBtn = document.getElementById('sensor-btn');
const captureBtn = document.getElementById('capture-btn');
const capturePanel = document.getElementById('capture-panel');
const aspectRatioSelect = document.getElementById('aspect-ratio');
const customRatio = document.getElementById('custom-ratio');
const ratioWidth = document.getElementById('ratio-width');
const ratioHeight = document.getElementById('ratio-height');
const screenshotBtn = document.getElementById('screenshot-btn');
const recordBtn = document.getElementById('record-btn');
const recordingStatus = document.getElementById('recording-status');
const recordingTime = document.getElementById('recording-time');
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
let recordingStartedAt = 0;
let recordingTimer = null;
let timeUpdateStarted = false;

fileSelectBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (event) => {
    if (event.target.files.length > 0) handleFile(event.target.files[0]);
});

dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    if (event.dataTransfer.files.length > 0) handleFile(event.dataTransfer.files[0]);
});

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

async function handleFile(file) {
    const type = file.type;
    if (!type.startsWith('image/') && !type.startsWith('video/')) {
        showToast('画像または動画ファイルを選択してください');
        return;
    }

    showLoading(true);
    switchToViewer();

    try {
        if (!panoramaViewer) panoramaViewer = new PanoramaViewer(canvas);

        if (type.startsWith('image/')) {
            await panoramaViewer.loadImage(file);
            showVideoControls(false);
        } else {
            await panoramaViewer.loadVideo(file);
            panoramaViewer.setVideoMuted(true);
            volumeIcon.classList.add('hidden');
            muteIcon.classList.remove('hidden');
            volumeBar.value = 0;
            await panoramaViewer.playVideo();
            showVideoControls(true);
            updatePlayPauseIcon(true);
        }
    } catch (error) {
        console.error(error);
        showToast('ファイルの読み込みに失敗しました');
    } finally {
        showLoading(false);
    }
}

function switchToViewer() {
    dropZone.classList.add('hidden');
    viewerEl.classList.remove('hidden');
    if (panoramaViewer) setTimeout(() => panoramaViewer.onResize(), 0);
}

async function switchToDropZone() {
    if (panoramaViewer?.isRecording) {
        await stopRecordingAndDownload();
    }

    viewerEl.classList.add('hidden');
    dropZone.classList.remove('hidden');
    capturePanel.classList.add('hidden');

    if (panoramaViewer) {
        panoramaViewer.destroy();
        panoramaViewer = null;
    }

    fileInput.value = '';
    isSeeking = false;
    timeUpdateStarted = false;
    resetRecordingUi();
}

function showLoading(show) {
    loading.classList.toggle('hidden', !show);
}

function showVideoControls(show) {
    videoControls.classList.toggle('hidden', !show);
}

backBtn.addEventListener('click', () => {
    switchToDropZone().catch(console.error);
});

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
if (isMobile && 'ontouchstart' in window && window.DeviceOrientationEvent) {
    sensorBtn.classList.remove('hidden');
}

sensorBtn.addEventListener('click', async () => {
    if (!panoramaViewer) return;
    const enabled = await panoramaViewer.toggleSensorMode();
    sensorBtn.classList.toggle('active', enabled);
    showToast(enabled ? 'ジャイロモードON：スマホを傾けて360°見回せます' : 'ジャイロモードOFF');
});

// ----- キャプチャ -----
captureBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    capturePanel.classList.toggle('hidden');
});

capturePanel.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', () => capturePanel.classList.add('hidden'));

aspectRatioSelect.addEventListener('change', () => {
    customRatio.classList.toggle('hidden', aspectRatioSelect.value !== 'custom');
});

function getSelectedAspectRatio() {
    if (aspectRatioSelect.value !== 'custom') return parseFloat(aspectRatioSelect.value);

    const width = parseFloat(ratioWidth.value);
    const height = parseFloat(ratioHeight.value);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('正しい比率を入力してください');
    }
    return width / height;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampForFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

screenshotBtn.addEventListener('click', async () => {
    if (!panoramaViewer) return;

    try {
        screenshotBtn.disabled = true;
        screenshotBtn.textContent = '生成中...';
        const aspectRatio = getSelectedAspectRatio();
        const { blob, width, height } = await panoramaViewer.captureScreenshot(aspectRatio);
        downloadBlob(blob, `panorama_${width}x${height}_${timestampForFilename()}.png`);
        showToast(`PNGを保存しました（${width}×${height}）`);
    } catch (error) {
        console.error(error);
        showToast(error.message || 'スクリーンショットの保存に失敗しました');
    } finally {
        screenshotBtn.disabled = false;
        screenshotBtn.textContent = 'PNG保存';
    }
});

function formatRecordingTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startRecordingTimer() {
    recordingStartedAt = performance.now();
    recordingTime.textContent = '00:00';
    clearInterval(recordingTimer);
    recordingTimer = setInterval(() => {
        const elapsed = (performance.now() - recordingStartedAt) / 1000;
        recordingTime.textContent = formatRecordingTime(elapsed);
    }, 250);
}

function resetRecordingUi() {
    clearInterval(recordingTimer);
    recordingTimer = null;
    recordingStartedAt = 0;
    recordBtn.textContent = '録画開始';
    recordBtn.classList.remove('active');
    recordingStatus.classList.add('hidden');
    recordingTime.textContent = '00:00';
}

async function stopRecordingAndDownload() {
    if (!panoramaViewer?.isRecording) return;

    recordBtn.disabled = true;
    recordBtn.textContent = '保存中...';
    try {
        const { blob, extension } = await panoramaViewer.stopRecording();
        if (blob.size === 0) throw new Error('録画データが生成されませんでした');
        downloadBlob(blob, `panorama_recording_${timestampForFilename()}.${extension}`);
        showToast(`録画を保存しました（${extension.toUpperCase()}）`);
    } catch (error) {
        console.error(error);
        showToast(error.message || '録画の保存に失敗しました');
    } finally {
        recordBtn.disabled = false;
        resetRecordingUi();
    }
}

recordBtn.addEventListener('click', async () => {
    if (!panoramaViewer) return;

    if (panoramaViewer.isRecording) {
        await stopRecordingAndDownload();
        return;
    }

    try {
        panoramaViewer.startRecording({ fps: 30, videoBitsPerSecond: 10_000_000 });
        recordBtn.textContent = '録画停止';
        recordBtn.classList.add('active');
        recordingStatus.classList.remove('hidden');
        startRecordingTimer();
        showToast('録画を開始しました');
    } catch (error) {
        console.error(error);
        showToast(error.message || '録画を開始できませんでした');
        resetRecordingUi();
    }
});

// ----- フルスクリーン -----
function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterFullscreen() {
    const element = document.documentElement;
    if (element.requestFullscreen) await element.requestFullscreen();
    else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
}

async function exitFullscreen() {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
}

fullscreenBtn.addEventListener('click', () => {
    const action = isFullscreen() ? exitFullscreen() : enterFullscreen();
    action.catch(() => {});
});

function onFullscreenChange() {
    const fullscreen = isFullscreen();
    fullscreenIcon.classList.toggle('hidden', fullscreen);
    exitFullscreenIcon.classList.toggle('hidden', !fullscreen);
    setTimeout(() => panoramaViewer?.onResize(), 0);
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
        panoramaViewer.playVideo().catch(() => {});
        updatePlayPauseIcon(true);
    }
});

function updatePlayPauseIcon(playing) {
    playIcon.classList.toggle('hidden', playing);
    pauseIcon.classList.toggle('hidden', !playing);
}

seekBar.addEventListener('mousedown', () => { isSeeking = true; });
seekBar.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });
seekBar.addEventListener('input', () => {
    if (!panoramaViewer) return;
    panoramaViewer.seekVideo(parseFloat(seekBar.value) / 100);
});
seekBar.addEventListener('change', () => { isSeeking = false; });
seekBar.addEventListener('touchend', () => { isSeeking = false; });

muteBtn.addEventListener('click', () => {
    if (!panoramaViewer) return;
    const muted = !panoramaViewer.getVideoMuted();
    panoramaViewer.setVideoMuted(muted);
    volumeIcon.classList.toggle('hidden', muted);
    muteIcon.classList.toggle('hidden', !muted);
});

volumeBar.addEventListener('input', () => {
    if (!panoramaViewer) return;
    const volume = parseFloat(volumeBar.value);
    panoramaViewer.setVideoVolume(volume);
    if (volume > 0 && panoramaViewer.getVideoMuted()) {
        panoramaViewer.setVideoMuted(false);
        volumeIcon.classList.remove('hidden');
        muteIcon.classList.add('hidden');
    }
});

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function updateTimeDisplay() {
    if (!panoramaViewer || !panoramaViewer.isVideo) {
        timeUpdateStarted = false;
        return;
    }

    requestAnimationFrame(updateTimeDisplay);
    const current = panoramaViewer.getVideoCurrentTime();
    const duration = panoramaViewer.getVideoDuration();

    if (!isSeeking) seekBar.value = panoramaViewer.getVideoProgress() * 100;
    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    updatePlayPauseIcon(panoramaViewer.isVideoPlaying());
}

document.addEventListener('panoramaReady', () => {
    if (!timeUpdateStarted) {
        timeUpdateStarted = true;
        updateTimeDisplay();
    }
});
