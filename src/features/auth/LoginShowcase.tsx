import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  animate,
  motion,
  MotionConfig,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import {
  ArrowUpRight,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  User,
} from "lucide-react";
import {
  RETRIED_FRAME,
  SHOOT_FRAMES,
  SHOOT_TICKS,
  shootAt,
  type FrameStage,
  type ShootStep,
} from "./shootTimeline";
import {
  CONTACT_EMAIL,
  FRAMES_PER_SKU,
  PACKS,
  TRIAL_SKUS,
  perSku,
  rupees,
} from "../../lib/pricingPacks";
import { KITKAT_KATTHA, WINE_KAFTAN } from "./showcaseShoots";

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
    text: "Pose 1 comes first and fixes the model, the set and the light. Poses 2 to 6 follow on the same set, 3:4 at 2K unless you choose another ratio.",
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

const CONTACT_LINKS = [
  ["Email", CONTACT_EMAIL, `mailto:${CONTACT_EMAIL}`],
  ["LinkedIn", "Youthnic", "https://www.linkedin.com/company/youthnic"],
  ["Instagram", "@youthnic.in", "https://www.instagram.com/youthnic.in"],
];

// The trial comes first; index 0 is the trial, 1 to 4 are PACKS.
const PACK_OPTIONS = [
  { name: "Trial", skus: TRIAL_SKUS, price: 0, rate: "Free when you enroll" },
  ...PACKS.map((pack) => ({
    name: `${pack.skus} SKUs`,
    skus: pack.skus,
    price: pack.price,
    rate: `About ${rupees(perSku(pack))} per SKU`,
  })),
];

const STAGE_LABEL: Record<Exclude<FrameStage, "delivered">, string> = {
  queued: "Queued",
  generating: "Generating",
  checking: "Checking",
  retrying: "Generating again",
};

const STAGE_TONE: Record<FrameStage, string> = {
  queued: "text-inverse-on-surface/50",
  generating: "text-white",
  checking: "text-inverse-primary",
  retrying: "text-white",
  delivered: "text-tertiary-fixed-dim",
};

