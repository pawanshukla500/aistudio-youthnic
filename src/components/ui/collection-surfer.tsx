"use client";

import { useEffect, useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useMotionValue,
  useAnimationFrame,
  type MotionValue,
} from "framer-motion";

export interface CollectionItem {
  id: number;
  image: string;
  title: string;
  subtitle?: string;
}

export type CollectionSurferVariant = "magnetic" | "uplift" | "simple";

const FALLBACK_EDITORIAL_IMAGES = [
  "/images/editorial/editorial-saree-front.webp",
  "/images/editorial/editorial-saree-back.webp",
  "/images/editorial/editorial-saree-detail.webp",
  "/images/editorial/editorial-ref-1.webp",
];

// Default items blending real Youthnic studio renders with verified high-resolution fashion editorials
const ITEMS: CollectionItem[] = [
  {
    id: 1,
    image: "/images/editorial/editorial-saree-front.webp",
    title: "HERITAGE 01",
    subtitle: "Hero Front · Silk Saree Drape",
  },
  {
    id: 2,
    image: "/images/editorial/editorial-saree-back.webp",
    title: "HERITAGE 02",
    subtitle: "True Back · Pallu & Blouse Architecture",
  },
  {
    id: 3,
    image: "/images/editorial/editorial-saree-detail.webp",
    title: "HERITAGE 03",
    subtitle: "Craft Macro · Zari Border Fidelity",
  },
  {
    id: 4,
    image: "/images/editorial/editorial-ref-1.webp",
    title: "HERITAGE 04",
    subtitle: "Studio Set · Editorial Lighting Lock",
  },
  {
    id: 5,
    image:
      "https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 05",
    subtitle: "Banarasi Brocade · Festive Edit",
  },
  {
    id: 6,
    image:
      "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 06",
    subtitle: "Handloom Silk · Royal Drape",
  },
  {
    id: 7,
    image:
      "https://images.unsplash.com/photo-1583391733975-207936a6e5a6?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 07",
    subtitle: "Farshi Salwar · 4-Inch Taper Cut",
  },
  {
    id: 8,
    image:
      "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 08",
    subtitle: "Zardozi Couture · Bridal Lehenga",
  },
  {
    id: 9,
    image:
      "https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 09",
    subtitle: "Atelier Silhouette · Full Length",
  },
  {
    id: 10,
    image:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 10",
    subtitle: "Contemporary Fusion · Lookbook",
  },
  {
    id: 11,
    image:
      "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 11",
    subtitle: "Editorial Portrait · Natural Skin",
  },
  {
    id: 12,
    image:
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 12",
    subtitle: "Studio Motion · Showcase Frame",
  },
  {
    id: 13,
    image:
      "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 13",
    subtitle: "Chanderi Weave · Textile Truth",
  },
  {
    id: 14,
    image:
      "https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 14",
    subtitle: "Runway Direction · High Contrast",
  },
  {
    id: 15,
    image:
      "https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 15",
    subtitle: "Organza Dupatta · Drape Physics",
  },
  {
    id: 16,
    image:
      "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=800&q=80",
    title: "HERITAGE 16",
    subtitle: "Resort Edit · Warm Daylight",
  },
];

export interface CollectionSurferProps {
  items?: CollectionItem[];
  variant?: CollectionSurferVariant;
  className?: string;
  title?: string;
  subtitle?: string;
  showOverlays?: boolean;
  autoPlay?: boolean;
  autoPlaySpeed?: number;
  perspectiveOrigin?: string;
}

