/** The six frames of a shoot, in the order the studio delivers them. */
export const SHOOT_FRAMES = [
  "Full Front",
  "Turning",
  "Back",
  "Signature Reference",
  "Face + Details",
  "Product Highlight",
] as const;

export type ShootStep =
  | "upload"
  | "analyse"
  | "plan"
  | "generate"
  | "check"
  | "deliver";

export type FrameStage =
  | "queued"
  | "generating"
  | "checking"
  | "retrying"
  | "delivered";

type ShootEvent = {
  step: ShootStep;
  frame: number;
  stage: FrameStage;
  note: string;
};

/** In the wine kaftan shoot the Turning frame failed its first product check and was generated again. */
export const RETRIED_FRAME = 1;

const EVENTS: ShootEvent[] = [
  {
    step: "upload",
    frame: -1,
    stage: "queued",
    note: "Five product photos are in, with a model face and a style reference.",
  },
  {
    step: "analyse",
    frame: -1,
    stage: "queued",
    note: "Reading the garment: deep wine, sheer tissue-silk, an embroidered black panel.",
  },
  {
    step: "plan",
    frame: -1,
    stage: "queued",
    note: "Six poses planned. Pose 4 takes the seated posture of the style reference.",
  },
  ...SHOOT_FRAMES.flatMap((name, frame): ShootEvent[] => [
    {
      step: "generate",
      frame,
      stage: "generating",
      note:
        frame === 0
          ? "Generating pose 1. It fixes the model, the set and the light for the rest."
          : `Generating pose ${frame + 1}, ${name}, on the same set.`,
    },
    {
      step: "check",
      frame,
      stage: "checking",
      note: `Checking pose ${frame + 1} against the product photos.`,
    },
    ...(frame === RETRIED_FRAME
      ? ([
          {
            step: "generate",
            frame,
            stage: "retrying",
            note: "Pose 2 drifted from the kaftan's real length. That attempt is archived and the pose is generated again.",
          },
          {
            step: "check",
            frame,
            stage: "checking",
            note: "Checking the new pose 2 against the product photos.",
          },
        ] satisfies ShootEvent[])
      : []),
  ]),
  {
    step: "deliver",
    frame: SHOOT_FRAMES.length,
    stage: "delivered",
    note: "All six frames delivered. Every version is kept in History.",
  },
];

const RETRY_EVENT = EVENTS.findIndex((event) => event.stage === "retrying");

/** One loop of the replay: every event, then two extra ticks holding the delivered board. */
export const SHOOT_TICKS = EVENTS.length + 2;

/** The board at a tick: the pipeline step, the status line and each frame's stage. */
export function shootAt(tick: number) {
  const index = Math.min(tick % SHOOT_TICKS, EVENTS.length - 1);
  const event = EVENTS[index];
  const stages = SHOOT_FRAMES.map(
    (_, frame): FrameStage =>
      frame < event.frame
        ? "delivered"
        : frame === event.frame
          ? event.stage
          : "queued",
  );
  return {
    step: event.step,
    note: event.note,
    stages,
    delivered: stages.filter((stage) => stage === "delivered").length,
    retried: index >= RETRY_EVENT,
  };
}
