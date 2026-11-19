export type FlowShot = {
  id: string;
  role: string;
  fileName?: string;
};

export type SentShot = {
  role: string;
  fileName?: string;
};

export function canonicalRole(role: string) {
  const value = role.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (value.includes("model")) return "model_identity";
  if (value.includes("style")) return "style_reference";
  if (value.includes("fabric") || value.includes("pattern")) return "fabric_pattern";
  if (value.includes("bottom") || value.includes("farshi")) return "bottom";
  if (value.includes("mannequin")) return "mannequin";
  if (value.includes("additional")) return "additional_product";
  if (value.includes("pallu")) return "saree_pallu_spread";
  if (value.includes("blouse") && value.includes("back")) return "saree_blouse_back_piece";
  if (value.includes("blouse")) return "saree_blouse_front";
  if (value.includes("border") || value.includes("tassel")) return "saree_border_tassels";
  if (value.includes("drape") && value.includes("back")) return "saree_back_drape";
  if (value.includes("drape")) return "saree_front_drape";
  if (value.includes("back") || value.includes("rear")) return "back";
  if (value.includes("front")) return "front";
  return value;
}

export function referenceLane(role: string) {
  const canonical = canonicalRole(role);
  if (canonical === "model_identity") return "face";
  if (canonical === "style_reference") return "room";
  return "product";
}

export function namesMatch(left: string, right: string) {
  const a = left.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const b = right.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!a || !b) return false;
  if (a.length === b.length) return a === b;
  // A pure suffix can collide on numbered files (1.jpg vs 11.jpg), so the
  // character before the shorter name must not be a digit.
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.endsWith(short) && !/[0-9]/.test(long[long.length - short.length - 1]);
}

function poseIsBack(title: string, poseIndex: number) {
  return poseIndex === 3 || /rear|\bback\b/.test(title.toLowerCase());
}

export function promptExcerpt(prompt: string, poseIndex: number) {
  const text = prompt.replace(/[ \t]+/g, " ").trim();
  if (!text) return "";
  const match = text.match(new RegExp(`Pose\\s+${poseIndex}\\s*:[^\\n.]{0,220}`, "i"));
  const line = (match?.[0] || text.split("\n").find((row) => row.trim()) || text).trim();
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}

export function poseIsWorking(status?: string) {
  const value = (status || "").toLowerCase();
  if (!value || value.startsWith("generated")) return false;
  return /\b(queued|queueing|running|processing|generating)\b/.test(value);
}

/** Nodes that belong with the selection. A pose lights its own photos and output. A photo lights the poses it feeds, without pulling in the other photos those poses share. */
export function neighborIds(activeId: string, edges: Array<{ source: string; target: string }>) {
  const linked = new Set<string>();
  if (!activeId) return linked;
  const add = (id: string) => {
    if (id && id !== activeId) linked.add(id);
  };
  const poseOf = (id: string) => {
    const match = id.match(/^(?:prompt|image)-(.+)$/);
    return match ? match[1] : "";
  };
  const pose = poseOf(activeId);
  if (pose) {
    const prompt = `prompt-${pose}`;
    add(prompt);
    add(`image-${pose}`);
    for (const edge of edges) {
      if (edge.target === prompt) add(edge.source);
      if (edge.source === prompt) add(edge.target);
    }
    return linked;
  }
  for (const edge of edges) {
    if (edge.source !== activeId && edge.target !== activeId) continue;
    const other = edge.source === activeId ? edge.target : edge.source;
    add(other);
    const fed = poseOf(other);
    if (fed) {
      add(`prompt-${fed}`);
      add(`image-${fed}`);
    }
  }
  return linked;
}

/** Which uploaded photos feed one pose. A saved send-list wins. Otherwise every product photo feeds the pose, except a rear frame, which keeps the back and the bottom. Face and room always feed the pose. */
export function photosForPose<T extends FlowShot>(
  photos: T[],
  pose: { poseIndex: number; title: string; sent?: SentShot[] },
): T[] {
  const sent = pose.sent || [];
  return photos.filter((photo) => {
    const lane = referenceLane(photo.role);
    if (lane === "face" || lane === "room") return true;
    if (!sent.length) {
      if (!poseIsBack(pose.title, pose.poseIndex)) return true;
      const role = canonicalRole(photo.role);
      return role === "back" || role === "bottom" || role === "saree_back_drape";
    }
    const role = canonicalRole(photo.role);
    const entries = sent.filter((item) => canonicalRole(item.role) === role);
    if (!entries.length) return false;
    const siblings = photos.filter((item) => referenceLane(item.role) === "product" && canonicalRole(item.role) === role);
    if (siblings.length < 2) return true;
    const named = entries.map((item) => item.fileName || "").filter(Boolean);
    if (!named.length) return true;
    const matched = siblings.filter((item) => named.some((name) => namesMatch(item.fileName || "", name)));
    if (!matched.length) return true;
    return matched.some((item) => item.id === photo.id);
  });
}
