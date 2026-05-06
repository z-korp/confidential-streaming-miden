"use client";

// Per-stream 3D stone visualization. Three zones:
//   - gold (bottom)  → claimed (settled, recipient owns)
//   - red  (middle)  → unlocked-but-not-yet-claimed (available now)
//   - matcap (top)   → still locked
//
// Adapted from the inspirational `OnyxStoneStream` component (Zama / fhEVM
// continuous streams). Here the inputs reflect Miden's discrete tranches.

import { useEffect, useRef } from "react";

interface StoneStreamProps {
  claimedPercent: number;
  unlockedPercent: number;
  animateClaim?: boolean;
  onClaimComplete?: () => void;
}

export default function StoneStream({
  claimedPercent,
  unlockedPercent,
  animateClaim,
  onClaimComplete,
}: StoneStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const propsRef = useRef({
    claimedPercent,
    unlockedPercent,
    animateClaim,
    onClaimComplete,
  });
  propsRef.current = {
    claimedPercent,
    unlockedPercent,
    animateClaim,
    onClaimComplete,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    async function init() {
      const THREE = await import("three/webgpu");
      const {
        Fn,
        float,
        vec3,
        uniform,
        positionLocal,
        positionWorld,
        mix,
        smoothstep,
        time,
        pow,
        sin,
        texture,
        matcapUV,
        mx_fractal_noise_float,
      } = await import("three/tsl");
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");

      if (disposed || !container) return;

      const scene = new THREE.Scene();
      const aspect = container.clientWidth / container.clientHeight;
      const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
      camera.position.set(0, 0, 14); // intro start
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

      // Threshold uniforms: y in [-1.5, 1.5] split into [bottom..claimed..unlocked..top]
      const claimedThresholdU = uniform(
        -1.5 + (propsRef.current.claimedPercent / 100) * 3,
      );
      const unlockedThresholdU = uniform(
        -1.5 +
          ((propsRef.current.claimedPercent + propsRef.current.unlockedPercent) /
            100) *
            3,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function makeEdgeBlend(threshold: any, t: any) {
        const borderNoise = mx_fractal_noise_float(
          positionWorld
            .mul(8.0)
            .add(vec3(t.mul(0.5), t.mul(0.3), t.mul(0.4))),
          float(4),
          float(2.0),
          float(0.5),
          float(1.0),
        );
        const edge = positionWorld.y.sub(threshold).add(borderNoise.mul(0.15));
        return smoothstep(float(-0.08), float(0.08), edge);
      }

      function ridgedCracks(
        p: ReturnType<typeof vec3>,
        t: ReturnType<typeof float>,
        freq: number,
        sharpness: number,
      ) {
        const vp = p.mul(freq).add(vec3(t.mul(0.12), t.mul(0.06), t.mul(-0.08)));
        const n = mx_fractal_noise_float(
          vp,
          float(5),
          float(2.2),
          float(0.5),
          float(1.0),
        );
        const ridge = float(1.0).sub(n.abs().mul(2.0).clamp(0, 1));
        return pow(ridge, float(sharpness));
      }

      function fissureIntensity(
        p: ReturnType<typeof vec3>,
        t: ReturnType<typeof float>,
      ) {
        const c1 = ridgedCracks(p, t, 2.5, 6);
        const c2 = ridgedCracks(
          vec3(p.z, p.y.mul(1.3), p.x),
          t.mul(0.8),
          4.0,
          10,
        );
        const c3 = ridgedCracks(p.mul(1.5), t.mul(1.5), 7.0, 18);
        return c1.mul(0.55).add(c2.mul(0.35)).add(c3.mul(0.15)).clamp(0, 1);
      }

      const mat = new THREE.MeshBasicNodeMaterial();
      mat.colorNode = Fn(() => {
        const p = positionLocal.mul(2.8);
        const t = time.mul(0.4);
        const matcapColor = texture(matcapTex, matcapUV).rgb;

        const fi = fissureIntensity(p, t);
        const pulse = sin(t.mul(3.0)).mul(0.5).add(0.5).mul(0.4).add(0.6);
        const crack = fi.mul(pulse);

        const darkStone = vec3(0.01, 0.01, 0.012);

        // Gold fissures — claimed zone (bottom)
        const goldCore = mix(
          vec3(1.0, 0.75, 0.0),
          vec3(1.0, 0.95, 0.5),
          crack,
        );
        const goldGlow = vec3(1.0, 0.6, 0.0).mul(crack.mul(3.0));
        const goldColor = mix(darkStone, goldCore, crack).add(goldGlow);

        // Red fissures — unlocked zone (middle, "ready to claim")
        const redCore = mix(
          vec3(0.9, 0.05, 0.0),
          vec3(1.0, 0.3, 0.05),
          crack,
        );
        const redGlow = vec3(0.8, 0.02, 0.0).mul(crack.mul(2.5));
        const redColor = mix(darkStone, redCore, crack).add(redGlow);

        const blendClaimed = makeEdgeBlend(claimedThresholdU, t);
        const blendUnlocked = makeEdgeBlend(unlockedThresholdU, t);

        const goldToRed = mix(goldColor, redColor, blendClaimed);
        return mix(goldToRed, matcapColor, blendUnlocked);
      })();

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
      const stoneBaseY = gltf.scene.position.y;

      scene.add(new THREE.AmbientLight(0x111122, 1.0));
      const keyLight = new THREE.DirectionalLight(0xffeedd, 2.0);
      keyLight.position.set(3, 5, 4);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x4466aa, 1.0);
      rimLight.position.set(-3, 2, -4);
      scene.add(rimLight);

      // Withdraw / claim merge animation (gold zone eats red zone)
      let claimAnim = {
        active: false,
        elapsed: 0,
        duration: 1.5,
        prevFlag: false,
        startClaimedTh: 0,
        targetClaimedTh: 0,
      };

      const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);

      try {
        await renderer.init();
      } catch {
        console.error("WebGPU not supported — stream stone disabled.");
        return;
      }
      if (disposed) {
        renderer.dispose();
        return;
      }

      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.enablePan = false;
      controls.minDistance = 2;
      controls.maxDistance = 8;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.0;
      controls.minPolarAngle = Math.PI / 2;
      controls.maxPolarAngle = Math.PI / 2;
      controls.enabled = false; // disabled during intro

      if (disposed) {
        controls.dispose();
        renderer.dispose();
        return;
      }

      // Legend callout anchors (projected each frame)
      const projVec = new THREE.Vector3();
      const calloutAnchors = [
        new THREE.Vector3(0, 1.2, 0), // [0] Locked
        new THREE.Vector3(0, 0, 0), // [1] Claimed
        new THREE.Vector3(0, 0, 0), // [2] Unlocked
      ];
      const LINE_LEN = 100;

      const introTarget = new THREE.Vector3(0, 0, 7);
      let introTimer = 0;
      const introDuration = 2;
      let introComplete = false;

      const clock = new THREE.Clock();
      let elapsed = 0;
      let baseClaimedTh = -1.5 + (propsRef.current.claimedPercent / 100) * 3;
      let baseUnlockedTh =
        -1.5 +
        ((propsRef.current.claimedPercent + propsRef.current.unlockedPercent) /
          100) *
          3;
      let firstFrame = true;

      renderer.setAnimationLoop(() => {
        if (disposed) return;
        const dt = Math.min(clock.getDelta(), 0.1);
        elapsed += dt;

        const levOffset = Math.sin(elapsed * 1.5) * 0.15;
        gltf.scene.position.y = stoneBaseY + levOffset;

        if (!introComplete) {
          introTimer += dt;
          const tt = Math.min(introTimer / introDuration, 1);
          const ease = tt * tt * (3 - 2 * tt);
          camera.position.lerpVectors(
            new THREE.Vector3(0, 0, 14),
            introTarget,
            ease,
          );
          camera.lookAt(0, 0, 0);
          if (tt >= 1) {
            introComplete = true;
            controls.enabled = true;
          }
        }

        // Rising edge of animateClaim: capture targets for the merge animation
        const curFlag = !!propsRef.current.animateClaim;
        if (curFlag && !claimAnim.prevFlag) {
          claimAnim = {
            active: true,
            elapsed: 0,
            duration: 1.5,
            prevFlag: true,
            startClaimedTh: baseClaimedTh,
            targetClaimedTh: baseUnlockedTh,
          };
        }
        claimAnim.prevFlag = curFlag;

        const targetClaimedTh =
          -1.5 + (propsRef.current.claimedPercent / 100) * 3;
        const targetUnlockedTh =
          -1.5 +
          ((propsRef.current.claimedPercent +
            propsRef.current.unlockedPercent) /
            100) *
            3;

        if (firstFrame) {
          baseClaimedTh = targetClaimedTh;
          baseUnlockedTh = targetUnlockedTh;
          firstFrame = false;
        } else if (claimAnim.active) {
          claimAnim.elapsed += dt;
          const tt = Math.min(claimAnim.elapsed / claimAnim.duration, 1);
          const ease = tt * tt * (3 - 2 * tt);
          baseClaimedTh =
            claimAnim.startClaimedTh +
            (claimAnim.targetClaimedTh - claimAnim.startClaimedTh) * ease;
          baseUnlockedTh +=
            (targetUnlockedTh - baseUnlockedTh) * Math.min(dt * 4, 1);

          if (tt >= 1) {
            claimAnim.active = false;
            baseClaimedTh = targetClaimedTh;
            propsRef.current.onClaimComplete?.();
          }
        } else {
          baseClaimedTh +=
            (targetClaimedTh - baseClaimedTh) * Math.min(dt * 8, 1);
          baseUnlockedTh +=
            (targetUnlockedTh - baseUnlockedTh) * Math.min(dt * 8, 1);
        }
        claimedThresholdU.value = baseClaimedTh + levOffset;
        unlockedThresholdU.value = baseUnlockedTh + levOffset;

        // Update legend callouts
        const svg = svgRef.current;
        if (svg && container) {
          const w = container.clientWidth;
          const h = container.clientHeight;
          const stoneBottom = -1.5 + levOffset;
          const stoneTop = 1.5 + levOffset;
          calloutAnchors[1].y = (stoneBottom + claimedThresholdU.value) / 2;
          calloutAnchors[2].y =
            (claimedThresholdU.value + unlockedThresholdU.value) / 2;
          calloutAnchors[0].y = (unlockedThresholdU.value + stoneTop) / 2;

          const claimed = Math.round(propsRef.current.claimedPercent);
          const unlocked = Math.round(propsRef.current.unlockedPercent);
          const locked = Math.max(0, 100 - claimed - unlocked);

          const labels = [
            `Locked · ${locked}%`,
            `Claimed · ${claimed}%`,
            `Unlocked · ${unlocked}%`,
          ];

          for (let ci = 0; ci < 3; ci++) {
            const g = svg.children[ci] as SVGGElement;
            if (!g) continue;

            if (!introComplete) {
              g.setAttribute("visibility", "hidden");
              continue;
            }

            const isFullyLocked = locked >= 100;
            if (isFullyLocked && ci !== 0) {
              g.setAttribute("visibility", "hidden");
              continue;
            }
            // Hide claimed legend if zone empty
            if (ci === 1 && claimed <= 0) {
              g.setAttribute("visibility", "hidden");
              continue;
            }
            // Hide unlocked legend if zone empty
            if (ci === 2 && unlocked <= 0) {
              g.setAttribute("visibility", "hidden");
              continue;
            }

            g.setAttribute("visibility", "visible");
            projVec.copy(calloutAnchors[ci]).project(camera);
            let sx = (projVec.x * 0.5 + 0.5) * w;
            const sy = (-projVec.y * 0.5 + 0.5) * h;
            if (ci === 1 || ci === 2) sx = w * 0.5;
            const ex = sx + LINE_LEN;

            const dot = g.children[0] as SVGCircleElement;
            const line = g.children[1] as SVGLineElement;
            const text = g.children[2] as SVGTextElement;

            if (dot && line && text) {
              dot.setAttribute("cx", String(sx));
              dot.setAttribute("cy", String(sy));
              line.setAttribute("x1", String(sx));
              line.setAttribute("y1", String(sy));
              line.setAttribute("x2", String(ex));
              line.setAttribute("y2", String(sy));
              text.setAttribute("x", String(ex + 8));
              text.setAttribute("y", String(sy + 4));
              text.textContent = labels[ci];
            }
          }
        }

        controls.update();
        renderer.render(scene, camera);
      });

      const onResize = () => {
        if (disposed || !container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("resize", onResize);
        renderer.setAnimationLoop(null);
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
        console.error("StoneStream init error:", e);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <svg
        ref={svgRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle r={3} fill="white" fillOpacity={0.4} />
            <line
              stroke="white"
              strokeOpacity={0.4}
              strokeWidth={1}
              strokeLinecap="round"
            />
            <text
              fill="white"
              fillOpacity={0.6}
              fontSize={11}
              fontFamily="system-ui, sans-serif"
              fontWeight={500}
              dominantBaseline="middle"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
