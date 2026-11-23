import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Check, Loader2, Pause, Play } from "lucide-react";
import {
  RETRIED_FRAME,
  SHOOT_FRAMES,
  SHOOT_TICKS,
  shootAt,
  type FrameStage,
  type ShootStep,
} from "./shootTimeline";

const SECTION = "scroll-mt-16 px-5 py-20 sm:px-8 lg:px-10 lg:py-28 xl:px-14";
const HEADING =
  "font-syne text-4xl font-bold leading-[1.02] tracking-tighter sm:text-5xl lg:text-6xl";

const STEPS: Array<{ key: ShootStep; name: string; text: string }> = [
  {
    key: "upload",
    name: "Upload",
    text: "Front and back photos are required; a saree also needs its spread pallu and a body fabric detail. A fabric close-up, bottom wear, a mannequin shot, a model face and a style reference are optional.",
  },
  {
    key: "analyse",
    name: "Analyse",
    text: "One vision pass reads the garment: category, colour, fabric, print, neckline, embroidery. Every frame answers to that record.",
  },
  {
    key: "plan",
    name: "Plan",
    text: "Six poses are planned for this product. If your style reference shows a person, Pose 4 takes their posture and camera angle, unless a product rule blocks it: a saree is never shot reclining.",
  },
  {
    key: "generate",
    name: "Generate",
    text: "Pose 1 comes first and fixes the model, the set and the light. Poses 2 to 6 follow on the same set, 3:4 at 2K.",
  },
  {
    key: "check",
    name: "Check",
    text: "Each image is compared with your product photos for shape, colour, material, logo and details. A mismatch is archived and the pose is generated again.",
  },
  {
    key: "deliver",
    name: "Deliver",
    text: "Frames land in History with every version kept. Download one image or the whole shoot as a ZIP.",
  },
];

const FRAME_NOTES = [
  "Head to toe from the front. This frame fixes the model, the set and the light for the other five.",
  "A three-quarter turn that shows the drape and the side construction.",
  "The back as your back photo shows it: neck shape, ties, closures, seams, print placement and length.",
  "If your style reference shows a person, this frame takes their posture, camera angle and framing, in your garment, unless a product rule blocks that posture.",
  "A natural face with a sharp view of the garment's signature work, such as yoke embroidery or neckline craft.",
  "A tight close-up of the most distinctive feature, cropped where it sits: a cuff, a border, a back closure, a print.",
];

const RULES = [
  [
    "Clothing comes only from your product photos.",
    "The outfit in a style reference is discarded. That image supplies the backdrop, the floor, the lighting and, when Pose 4 adopts it, the posture.",
  ],
  [
    "The back view follows your back photo.",
    "Neck shape, ties and closures, seams, print placement and length match what you uploaded. No back detail is invented.",
  ],
  [
    "One set per shoot.",
    "All six frames share the same wall, floor and light. Only the pose, the camera angle and the framing change.",
  ],
  [
    "Two arms, two hands.",
    "Every frame is generated under a strict natural-anatomy rule: no extra hands and no floating limbs.",
  ],
  [
    "Every frame is checked against the product.",
    "A frame that still fails the product check after its retries is held for your review, not hidden.",
  ],
  [
    "Paid output is never deleted.",
    "Each delivered image is kept as its own version. Regenerating a pose adds a version beside the earlier ones.",
  ],
];

const PRICES = [
  ["5", "free six-pose shoots when you enroll your store"],
  ["$1.00", "per shoot after that, with high-reasoning analysis"],
  ["+$0.50", "per shoot when you switch on automated QA"],
];

const STAGE_LABEL: Record<FrameStage, string> = {
  queued: "Queued",
  generating: "Generating",
  checking: "Checking",
  retrying: "Generating again",
  delivered: "Delivered",
};

const STAGE_TONE: Record<FrameStage, string> = {
  queued: "text-inverse-on-surface/50",
  generating: "text-white",
  checking: "text-inverse-primary",
  retrying: "text-white",
  delivered: "text-tertiary-fixed-dim",
};