function ShootImage({
  src,
  alt,
  ratio,
  className = "",
}: {
  src: string;
  alt: string;
  ratio: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`block w-full rounded-lg object-cover ${className}`}
      style={{ aspectRatio: ratio }}
    />
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
  const reached = STEPS.findIndex((step) => step.key === board.step);

  return (
    <section
      id="workflow"
      className={`${SECTION} bg-on-surface text-inverse-on-surface`}
    >
      <div className="mx-auto grid max-w-[1560px] gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        {/* On phones the board follows the intro and the step list comes last */}
        <div className="contents lg:block">
          <div className="order-1">
            <h2 className={`${HEADING} text-white`}>
              A real shoot, start to finish.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-inverse-on-surface/75 sm:text-lg">
              This is the wine kaftan shoot from {WINE_KAFTAN.shotOn}, replayed
              with its own photos, its own analysis and the six frames it
              delivered. Its Turning frame failed the first product check and
              was generated again, exactly as shown.
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
              {WINE_KAFTAN.name}, replayed
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

          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-inverse-primary transition-[width] duration-700"
              style={{
                width: `${(board.delivered / SHOOT_FRAMES.length) * 100}%`,
              }}
            />
          </div>

          <p className="mt-4 min-h-[4rem] text-sm leading-snug text-white sm:min-h-[2.75rem]">
            {board.note}
          </p>

          <p className="text-xs font-semibold text-inverse-on-surface/60">
            What was uploaded
          </p>
          <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WINE_KAFTAN.inputs.map((input) => (
              <li key={input.role}>
                {input.image ? (
                  <ShootImage
                    src={input.image}
                    alt={`Uploaded product photo: ${input.role.toLowerCase()}`}
                    ratio={WINE_KAFTAN.ratio}
                    className="object-top"
                  />
                ) : (
                  // A third-party photo: listed as an input, not republished here
                  <div
                    className="grid place-items-center rounded-lg border border-dashed border-white/25 text-white/45"
                    style={{ aspectRatio: WINE_KAFTAN.ratio }}
                  >
                    {input.role === "Model face" ? (
                      <User className="h-5 w-5" />
                    ) : (
                      <ImageIcon className="h-5 w-5" />
                    )}
                  </div>
                )}
                <p className="mt-1 text-[11px] leading-tight text-inverse-on-surface/75">
                  {input.role}
                </p>
              </li>
            ))}
          </ul>

          <p className="mt-5 text-xs font-semibold text-inverse-on-surface/60">
            What the analysis read
          </p>
          <dl
            className={`mt-2 grid gap-x-4 gap-y-1.5 text-xs leading-snug transition-opacity duration-700 sm:grid-cols-[6.5rem_1fr] ${
              reached >= 1 ? "opacity-100" : "opacity-20"
            }`}
          >
            {WINE_KAFTAN.facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-inverse-on-surface/60">{label}</dt>
                <dd className="text-white">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 text-xs font-semibold text-inverse-on-surface/60">
            What was delivered
          </p>
          <ol className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {SHOOT_FRAMES.map((name, i) => {
              const stage = board.stages[i];
              const delivered = stage === "delivered";
              const working = stage === "generating" || stage === "retrying";
              const frame = WINE_KAFTAN.frames[i];
              return (
                <li key={name}>
                  <div
                    className="relative overflow-hidden rounded-lg bg-white/[0.06]"
                    style={{ aspectRatio: WINE_KAFTAN.ratio }}
                  >
                    <img
                      src={frame.image}
                      alt={`Delivered frame ${i + 1}: ${name}`}
                      loading="lazy"
                      decoding="async"
                      className={`h-full w-full object-cover transition-opacity duration-700 ${
                        delivered ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    {!delivered && (
                      <span className="absolute inset-0 grid place-items-center font-syne text-2xl font-bold text-white/25">
                        {i + 1}
                      </span>
                    )}
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
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold leading-tight text-white">
                    {i + 1}. {name}
                  </p>
                  <p
                    className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium leading-tight ${STAGE_TONE[stage]}`}
                  >
                    {stage !== "queued" && !delivered && (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    )}
                    {stage === "delivered"
                      ? `Passed, ${frame.check}%${i === RETRIED_FRAME ? ", 2nd try" : ""}`
                      : STAGE_LABEL[stage]}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** A rupee figure that counts to its new value when the pack changes. */
function Rupees({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const amount = useMotionValue(value);
  const text = useTransform(amount, rupees);

  useEffect(() => {
    const controls = animate(amount, value, {
      duration: reduceMotion ? 0 : 0.45,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [amount, value, reduceMotion]);

  return <motion.span>{text}</motion.span>;
}

function Pricing({ onStartFree }: { onStartFree: () => void }) {
  const [selected, setSelected] = useState(0);
  const pack = PACK_OPTIONS[selected];
  const trial = selected === 0;

  return (
    <section id="pricing" className={`${SECTION} bg-soft-blush`}>
      <div className="mx-auto max-w-[1560px]">
        <h2 className={`${HEADING} max-w-4xl text-on-surface`}>
          Start free. Then buy shoots by the pack.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          One SKU is one product, shot as a full six-frame set. Your first
          one is free once your email is verified; after that you buy SKUs
          in packs.
        </p>

        <MotionConfig reducedMotion="user">
          <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-16">
            <fieldset>
              <legend className="sr-only">Choose a pack</legend>
              {PACK_OPTIONS.map((option, i) => (
                <label
                  key={option.name}
                  className="relative flex cursor-pointer items-center justify-between gap-4 border-b border-primary/15 px-4 py-4 first-of-type:border-t sm:px-5"
                >
                  <input
                    type="radio"
                    name="pack"
                    checked={selected === i}
                    onChange={() => setSelected(i)}
                    className="peer sr-only"
                  />
                  {selected === i && (
                    <motion.span
                      layoutId="pack-highlight"
                      className="absolute inset-0 rounded-xl bg-card"
                      transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    />
                  )}
                  <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary" />
                  <span className="relative">
                    <span className="block font-syne text-xl font-bold text-on-surface">
                      {option.name}
                    </span>
                    <span className="block text-sm text-secondary">
                      {option.rate}
                    </span>
                  </span>
                  <span className="relative font-syne text-xl font-bold tabular-nums text-on-surface">
                    {option.price ? rupees(option.price) : "Free"}
                  </span>
                </label>
              ))}
            </fieldset>

            <div aria-live="polite" className="lg:self-center">
              <p className="text-sm font-semibold text-primary">
                {trial ? "Trial" : `${pack.skus} SKU pack`}
              </p>
              <p className="mt-2 font-syne text-6xl font-bold tabular-nums tracking-tighter text-on-surface sm:text-7xl">
                {trial ? (
                  "Free"
                ) : (
                  <>
                    <span aria-hidden="true">
                      <Rupees value={pack.price} />
                    </span>
                    <span className="sr-only">{rupees(pack.price)}</span>
                  </>
                )}
              </p>
              <p className="mt-4 text-lg font-semibold text-on-surface">
                {pack.skus} {pack.skus === 1 ? "SKU" : "SKUs"},{" "}
                {pack.skus * FRAMES_PER_SKU} catalog frames
              </p>
              <p className="mt-1 text-base text-secondary">{pack.rate}</p>
              <button
                type="button"
                onClick={onStartFree}
                className="mt-8 cursor-pointer rounded-full bg-primary px-6 py-3 text-sm font-bold text-on-primary transition-colors hover:bg-primary-container"
              >
                Start free studio
              </button>
              {!trial && (
                <p className="mt-3 text-sm text-secondary">
                  Packs are requested from Credits once you are signed in.
                </p>
              )}
            </div>
          </div>
        </MotionConfig>
      </div>
    </section>
  );
}

/** Everything below the login hero: a real shoot replayed, its six frames, a second shoot, the product rules, pricing and contact. */
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
            These are the six frames of the wine kaftan shoot, as delivered.
            Every new shoot delivers the same six in the same order, so a whole
            catalog reads as one brand: the model, the set and the light stay
            put, and only the pose, the camera angle and the framing change.
          </p>
          <ol className="mt-12 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 xl:grid-cols-6">
            {SHOOT_FRAMES.map((name, i) => (
              <li key={name}>
                <ShootImage
                  src={WINE_KAFTAN.frames[i].image}
                  alt={`${WINE_KAFTAN.name}, frame ${i + 1}: ${name}`}
                  ratio={WINE_KAFTAN.ratio}
                />
                <h3 className="mt-4 font-syne text-lg font-bold leading-snug text-on-surface">
                  {i + 1}. {name}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-secondary">
                  {FRAME_NOTES[i]}
                </p>
                <p className="mt-2 text-xs font-semibold text-success">
                  Product check passed, {WINE_KAFTAN.frames[i].check}%
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="more"
        className={`${SECTION} border-t border-outline-variant/50 bg-surface-container-low`}
      >
        <div className="mx-auto max-w-[1560px]">
          <h2 className={`${HEADING} max-w-4xl text-on-surface`}>
            A different product, the same six frames.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
            A block-printed cotton top, uploaded as product photos. The studio
            read the print, the square neckline and the lace-up back, then
            delivered this shoot on {KITKAT_KATTHA.shotOn}.
          </p>
          <div className="mt-12 grid gap-10 lg:grid-cols-[0.3fr_1fr] lg:gap-14">
            <div>
              <p className="text-sm font-semibold text-on-surface">Uploaded</p>
              <ShootImage
                src={KITKAT_KATTHA.inputs[0].image!}
                alt={`${KITKAT_KATTHA.name}, uploaded front photo`}
                ratio="400 / 447"
                className="mt-3 max-w-xs"
              />
              <dl className="mt-6 max-w-xs space-y-3 text-sm leading-snug">
                {KITKAT_KATTHA.facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-semibold text-on-surface">{label}</dt>
                    <dd className="text-secondary">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <p className="text-sm font-semibold text-on-surface">Delivered</p>
              <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
                {SHOOT_FRAMES.map((name, i) => (
                  <li key={name}>
                    <ShootImage
                      src={KITKAT_KATTHA.frames[i].image}
                      alt={`${KITKAT_KATTHA.name}, frame ${i + 1}: ${name}`}
                      ratio={KITKAT_KATTHA.ratio}
                    />
                    <p className="mt-2 text-sm font-semibold text-on-surface">
                      {i + 1}. {name}
                    </p>
                    <p className="text-xs font-semibold text-success">
                      Product check passed, {KITKAT_KATTHA.frames[i].check}%
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
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

      <Pricing onStartFree={() => onStart("signup")} />

      <section
        id="contact"
        className={`${SECTION} bg-on-surface text-inverse-on-surface`}
      >
        <div className="mx-auto grid max-w-[1560px] gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div>
            <h2 className={`${HEADING} text-white`}>Get in touch.</h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-inverse-on-surface/75 sm:text-lg">
              Questions about packs, a large catalog or your first shoot?
              Write to us.
            </p>
            <h3 className="mt-10 font-syne text-xl font-bold text-white">
              About Youthnic
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-inverse-on-surface/75">
              Youthnic is a fusion fashion label from Surat, Gujarat. Since
              2021 it has sold tops, tunics, kurtas, co-ords and dresses under
              the line Modernly Ethnic. AI Studio is its catalog photography
              tool, and the shoots on this page are real work made with it.
            </p>
          </div>
          <ul className="self-start divide-y divide-white/10 border-y border-white/10">
            {CONTACT_LINKS.map(([label, text, href]) => (
              <li key={label}>
                <a
                  href={href}
                  {...(href.startsWith("mailto:")
                    ? {}
                    : { target: "_blank", rel: "noopener noreferrer" })}
                  className="group flex items-center justify-between gap-4 py-5"
                >
                  <span>
                    <span className="block text-xs font-semibold text-inverse-on-surface/60">
                      {label}
                    </span>
                    <span className="block break-all font-syne text-xl font-bold text-white underline-offset-4 group-hover:underline sm:text-2xl">
                      {text}
                    </span>
                  </span>
                  <ArrowUpRight className="h-5 w-5 shrink-0 text-inverse-on-surface/60 transition-colors group-hover:text-white" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-on-surface px-5 py-10 text-sm text-inverse-on-surface/75 sm:px-8 lg:px-10 xl:px-14">
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