export function CollectionSurfer({
  items = ITEMS,
  variant = "magnetic",
  className = "",
  title = "HERITAGE FW25/26",
  subtitle = "COLLECTION",
  showOverlays = true,
  autoPlay = false,
  autoPlaySpeed = 48,
  perspectiveOrigin = "14% 18%",
}: CollectionSurferProps) {
  const safeItems = items.length > 0 ? items : ITEMS;
  // 1. Loop Setup: Repeat short collections so the base track always covers at least 16 visible slots,
  // then duplicate with a 2-card tail buffer so slots [-2 .. baseTrack.length - 1] match across the wrap boundary.
  const repeatCount = Math.max(1, Math.ceil(16 / safeItems.length));
  const baseTrack = Array.from({ length: repeatCount }, () => safeItems).flat();
  const duplicatedItems = [
    ...baseTrack,
    ...baseTrack,
    ...baseTrack.slice(0, 2),
  ];

  // Scroll sensitivity
  const scrollPerItem = 600;

  // The exact scroll distance to complete one full loop of the baseTrack items
  const loopDistance = baseTrack.length * scrollPerItem;

  const { scrollY } = useScroll();

  const smoothScroll = useSpring(scrollY, {
    mass: 0.1,
    stiffness: 100,
    damping: 20,
  });

  // Continuous ambient runway glide + bidirectional wheel support
  const wheelOffset = useMotionValue(0);
  const smoothWheel = useSpring(wheelOffset, {
    mass: 0.1,
    stiffness: 100,
    damping: 20,
  });
  const autoOffset = useMotionValue(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mediaQuery.matches;
    const listener = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-surfer-ignore='true']")) return;
      // In embedded mode (!showOverlays) or when scrolling upward at the top of the page,
      // feed wheel delta into smoothWheel so surfing works without document scroll coupling.
      if (!showOverlays || (window.scrollY <= 0 && e.deltaY < 0)) {
        wheelOffset.set(wheelOffset.get() + e.deltaY * 1.2);
      }
    };
    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [showOverlays, wheelOffset]);

  useAnimationFrame((_, delta) => {
    if (!autoPlay || reducedMotionRef.current) return;
    // Cap delta to prevent jumps after tab backgrounding
    const clampedDelta = Math.min(delta, 64);
    autoOffset.set(autoOffset.get() + (clampedDelta / 1000) * autoPlaySpeed);
  });

  const combinedScroll = useTransform(
    [smoothScroll, smoothWheel, autoOffset],
    (values) =>
      (showOverlays ? Number(values[0]) : 0) +
      Number(values[1]) +
      Number(values[2]),
  );

  // 2. Positive Modulo Logic: loops 0 -> loopDistance -> 0 smoothly in both directions
  const loopedProgress = useTransform(
    combinedScroll,
    (value) => ((value % loopDistance) + loopDistance) % loopDistance,
  );

  // Step vector
  const stepX = 240;
  const stepY = -84;
  const stepZ = -288;

  // Move the scene backwards by the length of ONE baseTrack set
  const x = useTransform(
    loopedProgress,
    [0, loopDistance],
    [0, -baseTrack.length * stepX],
  );
  const y = useTransform(
    loopedProgress,
    [0, loopDistance],
    [0, -baseTrack.length * stepY],
  );
  const z = useTransform(
    loopedProgress,
    [0, loopDistance],
    [0, -baseTrack.length * stepZ],
  );

  // Mouse position for magnetic/uplift effect
  const mouseX = useMotionValue(-10000);
  const mouseY = useMotionValue(-10000);

  useEffect(() => {
    if (variant === "simple") {
      mouseX.set(-10000);
      mouseY.set(-10000);
      return;
    }

    const handleWindowMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Pause card magnetism when the user's cursor is inside an isolated form/card zone
      if (target?.closest?.("[data-surfer-ignore='true']")) {
        mouseX.set(-10000);
        mouseY.set(-10000);
        return;
      }
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };

    const handleWindowMouseLeave = () => {
      mouseX.set(-10000);
      mouseY.set(-10000);
    };

    window.addEventListener("mousemove", handleWindowMouseMove, {
      passive: true,
    });
    document.addEventListener("mouseleave", handleWindowMouseLeave);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      document.removeEventListener("mouseleave", handleWindowMouseLeave);
    };
  }, [variant, mouseX, mouseY]);

  return (
    <div
      className={`relative bg-[#070609] min-h-screen text-white w-full ${className}`}
    >
      {/* 3. Infinite Spacer for standalone scroll mode */}
      {showOverlays && (
        <div
          style={{ height: "50000px" }}
          className="w-full pointer-events-none"
        />
      )}

      {/* Fixed viewport */}
      <div className="fixed inset-0 w-full h-screen overflow-hidden flex items-center justify-center perspective-container">
        {/* Ambient Studio Runway Lighting Glows */}
        <div className="pointer-events-none absolute -left-32 top-1/4 h-[520px] w-[520px] rounded-full bg-[#970046]/20 blur-[130px]" />
        <div className="pointer-events-none absolute right-1/4 -bottom-24 h-[460px] w-[460px] rounded-full bg-[#be185d]/15 blur-[120px]" />

        {/* UI Overlays (when used standalone) */}
        {showOverlays && (
          <>
            <div className="absolute top-[3vw] left-[3vw] z-50 pointer-events-none mix-blend-difference">
              <h1 className="font-syne font-bold text-[clamp(2rem,6vw,5rem)] leading-[0.9] tracking-tighter ml-[4vw]">
                {title}
              </h1>
              <h1 className="font-syne font-bold text-[clamp(2rem,6vw,5rem)] leading-[0.9] tracking-tighter">
                {subtitle}
                <span className="text-[0.4em] align-top relative top-[0.6em] ml-2 font-mono tabular-nums">
                  ({safeItems.length})
                </span>
              </h1>
            </div>

            <div className="absolute bottom-[3vw] right-[3vw] z-50 font-mono text-xs tracking-wider uppercase opacity-70 pointer-events-none">
              scroll to surf
            </div>
          </>
        )}

        {/* 3D Scene */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            perspective: "2000px",
            perspectiveOrigin,
          }}
        >
          {/* Animated Track */}
          <motion.div
            className="relative w-0 h-0"
            style={{
              x,
              y,
              z,
              transformStyle: "preserve-3d",
            }}
          >
            {duplicatedItems.map((item, i) => (
              <Card
                key={`${item.id}-${i}`}
                item={item}
                i={i}
                totalOriginal={safeItems.length}
                stepX={stepX}
                stepY={stepY}
                stepZ={stepZ}
                mouseX={mouseX}
                mouseY={mouseY}
                scrollSpring={combinedScroll}
                variant={variant}
              />
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Card({
  item,
  i,
  totalOriginal,
  stepX,
  stepY,
  stepZ,
  mouseX,
  mouseY,
  scrollSpring,
  variant,
}: {
  item: CollectionItem;
  i: number;
  totalOriginal: number;
  stepX: number;
  stepY: number;
  stepZ: number;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  scrollSpring: MotionValue<number>;
  variant: CollectionSurferVariant;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Calculate distance from mouse to center of card (short-circuit when cursor is parked/ignored)
  const distance = useTransform([mouseX, mouseY, scrollSpring], (values) => {
    const [x, y] = values as number[];
    if (!ref.current || variant === "simple" || x < -1000 || y < -1000) {
      return 400;
    }
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
  });

  // --- Magnetic Variant ---
  const targetScale = useTransform(distance, [0, 380], [1.42, 1]);
  const springScale = useSpring(targetScale, {
    mass: 0.5,
    stiffness: 280,
    damping: 22,
  });

  // --- Uplift Variant ---
  const targetUplift = useTransform(distance, [0, 380], [-95, 0]);
  const springUplift = useSpring(targetUplift, {
    mass: 0.5,
    stiffness: 280,
    damping: 22,
  });

  // Offset slot by -2 so foreground cards (-2, -1) are always populated across loop boundaries
  const slot = i - 2;

  // Combine transforms based on variant
  const transform = useTransform([springScale, springUplift], (values) => {
    const [s, u] = values as number[];
    let scaleValue = 1;
    let upliftValue = 0;

    if (variant === "magnetic") {
      scaleValue = Number(s);
    } else if (variant === "uplift") {
      upliftValue = Number(u);
    }

    const baseX = slot * stepX;
    const baseY = slot * stepY;
    const baseZ = slot * stepZ;

    return `translate3d(${baseX}px, ${baseY + upliftValue}px, ${baseZ}px) rotateY(-50deg) scale(${scaleValue})`;
  });

  const displayIndex = String((i % totalOriginal) + 1).padStart(2, "0");
  const fallbackSrc =
    FALLBACK_EDITORIAL_IMAGES[i % FALLBACK_EDITORIAL_IMAGES.length];

  return (
    <motion.div
      ref={ref}
      className="absolute w-[290px] h-[390px] sm:w-[310px] sm:h-[415px] rounded-2xl border border-white/15 bg-neutral-900/90 shadow-[0_28px_60px_rgba(0,0,0,0.78)] transition-colors duration-500 ease-out group"
      style={{
        transform,
        transformStyle: "preserve-3d",
      }}
    >
      {/* Floating Index Header above card */}
      <div className="absolute -top-7 left-0 right-0 flex items-center justify-between px-1 text-white font-mono text-[11px] tracking-widest opacity-55 transition-opacity group-hover:opacity-100">
        <span>{displayIndex}</span>
        <span className="truncate max-w-[180px] text-[10px] uppercase text-white/75">
          {item.title}
        </span>
      </div>

      {/* Image Frame */}
      <div className="relative w-full h-full overflow-hidden rounded-2xl brightness-[0.84] group-hover:brightness-105 transition-all duration-500">
        <img
          src={item.image}
          alt={item.title}
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.fallbackApplied) {
              target.dataset.fallbackApplied = "true";
              target.src = fallbackSrc;
            }
          }}
          className="w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />

        {/* Subtle Inner Couture Gradient & Caption */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 p-4 pointer-events-none">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ff8ab5]">
            {item.title}
          </p>
          {item.subtitle && (
            <p className="mt-0.5 text-xs font-medium text-white/90 truncate">
              {item.subtitle}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default CollectionSurfer;