// One drawing of the garment, cropped six ways: the same product and set in every frame.
const FRAME_VIEWS: Array<{
  viewBox: string;
  turn?: boolean;
  back?: boolean;
  posed?: boolean;
}> = [
  { viewBox: "0 0 120 160" },
  { viewBox: "0 0 120 160", turn: true },
  { viewBox: "0 0 120 160", back: true },
  { viewBox: "0 0 120 160", posed: true },
  { viewBox: "36 8 48 64" },
  { viewBox: "20 62 36 48" },
];

const LIT = {
  garment: "fill-primary-container",
  trim: "fill-primary-fixed",
  trimLine: "stroke-primary-fixed",
  body: "fill-outline",
  hair: "fill-on-surface",
  set: "stroke-outline-variant",
};

const GHOST = {
  garment: "fill-white",
  trim: "fill-white",
  trimLine: "stroke-white",
  body: "fill-white",
  hair: "fill-white",
  set: "stroke-white",
};

const YOKE = [
  [52.5, 40],
  [54.5, 44],
  [57, 48],
  [60, 50.5],
  [63, 48],
  [65.5, 44],
  [67.5, 40],
];

const PRINT = [
  [56, 84],
  [66, 92],
  [50, 100],
  [61, 106],
  [72, 112],
  [45, 118],
  [57, 122],
  [68, 126],
  [78, 124],
  [40, 128],
];

