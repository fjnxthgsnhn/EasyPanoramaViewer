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

        // 入力状態
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.startLon = 0;
        this.startLat = 0;

        // タッチ
        this.lastTouchDist = 0;

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
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // リサイズ監視
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.canvas);

        // イベント
        this.bindEvents();

        // レンダーループ
        this.animate();
    }

    bindEvents() {
        // マウス
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('mouseup', this.onMouseUp.bind(this));

        // ホイール
        this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        // タッチ
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this));

        // 画面回転
        window.addEventListener('resize', this.onResize.bind(this));
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
                    this.setupSphere(texture);
                    URL.revokeObjectURL(url);
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
                this.setupSphere(texture);
                // 動画のメタデータ読み込み後にイベント発火
                document.dispatchEvent(new Event('panoramaReady'));
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
        geometry.scale(-1, 1, 1); // 内側を見るために反転

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.FrontSide,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
    }

    // ----- 破棄 -----
    disposeCurrent() {
        if (this.mesh) {
            this.mesh.geometry.dispose();
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

    // ----- レンダー -----
    animate() {
        this.animationId = requestAnimationFrame(this.animate.bind(this));

        // Three.js r160+ VideoTexture は自動更新なので needsUpdate は不要
        this.updateCamera();
        this.renderer.render(this.scene, this.camera);
    }

    // ----- リサイズ -----
    onResize() {
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        if (w === 0 || h === 0) return;

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    // ----- マウスイベント -----
    onMouseDown(e) {
        this.isDragging = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.startLon = this.lon;
        this.startLat = this.lat;
    }

    onMouseMove(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;
        this.lon = this.startLon - dx * 0.2;
        this.lat = this.startLat + dy * 0.2;
    }

    onMouseUp() {
        this.isDragging = false;
    }

    // ----- ホイール -----
    onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY * 0.05;
        this.fov = Math.max(this.minFov, Math.min(this.maxFov, this.fov + delta));
    }

    // ----- タッチイベント -----
    onTouchStart(e) {
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.startX = e.touches[0].clientX;
            this.startY = e.touches[0].clientY;
            this.startLon = this.lon;
            this.startLat = this.lat;
        } else if (e.touches.length === 2) {
            this.isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.lastTouchDist = Math.sqrt(dx * dx + dy * dy);
        }
    }

    onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && this.isDragging) {
            const dx = e.touches[0].clientX - this.startX;
            const dy = e.touches[0].clientY - this.startY;
            this.lon = this.startLon - dx * 0.3;
            this.lat = this.startLat + dy * 0.3;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const delta = this.lastTouchDist - dist;
            this.fov = Math.max(this.minFov, Math.min(this.maxFov, this.fov + delta * 0.1));
            this.lastTouchDist = dist;
        }
    }

    onTouchEnd() {
        this.isDragging = false;
        this.lastTouchDist = 0;
    }

    // ----- 破棄 -----
    destroy() {
        cancelAnimationFrame(this.animationId);
        this.resizeObserver.disconnect();
        this.disposeCurrent();
        this.renderer.dispose();
    }
}
