import { useRef, type CSSProperties } from "react";

/**
 * 3D hover-tilt: returns ref + style; card tilts toward the cursor.
 */
export function useTilt(maxDeg = 7) {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-y * maxDeg).toFixed(2)}deg) rotateY(${(x * maxDeg).toFixed(2)}deg) translateY(-3px)`;
    el.style.boxShadow = "0 18px 45px rgba(11,19,43,0.12)";
  };

  const onMouseLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0)";
    el.style.boxShadow = "";
  };

  const style: CSSProperties = {};
  return { ref, onMouseMove, onMouseLeave, style };
}
