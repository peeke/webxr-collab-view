const MODEL_OBJ_URL = "/assets/ArcticFox_Posed.obj";
const MODEL_MTL_URL = "/assets/ArcticFox_Posed.mtl";
const MODEL_SCALE = 0.02;

class App {
  constructor() {
    this.onXRFrame = this.onXRFrame.bind(this);
    this.onEnterAR = this.onEnterAR.bind(this);
    this.onClick = this.onClick.bind(this);

    this.init();
  }

  async init() {
    if (!navigator.xr || !XRSession.prototype.requestHitTest) {
      this.onNoXRDevice();
      return;
    }

    try {
      this.device = await navigator.xr.requestDevice();
      document.addEventListener("click", this.onEnterAR);
    } catch (e) {
      this.onNoXRDevice();
    }
  }

  async onEnterAR() {
    document.removeEventListener("click", this.onEnterAR);

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = window.innerWidth;
    outputCanvas.height = window.innerHeight;
    const ctx = outputCanvas.getContext("xrpresent");

    try {
      const session = await this.device.requestSession({
        outputContext: ctx,
        environmentIntegration: true
      });

      document.body.appendChild(outputCanvas);
      this.onSessionStarted(session);
    } catch (e) {
      this.onNoXRDevice();
    }
  }

  setupRenderer(xr) {
    const options = xr
      ? {
          alpha: true,
          preserveDrawingBuffer: true,
          autoClear: false
        }
      : {
          alpha: true
        };

    const renderer = new THREE.WebGLRenderer(options);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    return renderer;
  }

  setupComposer(renderer, scene, camera) {
    const composer = new THREE.EffectComposer(renderer);

    const renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);

    const ssaoPass = new THREE.SSAOPass(scene, camera, false, true);
    // ssaoPass.renderToScreen = true;
    composer.addPass(ssaoPass);

    // ssaoPass.onlyAO = true;
    ssaoPass.radius = 64;
    ssaoPass.aoClamp = 1;
    ssaoPass.lumInfluence = 1;

    const saoPass = new THREE.SAOPass(scene, camera, false, true);
    saoPass.renderToScreen = true;
    composer.addPass(saoPass);

    saoPass.params = {
      output: THREE.SAOPass.OUTPUT.Default,
      saoBias: 1,
      saoIntensity: 0.00015,
      saoScale: 1,
      saoKernelRadius: 32,
      saoMinResolution: 0,
      saoBlur: true,
      saoBlurRadius: 20,
      saoBlurDepthCutoff: 0.0025,
      saoBlurStdDev: 12
    };

    return composer;
  }

  loadModel() {
    return new Promise(resolve => {
      const loader = new THREE.PLYLoader();
      loader.load("/assets/dennis/deniax.ply", bufferGeometry => {
        const geometry = new THREE.Geometry().fromBufferGeometry(
          bufferGeometry
        );
        const material = new THREE.MeshPhongMaterial({
          specular: 0x111111,
          shininess: 0,
          vertexColors: THREE.VertexColors
        });

        const model = new THREE.Mesh(geometry, material);
        model.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        model.rotation.x = THREE.Math.degToRad(-90);
        model.castShadow = true;
        model.receiveShadow = true;

        resolve(model);
      });
    });
  }

  onNoXRDevice() {
    document.body.classList.add("unsupported");

    this.renderer = this.setupRenderer(false);
    this.scene = setupScene();

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );

    this.composer = this.setupComposer(this.renderer, this.scene, this.camera);

    this.camera.position.set(-1, 1, 1);
    console.log(this.camera.rotation);

    const controls = new THREE.OrbitControls(this.camera);
    controls.target.set(0, 0, 0);
    controls.update();

    document.body.appendChild(this.renderer.domElement);
    this.renderer.domElement.width = window.innerWidth;
    this.renderer.domElement.height = window.innerHeight;
    this.resize({ width: window.innerWidth, height: window.innerHeight });

    this.loadModel().then(model => {
      this.model = model;
      this.scene.add(model);
      this.camera.lookAt(this.model.position);
    });

    const render = () => {
      this.render();
      requestAnimationFrame(render);
    };

    render();
  }

  async onSessionStarted(session) {
    this.session = session;
    document.body.classList.add("ar");

    this.renderer = this.setupRenderer(true);
    this.scene = setupScene();
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;

    this.loadModel().then(model => {
      this.model = model;
      this.model.visible = false;
      this.scene.add(model);
    });

    this.composer = this.setupComposer(this.renderer, this.scene, this.camera);

    this.gl = this.renderer.getContext();

    await this.gl.setCompatibleXRDevice(this.session.device);

    this.session.baseLayer = new XRWebGLLayer(this.session, this.gl);

    fixFramebuffer(this);

    this.reticle = new Reticle(this.session, this.camera);
    this.scene.add(this.reticle);

    this.frameOfRef = await this.session.requestFrameOfReference("eye-level");
    this.session.requestAnimationFrame(this.onXRFrame);

    window.addEventListener("click", this.onClick);
  }

  onXRFrame(time, frame) {
    let session = frame.session;
    let pose = frame.getDevicePose(this.frameOfRef);

    this.reticle.update(this.frameOfRef);

    if (this.reticle.visible && !this.stabilized) {
      this.stabilized = true;
      console.log("stabilized");
      document.body.classList.add("stabilized");
    }

    session.requestAnimationFrame(this.onXRFrame);

    this.gl.bindFramebuffer(
      this.gl.FRAMEBUFFER,
      this.session.baseLayer.framebuffer
    );

    if (pose) {
      for (let view of frame.views) {
        const viewport = session.baseLayer.getViewport(view);

        this.resize(viewport);

        this.camera.projectionMatrix.fromArray(view.projectionMatrix);
        const viewMatrix = new THREE.Matrix4().fromArray(
          pose.getViewMatrix(view)
        );
        this.camera.matrix.getInverse(viewMatrix);
        this.camera.updateMatrixWorld(true);

        // this.renderer.clearDepth();

        this.render();
      }
    }
  }

  resize(viewport) {
    this.renderer.setSize(viewport.width, viewport.height);
    this.composer && this.composer.setSize(viewport.width, viewport.height);
  }

  render() {
    this.composer
      ? this.composer.render()
      : this.renderer.render(this.scene, this.camera);
  }

  async onClick(e) {
    if (!this.model) {
      console.log("no model loaded");
      return;
    }

    this.raycaster = this.raycaster || new THREE.Raycaster();
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const ray = this.raycaster.ray;

    // for `XRSession.prototype.requestHitTest` can be found here:
    // https://github.com/immersive-web/hit-test
    const origin = new Float32Array(ray.origin.toArray());
    const direction = new Float32Array(ray.direction.toArray());
    const hits = await this.session.requestHitTest(
      origin,
      direction,
      this.frameOfRef
    );

    if (hits.length) {
      const hit = hits[0];
      const hitMatrix = new THREE.Matrix4().fromArray(hit.hitMatrix);

      this.model.position.setFromMatrixPosition(hitMatrix);
      this.model.visible = true;
      console.log("show model");

      lookAtOnY(this.scene, this.camera);

      const shadowMesh = this.scene.children.find(c => c.name === "shadowMesh");
      shadowMesh.position.y = this.model.position.y;

      this.scene.add(this.model);
    }
  }
}

