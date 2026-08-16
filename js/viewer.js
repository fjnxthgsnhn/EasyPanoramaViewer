import * as THREE from 'three';

export class PanoramaViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.mesh = null;
        this.texture = null;
        this.video = null;
        this.objectUrl = null;
        this.isVideo = false;
        this.animationId = null;

        // カメラ制御
        this.lon = 0;
        this.lat = 0;
        this.fov = 75;
        this.minFov = 30;
        this.maxFov = 120;

        // 慣性スクロール
        this.velocityLon = 0;
        this.velocityLat = 0;
        this.isDragging = false;
        this.lastX = 0;
        this.lastY = 0;
        this.startX = 0;
        this.startY = 0;
        this.startLon = 0;
        this.startLat = 0;

        // タッチ
        this.lastTouchDist = 0;
        this.startFov = 75;

        // レンダリング最適化 / 録画
        this.needsRender = true;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.recordingStream = null;
        this.sourceCaptureStream = null;

        // デバイスオリエンテーション（ジャイロ）
        this.sensorMode = false;
        this.baseBeta = null;
        this.baseGamma = null;
        this.smoothBeta = 0;
        this.smoothGamma = 0;

        // 破棄時に確実に外せるようハンドラを保持
        this._onMouseDown = this.onMouseDown.bind(this);
        this._onMouseMove = this.onMouseMove.bind(this);
        this._onMouseUp = this.onMouseUp.bind(this);
        this._onWheel = this.onWheel.bind(this);
        this._onTouchStart = this.onTouchStart.bind(this);
        this._onTouchMove = this.onTouchMove.bind(this);
        this._onTouchEnd = this.onTouchEnd.bind(this);
        this._onDeviceOrientation = this.onDeviceOrientation.bind(this);
        this._onOrientationChange = this.onOrientationChange.bind(this);
        this._animate = this.animate.bind(this);

        this.init();
    }

    init() {
        this.scene = new THREE.Scene();

        const width = Math.max(this.canvas.clientWidth, 1);
        const height = Math.max(this.canvas.clientHeight, 1);
        this.camera = new THREE.PerspectiveCamera(this.fov, width / height, 0.1, 1000);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(width, height, false);

        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.canvas);

        this.bindEvents();
        this.animate();
    }

    bindEvents() {
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this._onTouchEnd);
    }

    // ----- 画像読み込み -----
    loadImage(file) {
        return new Promise((resolve, reject) => {
            this.disposeCurrent();
            this.isVideo = false;

            const url = URL.createObjectURL(file);
            const loader = new THREE.TextureLoader();

            loader.load(
                url,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    this.setupSphere(texture);
                    URL.revokeObjectURL(url);
                    this.needsRender = true;
                    resolve();
                },
                undefined,
                (error) => {
                    URL.revokeObjectURL(url);
                    reject(error);
                }
            );
        });
    }

    // ----- 動画読み込み -----
    loadVideo(file) {
        return new Promise((resolve, reject) => {
            this.disposeCurrent();
            this.isVideo = true;

            this.objectUrl = URL.createObjectURL(file);
            this.video = document.createElement('video');
            this.video.src = this.objectUrl;
            this.video.crossOrigin = 'anonymous';
            this.video.loop = true;
            this.video.playsInline = true;
            this.video.preload = 'auto';
            this.video.muted = false;

            this.video.addEventListener('loadeddata', () => {
                const texture = new THREE.VideoTexture(this.video);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                this.setupSphere(texture);
                document.dispatchEvent(new Event('panoramaReady'));
                this.needsRender = true;
                resolve();
            }, { once: true });

            this.video.addEventListener('error', (event) => {
                this.releaseObjectUrl();
                reject(event);
            }, { once: true });
        });
    }

    // ----- 球体セットアップ -----
    setupSphere(texture) {
        this.texture = texture;

        // Three.js の標準的なパノラマ表示方式。
        // 球体を X 軸反転して内側を正面として描画することで、
        // BackSide + UV反転による左右反転を避ける。
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);

        const material = new THREE.MeshBasicMaterial({ map: texture });
        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
    }

    releaseObjectUrl() {
        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
    }

    disposeCurrent() {
        if (this.isRecording) {
            this.stopRecording().catch(() => {});
        }

        if (this.mesh) {
            this.mesh.geometry.dispose();
            if (this.mesh.material.map) {
                this.mesh.material.map = null;
            }
            this.mesh.material.dispose();
            this.scene.remove(this.mesh);
            this.mesh = null;
        }

        if (this.video) {
            this.video.pause();
            this.video.removeAttribute('src');
            this.video.load();
            this.video = null;
        }

        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }

        this.releaseObjectUrl();
        this.isVideo = false;
        this.velocityLon = 0;
        this.velocityLat = 0;
    }

    // ----- 再生制御 -----
    playVideo() {
        return this.video ? this.video.play() : Promise.resolve();
    }

    pauseVideo() {
        if (this.video) this.video.pause();
    }

    isVideoPlaying() {
        return this.video ? !this.video.paused : false;
    }

    seekVideo(ratio) {
        if (this.video && Number.isFinite(this.video.duration)) {
            this.video.currentTime = this.video.duration * Math.max(0, Math.min(1, ratio));
        }
    }

    getVideoProgress() {
        if (this.video && Number.isFinite(this.video.duration) && this.video.duration > 0) {
            return this.video.currentTime / this.video.duration;
        }
        return 0;
    }

    getVideoDuration() {
        return this.video ? this.video.duration : 0;
    }

    getVideoCurrentTime() {
        return this.video ? this.video.currentTime : 0;
    }

    setVideoVolume(volume) {
        if (this.video) this.video.volume = Math.max(0, Math.min(1, volume));
    }

    getVideoVolume() {
        return this.video ? this.video.volume : 1;
    }

    setVideoMuted(muted) {
        if (this.video) this.video.muted = muted;
    }

    getVideoMuted() {
        return this.video ? this.video.muted : false;
    }

    // ----- スクリーンショット -----
    async captureScreenshot(aspectRatio, shortEdge = 1080) {
        if (!this.mesh || !this.renderer) {
            throw new Error('パノラマが読み込まれていません');
        }

        const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0
            ? Math.max(0.1, Math.min(10, aspectRatio))
            : this.camera.aspect;

        let width;
        let height;
        if (safeAspect >= 1) {
            height = shortEdge;
            width = Math.round(shortEdge * safeAspect);
        } else {
            width = shortEdge;
            height = Math.round(shortEdge / safeAspect);
        }

        const maxDimension = 3840;
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        width = Math.max(2, Math.round(width * scale));
        height = Math.max(2, Math.round(height * scale));

        const captureCanvas = document.createElement('canvas');
        const captureRenderer = new THREE.WebGLRenderer({
            canvas: captureCanvas,
            antialias: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
        });
        captureRenderer.outputColorSpace = this.renderer.outputColorSpace;
        captureRenderer.toneMapping = this.renderer.toneMapping;
        captureRenderer.toneMappingExposure = this.renderer.toneMappingExposure;
        captureRenderer.setPixelRatio(1);
        captureRenderer.setSize(width, height, false);

        const originalAspect = this.camera.aspect;
        try {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.updateCameraDirection();
            captureRenderer.render(this.scene, this.camera);

            const blob = await new Promise((resolve, reject) => {
                captureCanvas.toBlob((result) => {
                    if (result) resolve(result);
                    else reject(new Error('PNGの生成に失敗しました'));
                }, 'image/png');
            });

            return { blob, width, height };
        } finally {
            this.camera.aspect = originalAspect;
            this.camera.updateProjectionMatrix();
            captureRenderer.dispose();
            if (typeof captureRenderer.forceContextLoss === 'function') {
                captureRenderer.forceContextLoss();
            }
            this.needsRender = true;
        }
    }

    // ----- 動画撮影 -----
    getSupportedRecordingMimeType() {
        if (typeof MediaRecorder === 'undefined') return '';

        const candidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4;codecs=avc1.42E01E',
            'video/mp4',
        ];
        return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    }

    startRecording({ fps = 30, videoBitsPerSecond = 10_000_000 } = {}) {
        if (!this.mesh) throw new Error('パノラマが読み込まれていません');
        if (typeof this.canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
            throw new Error('このブラウザは動画撮影に対応していません');
        }
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            throw new Error('すでに録画中です');
        }

        const canvasStream = this.canvas.captureStream(fps);
        const tracks = [...canvasStream.getVideoTracks()];
        this.sourceCaptureStream = null;

        // 元が360動画の場合、対応ブラウザでは音声トラックも録画へ合流する。
        if (this.video) {
            const captureVideoStream = this.video.captureStream || this.video.mozCaptureStream;
            if (typeof captureVideoStream === 'function') {
                try {
                    this.sourceCaptureStream = captureVideoStream.call(this.video);
                    tracks.push(...this.sourceCaptureStream.getAudioTracks());
                } catch (error) {
                    console.warn('動画音声のキャプチャを開始できませんでした', error);
                }
            }
        }

        this.recordingStream = new MediaStream(tracks);
        this.recordedChunks = [];

        const mimeType = this.getSupportedRecordingMimeType();
        const options = { videoBitsPerSecond };
        if (mimeType) options.mimeType = mimeType;

        this.mediaRecorder = new MediaRecorder(this.recordingStream, options);
        this.mediaRecorder.addEventListener('dataavailable', (event) => {
            if (event.data && event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        });

        this.mediaRecorder.start(250);
        this.isRecording = true;
        this.needsRender = true;

        const actualMimeType = this.mediaRecorder.mimeType || mimeType || 'video/webm';
        return {
            mimeType: actualMimeType,
            extension: actualMimeType.includes('mp4') ? 'mp4' : 'webm',
        };
    }

    stopRecording() {
        return new Promise((resolve, reject) => {
            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                this.cleanupRecordingStreams();
                this.isRecording = false;
                reject(new Error('録画中ではありません'));
                return;
            }

            const recorder = this.mediaRecorder;
            const mimeType = recorder.mimeType || 'video/webm';

            const finish = () => {
                const blob = new Blob(this.recordedChunks, { type: mimeType });
                const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
                this.recordedChunks = [];
                this.mediaRecorder = null;
                this.isRecording = false;
                this.cleanupRecordingStreams();
                this.needsRender = true;
                resolve({ blob, mimeType, extension });
            };

            recorder.addEventListener('stop', finish, { once: true });
            recorder.addEventListener('error', (event) => {
                this.mediaRecorder = null;
                this.recordedChunks = [];
                this.isRecording = false;
                this.cleanupRecordingStreams();
                reject(event.error || new Error('録画に失敗しました'));
            }, { once: true });

            recorder.stop();
        });
    }

    cleanupRecordingStreams() {
        if (this.recordingStream) {
            this.recordingStream.getTracks().forEach((track) => track.stop());
            this.recordingStream = null;
        }
        if (this.sourceCaptureStream) {
            this.sourceCaptureStream.getTracks().forEach((track) => track.stop());
            this.sourceCaptureStream = null;
        }
    }

    // ----- カメラ更新 -----
    updateCameraDirection() {
        this.lat = Math.max(-85, Math.min(85, this.lat));

        const phi = THREE.MathUtils.degToRad(90 - this.lat);
        const theta = THREE.MathUtils.degToRad(this.lon);
        const x = 500 * Math.sin(phi) * Math.cos(theta);
        const y = 500 * Math.cos(phi);
        const z = 500 * Math.sin(phi) * Math.sin(theta);

        this.camera.position.set(0, 0, 0);
        this.camera.lookAt(x, y, z);
    }

    updateCamera() {
        this.updateCameraDirection();
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
    }

    updateInertia() {
        if (this.isDragging || this.sensorMode) return;

        const friction = 0.92;
        if (Math.abs(this.velocityLon) > 0.01 || Math.abs(this.velocityLat) > 0.01) {
            this.lon -= this.velocityLon;
            this.lat += this.velocityLat;
            this.velocityLon *= friction;
            this.velocityLat *= friction;
            this.needsRender = true;
        } else {
            this.velocityLon = 0;
            this.velocityLat = 0;
        }
    }

    animate() {
        this.animationId = requestAnimationFrame(this._animate);
        this.updateInertia();

        if (this.isVideo || this.sensorMode || this.isRecording) {
            this.needsRender = true;
        }
        if (!this.needsRender) return;

        this.updateCamera();
        this.renderer.render(this.scene, this.camera);

        if (!this.isVideo && !this.isDragging && !this.sensorMode && !this.isRecording &&
            Math.abs(this.velocityLon) < 0.01 && Math.abs(this.velocityLat) < 0.01) {
            this.needsRender = false;
        }
    }

    onResize() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        if (!width || !height || !this.renderer || !this.camera) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(width, height, false);
        this.needsRender = true;
    }

    // ----- マウス -----
    onMouseDown(event) {
        if (this.sensorMode) return;
        this.isDragging = true;
        this.startX = event.clientX;
        this.startY = event.clientY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.startLon = this.lon;
        this.startLat = this.lat;
        this.velocityLon = 0;
        this.velocityLat = 0;
        this.needsRender = true;
    }

    onMouseMove(event) {
        if (!this.isDragging || this.sensorMode) return;
        const dx = event.clientX - this.startX;
        const dy = event.clientY - this.startY;
        this.lon = this.startLon - dx * 0.2;
        this.lat = this.startLat + dy * 0.2;
        this.velocityLon = (event.clientX - this.lastX) * 0.2;
        this.velocityLat = (event.clientY - this.lastY) * 0.2;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.needsRender = true;
    }

    onMouseUp() {
        this.isDragging = false;
    }

    onWheel(event) {
        event.preventDefault();
        const delta = event.deltaY * 0.05;
        this.fov = Math.max(this.minFov, Math.min(this.maxFov, this.fov + delta));
        this.needsRender = true;
    }

    // ----- タッチ -----
    onTouchStart(event) {
        if (this.sensorMode) return;

        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.isDragging = true;
            this.startX = touch.clientX;
            this.startY = touch.clientY;
            this.lastX = touch.clientX;
            this.lastY = touch.clientY;
            this.startLon = this.lon;
            this.startLat = this.lat;
            this.velocityLon = 0;
            this.velocityLat = 0;
            this.needsRender = true;
        } else if (event.touches.length === 2) {
            this.isDragging = false;
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            this.lastTouchDist = Math.hypot(dx, dy);
            this.startFov = this.fov;
        }
    }

    onTouchMove(event) {
        event.preventDefault();
        if (this.sensorMode) return;

        if (event.touches.length === 1 && this.isDragging) {
            const touch = event.touches[0];
            const dx = touch.clientX - this.startX;
            const dy = touch.clientY - this.startY;
            this.lon = this.startLon - dx * 0.3;
            this.lat = this.startLat + dy * 0.3;
            this.velocityLon = (touch.clientX - this.lastX) * 0.3;
            this.velocityLat = (touch.clientY - this.lastY) * 0.3;
            this.lastX = touch.clientX;
            this.lastY = touch.clientY;
            this.needsRender = true;
        } else if (event.touches.length === 2) {
            const dx = event.touches[0].clientX - event.touches[1].clientX;
            const dy = event.touches[0].clientY - event.touches[1].clientY;
            const distance = Math.hypot(dx, dy);
            if (distance > 0 && this.lastTouchDist > 0) {
                const scale = this.lastTouchDist / distance;
                this.fov = Math.max(this.minFov, Math.min(this.maxFov, this.startFov * scale));
                this.needsRender = true;
            }
        }
    }

    onTouchEnd() {
        this.isDragging = false;
        this.lastTouchDist = 0;
    }

    // ----- デバイスオリエンテーション -----
    async toggleSensorMode() {
        if (this.sensorMode) {
            this.disableSensorMode();
            return false;
        }
        return this.enableSensorMode();
    }

    async enableSensorMode() {
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const response = await DeviceOrientationEvent.requestPermission();
                if (response !== 'granted') return false;
            } catch (error) {
                console.error(error);
                return false;
            }
        }

        this.sensorMode = true;
        this.baseBeta = null;
        this.baseGamma = null;
        this.smoothBeta = 0;
        this.smoothGamma = 0;
        this.velocityLon = 0;
        this.velocityLat = 0;
        window.addEventListener('deviceorientation', this._onDeviceOrientation);
        window.addEventListener('orientationchange', this._onOrientationChange);
        this.needsRender = true;
        return true;
    }

    disableSensorMode() {
        this.sensorMode = false;
        window.removeEventListener('deviceorientation', this._onDeviceOrientation);
        window.removeEventListener('orientationchange', this._onOrientationChange);
        this.velocityLon = 0;
        this.velocityLat = 0;
        this.needsRender = true;
    }

    onDeviceOrientation(event) {
        if (!this.sensorMode) return;

        let beta = event.beta || 0;
        let gamma = event.gamma || 0;

        if (beta > 150) beta -= 360;
        if (beta < -150) beta += 360;
        if (gamma > 80) gamma -= 180;
        if (gamma < -80) gamma += 180;

        if (this.baseBeta === null || this.baseGamma === null) {
            this.baseBeta = beta;
            this.baseGamma = gamma;
        }

        const alpha = 0.15;
        this.smoothBeta = this.smoothBeta * (1 - alpha) + (beta - this.baseBeta) * alpha;
        this.smoothGamma = this.smoothGamma * (1 - alpha) + (gamma - this.baseGamma) * alpha;

        this.lat = Math.max(-85, Math.min(85, this.smoothBeta));
        this.lon = this.smoothGamma * 2.0;
        this.needsRender = true;
    }

    onOrientationChange() {
        this.resetSensorBase();
    }

    resetSensorBase() {
        this.baseBeta = null;
        this.baseGamma = null;
    }

    // ----- 破棄 -----
    destroy() {
        cancelAnimationFrame(this.animationId);
        if (this.resizeObserver) this.resizeObserver.disconnect();

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.cleanupRecordingStreams();
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;

        this.disposeCurrent();
        this.disableSensorMode();

        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove', this._onTouchMove);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
    }
}
