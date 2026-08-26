import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Tooth } from "@/components/ToothIcon";

/**
 * Interactive 3D tooth — drag with mouse/touch to rotate 360°.
 * Procedural molar: glossy crown + twin roots + orbital ring, teal-lit.
 * Falls back to a static emblem when WebGL is unavailable.
 */
export function Tooth3D({ className = "" }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.4, 5.2);

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      console.warn("WebGL unavailable — 3D tooth disabled", e);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time error fallback when WebGL init fails
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // Lighting — studio look
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x2ee6c8, 1.1);
    rim.position.set(-4, -1, -3);
    scene.add(rim);
    const fill = new THREE.PointLight(0x7c8cff, 0.8, 20);
    fill.position.set(-2, 3, 2);
    scene.add(fill);

    const group = new THREE.Group();
    scene.add(group);

    const enamel = new THREE.MeshPhysicalMaterial({
      color: 0xf4fbff,
      roughness: 0.12,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
      reflectivity: 0.6,
    });

    // Crown — squashed sphere with a slight waist
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.95, 48, 48), enamel);
    crown.scale.set(1.08, 0.92, 1.0);
    crown.position.y = 0.72;
    group.add(crown);

    // Cusps on top of the crown (molar bumps)
    const cuspGeo = new THREE.SphereGeometry(0.24, 24, 24);
    const cuspOffsets: Array<[number, number]> = [
      [0.42, 0.4],
      [-0.42, 0.4],
      [0.42, -0.4],
      [-0.42, -0.4],
    ];
    for (const [x, z] of cuspOffsets) {
      const cusp = new THREE.Mesh(cuspGeo, enamel);
      cusp.position.set(x, 1.52, z);
      cusp.scale.set(1, 0.7, 1);
      group.add(cusp);
    }

    // Twin roots — tapered cones curving outward
    const rootGeo = new THREE.ConeGeometry(0.34, 1.5, 32);
    const rootL = new THREE.Mesh(rootGeo, enamel);
    rootL.position.set(-0.42, -0.75, 0);
    rootL.rotation.z = Math.PI + 0.22;
    rootL.scale.set(1, 1, 0.8);
    group.add(rootL);
    const rootR = new THREE.Mesh(rootGeo, enamel);
    rootR.position.set(0.42, -0.75, 0);
    rootR.rotation.z = Math.PI - 0.22;
    rootR.scale.set(1, 1, 0.8);
    group.add(rootR);

    // Orbital ring (reference-style halo)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.018, 16, 128),
      new THREE.MeshBasicMaterial({ color: 0x22d3c5, transparent: true, opacity: 0.65 }),
    );
    ring.rotation.x = Math.PI / 2.25;
    group.add(ring);
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(2.15, 0.012, 16, 128),
      new THREE.MeshBasicMaterial({ color: 0x8b9dff, transparent: true, opacity: 0.4 }),
    );
    ring2.rotation.x = Math.PI / 1.9;
    ring2.rotation.y = 0.4;
    group.add(ring2);

    // Floating sparkle dots
    const dotGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x2ee6c8 });
    const dots: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      const a = (i / 8) * Math.PI * 2;
      d.position.set(Math.cos(a) * 2.3, Math.sin(a * 2) * 0.7, Math.sin(a) * 2.3);
      dots.push(d);
      group.add(d);
    }

    group.position.y = -0.1;

    // --- Interaction: drag to rotate 360° ---
    let dragging = false;
    let px = 0;
    let py = 0;
    let velY = 0.004; // idle auto-spin
    const el = renderer.domElement;
    el.style.cursor = "grab";
    el.style.touchAction = "none";

    const down = (e: PointerEvent) => {
      dragging = true;
      px = e.clientX;
      py = e.clientY;
      el.style.cursor = "grabbing";
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      group.rotation.y += dx * 0.012;
      group.rotation.x = Math.max(-0.9, Math.min(0.9, group.rotation.x + dy * 0.008));
      velY = dx * 0.012;
    };
    const up = () => {
      dragging = false;
      el.style.cursor = "grab";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      if (!dragging) {
        // ease back to a gentle idle spin
        velY += (0.004 - velY) * 0.03;
        group.rotation.y += velY;
      }
      group.position.y = -0.1 + Math.sin(t * 1.4) * 0.06;
      ring.rotation.z = t * 0.25;
      ring2.rotation.z = -t * 0.18;
      dots.forEach((d, i) => {
        d.position.y = Math.sin(t * 1.6 + i) * 0.75;
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", up);
      if (el.parentNode === mount) mount.removeChild(el);
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    };
  }, []);

  if (failed) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-teal-100/60 blur-2xl scale-150" />
          <div className="relative h-28 w-28 rounded-full bg-gradient-to-br from-[#0DC9B7] to-[#12B5E5] flex items-center justify-center text-white shadow-xl shadow-teal-500/30">
            <Tooth className="h-14 w-14" />
          </div>
        </div>
      </div>
    );
  }

  return <div ref={mountRef} className={className} />;
}