function FrameArt({ index, lit }: { index: number; lit: boolean }) {
  const view = FRAME_VIEWS[index];
  const tone = lit ? LIT : GHOST;
  return (
    <div
      className={`aspect-[3/4] overflow-hidden rounded-lg border transition-colors duration-500 ${
        lit
          ? "border-outline-variant/50 bg-card"
          : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <svg
        viewBox={view.viewBox}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden="true"
      >
        <g opacity={lit ? 1 : 0.16}>
          {/* The set: the same arch and floor in every frame */}
          <path
            d="M22 146V58a38 38 0 0 1 76 0v88M0 146h120"
            fill="none"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className={tone.set}
          />
          <g
            transform={
              view.turn
                ? "translate(60 0) scale(0.72 1) translate(-60 0)"
                : undefined
            }
          >
            {view.back ? (
              <g className={tone.hair}>
                <circle cx="60" cy="23" r="9" />
                <circle cx="60" cy="11.5" r="4.5" />
              </g>
            ) : (
              <>
                <path
                  d="M49 24a11 11 0 0 1 22 0v13H49z"
                  className={tone.hair}
                />
                <circle cx="60" cy="24" r="8" className={tone.body} />
              </>
            )}
            <g className={tone.body}>
              <rect x="57" y="30" width="6" height="8" />
              <path d="M55 37l5 9 5-9z" />
              <ellipse cx="53" cy="146" rx="5" ry="2.2" />
              <ellipse cx="67" cy="146" rx="5" ry="2.2" />
            </g>
            <g className={tone.garment}>
              <path
                d={
                  view.back
                    ? "M45 38l9-1q6 7 12 0l9 1-4 32 17 70H32l17-70z"
                    : "M45 38l10-1 5 9 5-9 10 1-4 32 17 70H32l17-70z"
                }
              />
              <path d="M75 38l7 24 6 24-6 2-6-22-4-16z" />
              <path
                d={
                  view.posed
                    ? "M45 38L35 57l10 14 4-4-7-10 7-11z"
                    : "M45 38l-7 24-6 24 6 2 6-22 4-16z"
                }
              />
            </g>
            <g className={tone.body}>
              <circle cx="86" cy="91" r="3" />
              <circle
                cx={view.posed ? 48.5 : 34}
                cy={view.posed ? 70.5 : 91}
                r="3"
              />
            </g>
            <g className={tone.trim}>
              <path d="M33.7 133h52.6l1.7 7H32z" />
              <path d="M87 82.1l1 3.9-6 2-1-3.9z" />
              <path
                d={
                  view.posed
                    ? "M42.7 67.7L45 71l4-4-2.3-3.3z"
                    : "M33 82.1l-1 3.9 6 2 1-3.9z"
                }
              />
              {PRINT.map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" />
              ))}
              {view.back ? (
                <>
                  <ellipse cx="57.2" cy="48" rx="2.6" ry="1.6" />
                  <ellipse cx="62.8" cy="48" rx="2.6" ry="1.6" />
                </>
              ) : (
                <>
                  {YOKE.map(([cx, cy]) => (
                    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" />
                  ))}
                  <path d="M60 53l2 3-2 3-2-3z" />
                </>
              )}
            </g>
            {view.back && (
              <path
                d="M56 41l4 7 4-7M60 48l-2.5 8M60 48l2.5 8"
                fill="none"
                strokeWidth="0.8"
                strokeLinecap="round"
                className={tone.trimLine}
              />
            )}
          </g>
        </g>
      </svg>
    </div>
  );
}

function Workflow() {
  const boardRef = useRef<HTMLDivElement>(null);
  const inView = useInView(boardRef, { amount: 0.3 });
  const reduceMotion = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = inView && !paused && !reduceMotion;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1300);
    return () => window.clearInterval(timer);
  }, [playing]);

  // Reduced motion shows the delivered shoot instead of the replay.
  const board = shootAt(reduceMotion ? SHOOT_TICKS - 1 : tick);
  const activeStep = reduceMotion ? null : board.step;

  return (
    <section
      id="workflow"
      className={`${SECTION} bg-on-surface text-inverse-on-surface`}
    >
      <div className="mx-auto grid max-w-[1560px] gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        {/* On phones the board follows the intro and the step list comes last */}
        <div className="contents lg:block">
          <div className="order-1">
            <h2 className={`${HEADING} text-white`}>
              A shoot, start to finish.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-inverse-on-surface/75 sm:text-lg">
              Every shoot in Studio runs through these six steps. The board
              replays a sample shoot, including a back view that fails its
              product check and is generated again.
            </p>
          </div>

          <ol className="order-3 space-y-1 lg:mt-10">
            {STEPS.map((step, i) => {
              const active = activeStep === step.key;
              const bright = active || activeStep === null;
              return (
                <li
                  key={step.key}
                  className={`border-l-2 py-3 pl-5 transition-colors duration-500 ${
                    active ? "border-inverse-primary" : "border-white/10"
                  }`}
                >
                  <h3
                    className={`font-syne text-xl font-bold transition-colors duration-500 ${
                      bright ? "text-white" : "text-white/55"
                    }`}
                  >
                    {i + 1}. {step.name}
                  </h3>
                  <p
                    className={`mt-1 max-w-md text-sm leading-relaxed transition-colors duration-500 ${
                      bright
                        ? "text-inverse-on-surface/85"
                        : "text-inverse-on-surface/60"
                    }`}
                  >
                    {step.text}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>

        <div
          ref={boardRef}
          className="order-2 self-start rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 lg:sticky lg:top-24"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">
              Sample shoot, replayed
            </p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-inverse-on-surface/75">
                {board.delivered} of {SHOOT_FRAMES.length} delivered
              </span>
              {!reduceMotion && (
                <button
                  type="button"
                  onClick={() => setPaused((value) => !value)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {paused ? (
                    <Play className="h-3 w-3" />
                  ) : (
                    <Pause className="h-3 w-3" />
                  )}
                  {paused ? "Play replay" : "Pause replay"}
                </button>
              )}
            </div>
          </div>

          {/* The step list beside it is the accessible version of this board */}
          <div aria-hidden="true">
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-inverse-primary transition-[width] duration-700"
                style={{
                  width: `${(board.delivered / SHOOT_FRAMES.length) * 100}%`,
                }}
              />
            </div>

            <p className="mt-4 text-xs text-inverse-on-surface/60">
              References: front, back, fabric close-up, style reference
            </p>

            <p className="mt-4 min-h-[4rem] text-sm leading-snug text-white sm:min-h-[2.75rem]">
              {board.note}
            </p>

            <div className="mt-2 grid grid-cols-3 gap-3 sm:gap-4">
              {SHOOT_FRAMES.map((name, i) => {
                const stage = board.stages[i];
                const lit = stage === "delivered" || stage === "checking";
                const working =
                  stage === "generating" || stage === "retrying";
                return (
                  <div key={name}>
                    <div
                      className={`relative overflow-hidden rounded-lg transition-opacity duration-500 ${
                        stage === "checking" ? "opacity-70" : ""
                      }`}
                    >
                      <FrameArt index={i} lit={lit} />
                      {working && (
                        <motion.span
                          className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-white/20 to-transparent"
                          animate={{ y: ["-100%", "300%"] }}
                          transition={{
                            duration: 1.3,
                            repeat: Infinity,
                            ease: "linear",
                          }}
                        />
                      )}
                      {stage === "delivered" && (
                        <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-success text-white">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      )}
                      {i === RETRIED_FRAME && board.retried && (
                        <span
                          className={`absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white ${
                            lit ? "bg-on-surface/85" : "bg-white/15"
                          }`}
                        >
                          {stage === "retrying" ? "v1 archived" : "v2"}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-semibold leading-tight text-white">
                      {i + 1}. {name}
                    </p>
                    <p
                      className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${STAGE_TONE[stage]}`}
                    >
                      {(working || stage === "checking") && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {STAGE_LABEL[stage]}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Everything below the login hero: how a shoot runs, the six frames, the product rules and pricing. */
export function LoginShowcase({
  onStart,
}: {
  onStart: (mode: "signin" | "signup") => void;
}) {
  return (
    <>
      <Workflow />

      <section id="frames" className={`${SECTION} bg-background`}>
        <div className="mx-auto max-w-[1560px]">
          <h2 className={`${HEADING} max-w-3xl text-on-surface`}>
            Six frames, one set.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
            Every new shoot delivers the same six frames in the same order, so a
            whole catalog reads as one brand. The arch and floor in these
            diagrams stay put because the set does too: only the pose, the
            camera angle and the framing change.
          </p>
          <ol className="mt-12 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-6">
            {SHOOT_FRAMES.map((name, i) => (
              <li key={name}>
                <FrameArt index={i} lit />
                <h3 className="mt-4 font-syne text-lg font-bold leading-snug text-on-surface">
                  {i + 1}. {name}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-secondary">
                  {FRAME_NOTES[i]}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="rules"
        className={`${SECTION} border-t border-outline-variant/50 bg-card`}
      >
        <div className="mx-auto grid max-w-[1560px] gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
          <div>
            <h2 className={`${HEADING} text-on-surface`}>
              The garment is not up for interpretation.
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-secondary sm:text-lg">
              A catalog image has to show the product a customer will receive.
              These rules apply to every frame of every shoot.
            </p>
          </div>
          <ul className="divide-y divide-outline-variant/50 border-y border-outline-variant/50">
            {RULES.map(([rule, detail]) => (
              <li
                key={rule}
                className="grid gap-2 py-6 sm:grid-cols-[0.85fr_1.15fr] sm:gap-8"
              >
                <h3 className="font-syne text-lg font-bold leading-snug text-on-surface">
                  {rule}
                </h3>
                <p className="text-sm leading-relaxed text-secondary">
                  {detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" className={`${SECTION} bg-soft-blush`}>
        <div className="mx-auto max-w-[1560px]">
          <h2 className={`${HEADING} max-w-3xl text-on-surface`}>
            Your first five shoots are free.
          </h2>
          <ul className="mt-12 grid gap-8 sm:grid-cols-3">
            {PRICES.map(([figure, label]) => (
              <li key={figure} className="border-t border-primary/25 pt-5">
                <p className="font-syne text-5xl font-bold tracking-tighter text-primary lg:text-6xl">
                  {figure}
                </p>
                <p className="mt-2 max-w-xs text-sm font-medium leading-relaxed text-on-surface-variant">
                  {label}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-12 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onStart("signup")}
              className="cursor-pointer rounded-full bg-primary px-6 py-3 text-sm font-bold text-on-primary transition-colors hover:bg-primary-container"
            >
              Start free studio
            </button>
            <button
              type="button"
              onClick={() => onStart("signin")}
              className="cursor-pointer rounded-full border border-on-surface/25 px-6 py-3 text-sm font-bold text-on-surface transition-colors hover:border-on-surface"
            >
              Sign in
            </button>
          </div>
        </div>
      </section>

      <footer className="bg-on-surface px-5 py-10 text-sm text-inverse-on-surface/75 sm:px-8 lg:px-10 xl:px-14">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-4">
          <p>
            <span className="font-syne text-base font-bold text-white">
              Youthnic AI Studio
            </span>{" "}
            Six-pose catalog photoshoots from your product photos.
          </p>
          <Link
            to="/docs"
            className="font-semibold text-white underline-offset-4 hover:underline"
          >
            Read the documentation
          </Link>
        </div>
      </footer>
    </>
  );
}