window.app = new App();

class Reticle extends THREE.Object3D {
  constructor(xrSession, camera) {
    super();

    this.loader = new THREE.TextureLoader();

    let geometry = new THREE.RingGeometry(0.1, 0.11, 24, 1);
    let material = new THREE.MeshBasicMaterial({ color: 0xffffff });

    geometry.applyMatrix(
      new THREE.Matrix4().makeRotationX(THREE.Math.degToRad(-90))
    );

    this.ring = new THREE.Mesh(geometry, material);

    geometry = new THREE.PlaneBufferGeometry(0.15, 0.15);
    geometry.applyMatrix(
      new THREE.Matrix4().makeRotationX(THREE.Math.degToRad(-90))
    );
    geometry.applyMatrix(
      new THREE.Matrix4().makeRotationY(THREE.Math.degToRad(0))
    );
    material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0
    });
    this.icon = new THREE.Mesh(geometry, material);

    this.loader.load("../assets/Anchor.png", texture => {
      this.icon.material.opacity = 1;
      this.icon.material.map = texture;
    });

    this.add(this.ring);
    this.add(this.icon);

    this.session = xrSession;
    this.visible = false;
    this.camera = camera;
  }

  async update(frameOfRef) {
    const hits = await this.getHits(frameOfRef);

    if (hits.length) {
      const hit = hits[0];
      const hitMatrix = new THREE.Matrix4().fromArray(hit.hitMatrix);
      this.position.setFromMatrixPosition(hitMatrix);

      lookAtOnY(this, this.camera);

      this.visible = true;
    }
  }

  async getHits(frameOfRef) {
    try {
      this.raycaster = this.raycaster || new THREE.Raycaster();
      this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);

      const ray = this.raycaster.ray;
      const origin = new Float32Array(ray.origin.toArray());
      const direction = new Float32Array(ray.direction.toArray());

      return this.session.requestHitTest(origin, direction, frameOfRef);
    } catch (e) {
      return [];
    }
  }
}

function setupScene() {
  const scene = new THREE.Scene();

  const light = new THREE.AmbientLight(0xffffff, 1);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
  directionalLight.position.set(10, 15, 1);
  directionalLight.lookAt(0, 0, 0);

  directionalLight.castShadow = true;

  const planeGeometry = new THREE.PlaneGeometry(2000, 2000);
  planeGeometry.rotateX(-Math.PI / 2);

  var axesHelper = new THREE.AxesHelper(5);
  scene.add(axesHelper);

  const shadowMesh = new THREE.Mesh(
    planeGeometry,
    new THREE.ShadowMaterial({
      color: 0x111111,
      opacity: 0.2
    })
  );

  shadowMesh.name = "shadowMesh";
  shadowMesh.receiveShadow = true;
  shadowMesh.position.y = 10000;

  scene.add(shadowMesh);
  scene.add(light);
  scene.add(directionalLight);

  return scene;
}

function lookAtOnY(looker, target) {
  const targetPos = new THREE.Vector3().setFromMatrixPosition(
    target.matrixWorld
  );

  const angle = Math.atan2(
    targetPos.x - looker.position.x,
    targetPos.z - looker.position.z
  );
  looker.rotation.set(looker.rotation.x, angle, looker.rotation.z);
}

function fixFramebuffer(app) {
  THREE.Object3D.prototype.onBeforeRender = () => {
    app.gl.bindFramebuffer(
      app.gl.FRAMEBUFFER,
      app.session.baseLayer.framebuffer
    );
  };
}
