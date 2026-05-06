"use client";

import { useEffect, useRef } from "react";

// Static autoRotating matcap stone for the hero. WebGL only, so it works in
// every browser (the per-stream stone is the WebGPU/TSL one).
export default function StoneHero() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId: number | null = null;

    async function init() {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      if (disposed || !container) return;

      const scene = new THREE.Scene();
      const aspect = container.clientWidth / container.clientHeight;
      const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
      camera.position.set(0, 0.5, 5.5);
      camera.lookAt(0, 0, 0);

      const textureLoader = new THREE.TextureLoader();
      const matcapTex = await new Promise<InstanceType<typeof THREE.Texture>>(
        (resolve, reject) => {
          textureLoader.load("/matcap.jpg", resolve, undefined, reject);
        },
      );
      matcapTex.colorSpace = THREE.SRGBColorSpace;
      if (disposed) return;

      const gltfLoader = new GLTFLoader();
      const gltf = await new Promise<{ scene: InstanceType<typeof THREE.Group> }>(
        (resolve, reject) => {
          gltfLoader.load("/magic_stone.glb", resolve, undefined, reject);
        },
      );
      if (disposed) return;

      const mat = new THREE.MeshMatcapMaterial({ matcap: matcapTex });

      const box = new THREE.Box3().setFromObject(gltf.scene);
      const ctr = box.getCenter(new THREE.Vector3());
      const sz = box.getSize(new THREE.Vector3());
      const scl = 3 / Math.max(sz.x, sz.y, sz.z);
      gltf.scene.scale.setScalar(scl);
      gltf.scene.position.copy(ctr).multiplyScalar(-scl);

      gltf.scene.traverse((child) => {
        const mesh = child as InstanceType<typeof THREE.Mesh>;
        if (mesh.isMesh) mesh.material = mat;
      });
      scene.add(gltf.scene);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);

      if (disposed) {
        renderer.dispose();
        return;
      }

      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.enableRotate = false;
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.5;

      if (disposed) {
        controls.dispose();
        renderer.dispose();
        return;
      }

      function animate() {
        if (disposed) return;
        frameId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

      const onResize = () => {
        if (disposed || !container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("resize", onResize);
        if (frameId !== null) cancelAnimationFrame(frameId);
        controls.dispose();
        mat.dispose();
        matcapTex.dispose();
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    }

    let cleanup: (() => void) | undefined;
    init()
      .then((fn) => {
        cleanup = fn;
      })
      .catch((e) => {
        console.error("StoneHero init error:", e);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
