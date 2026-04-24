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

        // レンダリング最適化
        this.needsRender = true;

        // イベントハンドラ（破棄用にバインドして保持）
        this._onMouseMove = this.onMouseMove.bind(this);
        this._onMouseUp = this.onMouseUp.bind(this);
        this._onResize = this.onResize.bind(this);

        // デバイスオリエンテーション（ジャイロ）
        this.sensorMode = false;
        this.baseBeta = null;
        this.baseGamma = null;
        this.smoothBeta = 0;
        this.smoothGamma = 0;
        this._onDeviceOrientation = this.onDeviceOrientation.bind(this);
        this._onOrientationChange = this.onOrientationChange.bind(this);

        this.init();
    }

    init() {
        // シーン
        this.scene = new THREE.Scene();

        // カメラ
        this.camera = new THREE.PerspectiveCamera(
            this.fov,
            this.canvas.clientWidth / this.canvas.clientHeight,
            0.1,
            1000
        );

        // レンダラー
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // リサイズ監視（window.resize は不要なので使用しない）
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.canvas);

        // イベント
        this.bindEvents();

        // レンダーループ
        this.animate();
    }

    bindEvents() {
        // マウス（canvas 上で mousedown、window で move/up）
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        window.addEventListener('mousemove', this._onMouseMove);
        window.addEventListener('mouseup', this._onMouseUp);

        // ホイール
        this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        // タッチ
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this));
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
                (err) => {
                    URL.revokeObjectURL(url);
                    reject(err);
                }
            );
        });
    }

    // ----- 動画読み込み -----
    loadVideo(file) {
        return new Promise((resolve, reject) => {
            this.disposeCurrent();
            this.isVideo = true;

            const url = URL.createObjectURL(file);
            this.video = document.createElement('video');
            this.video.src = url;
            this.video.crossOrigin = 'anonymous';
            this.video.loop = true;
            this.video.playsInline = true;
            this.video.muted = false;

            this.video.addEventListener('loadeddata', () => {
                const texture = new THREE.VideoTexture(this.video);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                this.setupSphere(texture);
                // 動画のメタデータ読み込み後にイベント発火
                document.dispatchEvent(new Event('panoramaReady'));
                this.needsRender = true;
                resolve();
            }, { once: true });

            this.video.addEventListener('error', (e) => {
                URL.revokeObjectURL(url);
                reject(e);
            }, { once: true });
        });
    }

    // ----- 球体セットアップ -----
    setupSphere(texture) {
        this.texture = texture;

        const geometry = new THREE.SphereGeometry(500, 60, 40);

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.BackSide,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
    }

    // ----- 破棄 -----
    disposeCurrent() {
        if (this.mesh) {
            this.mesh.geometry.dispose();
            // material.map の循環参照を切ってから dispose
            if (this.mesh.material.map) {
                this.mesh.material.map = null;
            }
            this.mesh.material.dispose();
            this.scene.remove(this.mesh);
            this.mesh = null;
        }
        if (this.texture) {
            if (this.texture.isVideoTexture && this.video) {
                this.video.pause();
                URL.revokeObjectURL(this.video.src);
                this.video = null;
            }
            this.texture.dispose();
            this.texture = null;
        }
        this.velocityLon = 0;
        this.velocityLat = 0;
    }

    // ----- 再生制御 -----
    playVideo() {
        if (this.video) {
            this.video.play();
        }
    }

    pauseVideo() {
        if (this.video) {
            this.video.pause();
        }
    }

    isVideoPlaying() {
        return this.video ? !this.video.paused : false;
    }

    seekVideo(ratio) {
        if (this.video && isFinite(this.video.duration)) {
            this.video.currentTime = this.video.duration * ratio;
        }
    }

    getVideoProgress() {
        if (this.video && isFinite(this.video.duration) && this.video.duration > 0) {
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

    setVideoVolume(vol) {
        if (this.video) {
            this.video.volume = vol;
        }
    }

    getVideoVolume() {
        return this.video ? this.video.volume : 1;
    }

    setVideoMuted(muted) {
        if (this.video) {
            this.video.muted = muted;
        }
    }

    getVideoMuted() {
        return this.video ? this.video.muted : false;
    }

    // ----- カメラ更新 -----
    updateCamera() {
        // latを-85〜85度に制限
        this.lat = Math.max(-85, Math.min(85, this.lat));

        const phi = THREE.MathUtils.degToRad(90 - this.lat);
        const theta = THREE.MathUtils.degToRad(this.lon);

        const x = 500 * Math.sin(phi) * Math.cos(theta);
        const y = 500 * Math.cos(phi);
        const z = 500 * Math.sin(phi) * Math.sin(theta);

        this.camera.position.set(0, 0, 0);
        this.camera.lookAt(x, y, z);
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
    }

    // ----- 慣性更新 -----
    updateInertia() {
        if (this.isDragging || this.sensorMode) return;

        // 慣性減衰
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

    // ----- レンダー -----
    animate() {
        this.animationId = requestAnimationFrame(this.animate.bind(this));

        this.updateInertia();

        // 動画またはセンサーモード時は常時レンダリング
        if (this.isVideo || this.sensorMode) {
            this.needsRender = true;
        }

        if (!this.needsRender) return;

        this.updateCamera();
        this.renderer.render(this.scene, this.camera);

        // 静止画かつ慣性停止中かつセンサーモードOFF時はレンダリングを抑制
        if (!this.isVideo && !this.isDragging && !this.sensorMode &&
            Math.abs(this.velocityLon) < 0.01 && Math.abs(this.velocityLat) < 0.01) {
            this.needsRender = false;
        }
    }

    // ----- リサイズ -----
    onResize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w === 0 || h === 0) return;

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.needsRender = true;
    }

    // ----- マウスイベント -----
    onMouseDown(e) {
        if (this.sensorMode) return;
        this.isDragging = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.startLon = this.lon;
        this.startLat = this.lat;
        this.velocityLon = 0;
        this.velocityLat = 0;
        this.needsRender = true;
    }

    onMouseMove(e) {
        if (!this.isDragging || this.sensorMode) return;
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        this.lon = this.startLon - dx * 0.2;
        this.lat = this.startLat + dy * 0.2;

        // 速度を記録（慣性用）
        this.velocityLon = (e.clientX - this.lastX) * 0.2;
        this.velocityLat = (e.clientY - this.lastY) * 0.2;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.needsRender = true;
    }

    onMouseUp() {
        this.isDragging = false;
    }

    // ----- ホイール -----
    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY * 0.05;
        this.fov = Math.max(this.minFov, Math.min(this.maxFov, this.fov + delta));
        this.needsRender = true;
    }

    // ----- タッチイベント -----
    onTouchStart(e) {
        if (this.sensorMode) return; // センサーモード中はタッチドラッグ無効

        if (e.touches.length === 1) {
            this.isDragging = true;
            this.startX = e.touches[0].clientX;
            this.startY = e.touches[0].clientY;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;
            this.startLon = this.lon;
            this.startLat = this.lat;
            this.velocityLon = 0;
            this.velocityLat = 0;
            this.needsRender = true;
        } else if (e.touches.length === 2) {
            this.isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.lastTouchDist = Math.sqrt(dx * dx + dy * dy);
            this.startFov = this.fov;
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        if (this.sensorMode) return; // センサーモード中はタッチドラッグ無効

        if (e.touches.length === 1 && this.isDragging) {
            const dx = e.touches[0].clientX - this.startX;
            const dy = e.touches[0].clientY - this.startY;
            this.lon = this.startLon - dx * 0.3;
            this.lat = this.startLat + dy * 0.3;

            // 速度を記録（慣性用）
            this.velocityLon = (e.touches[0].clientX - this.lastX) * 0.3;
            this.velocityLat = (e.touches[0].clientY - this.lastY) * 0.3;
            this.lastX = e.touches[0].clientX;
            this.lastY = e.touches[0].clientY;
            this.needsRender = true;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const scale = this.lastTouchDist / dist;
            this.fov = Math.max(this.minFov, Math.min(this.maxFov, this.startFov * scale));
            this.needsRender = true;
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
        return await this.enableSensorMode();
    }

    async enableSensorMode() {
        // iOS 13+ では権限が必要
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const response = await DeviceOrientationEvent.requestPermission();
                if (response !== 'granted') {
                    return false;
                }
            } catch (e) {
                console.error(e);
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

    onDeviceOrientation(e) {
        if (!this.sensorMode) return;

        let beta = e.beta || 0;   // 前後傾き (-180〜180)
        let gamma = e.gamma || 0; // 左右傾き (-90〜90)

        // 境界値のラップアラウンド処理
        if (beta > 150) beta -= 360;
        if (beta < -150) beta += 360;
        if (gamma > 80) gamma -= 180;
        if (gamma < -80) gamma += 180;

        // 初回は基準値を設定
        if (this.baseBeta === null || this.baseGamma === null) {
            this.baseBeta = beta;
            this.baseGamma = gamma;
        }

        // 平滑化（移動平均）
        const alpha = 0.15;
        this.smoothBeta = this.smoothBeta * (1 - alpha) + (beta - this.baseBeta) * alpha;
        this.smoothGamma = this.smoothGamma * (1 - alpha) + (gamma - this.baseGamma) * alpha;

        // beta → lat（上下）, gamma → lon（左右）
        // gamma 2倍スケールで視野移動を自然に
        this.lat = Math.max(-85, Math.min(85, this.smoothBeta));
        this.lon = this.smoothGamma * 2.0;

        this.needsRender = true;
    }

    onOrientationChange() {
        // 画面回転時に基準値をリセット
        this.resetSensorBase();
    }

    resetSensorBase() {
        this.baseBeta = null;
        this.baseGamma = null;
    }

    // ----- 破棄 -----
    destroy() {
        cancelAnimationFrame(this.animationId);
        this.resizeObserver.disconnect();
        this.disposeCurrent();
        this.disableSensorMode();

        // window イベントを削除
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('mouseup', this._onMouseUp);

        this.renderer.dispose();
    }
}
