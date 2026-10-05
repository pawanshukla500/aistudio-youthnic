import { useState } from "react";
import { Check, ImagePlus, Sparkles, Trash2, UploadCloud, User } from "lucide-react";
import type { ProductReferenceRole, StudioReference } from "../types";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp";

const genericProductSlots: Array<{
  id: ProductReferenceRole;
  label: string;
  description: string;
  required: boolean;
}> = [
  { id: "front", label: "Upload Front", description: "Front construction & neckline", required: true },
  { id: "back", label: "Upload Back", description: "Back design & rear detail", required: true },
  { id: "fabric_pattern", label: "Fabric / Pattern Detail", description: "Fabric weave, embroidery close-up", required: false },
  { id: "bottom", label: "Bottom Wear / Farshi", description: "Trousers/skirt cut, drape & hem", required: false },
  { id: "mannequin", label: "Mannequin / Flat-lay", description: "Dress form shape & fit guide", required: false },
  { id: "additional_product", label: "Additional Photo", description: "Alternate angle or detail", required: false },
];

const sareeProductSlots: typeof genericProductSlots = [
  { id: "saree_front_drape", label: "Full Saree Front", description: "Complete front drape, pleats & borders", required: true },
  { id: "saree_back_drape", label: "Rear / Back Drape", description: "Full rear drape & pallu fall", required: true },
  { id: "saree_pallu_spread", label: "Pallu Spread", description: "Fully open pallu artwork & edges", required: true },
  { id: "saree_body_detail", label: "Body Fabric / Pattern", description: "Close-up of weave, motifs & zari", required: true },
  { id: "saree_border_tassels", label: "Border / Tassels", description: "Border widths & tassel finish", required: false },
  { id: "saree_blouse_front", label: "Blouse Front", description: "Front construction, neck & sleeves", required: false },
  { id: "saree_blouse_back_piece", label: "Blouse Back / Piece", description: "Back cut or unstitched piece", required: false },
];

function ReferenceCard({
  reference,
  label,
  description,
  required = false,
  onFile,
  onRemove,
}: {
  reference?: StudioReference;
  label: string;
  description: string;
  required?: boolean;
  onFile: (file: File) => void;
  onRemove?: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="group/card relative">
      <label
        className={`group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-white p-3.5 text-center shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-soft-blush/30 hover:shadow-md ${
          dragging ? "border-primary bg-primary/8 ring-4 ring-primary/10 scale-[1.01]" : "border-outline-variant/60"
        } ${reference ? "border-solid border-outline-variant/40 bg-white" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
      >
        <input
          className="sr-only"
          type="file"
          accept={ACCEPTED_IMAGES}
          aria-label={reference ? `Replace ${label}` : label}
          onClick={(event) => {
            event.currentTarget.value = "";
          }}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) onFile(file);
            event.currentTarget.value = "";
          }}
        />

        {reference ? (
          <>
            <img
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover/card:scale-105"
              src={reference.previewUrl}
              alt={`${label} preview`}
            />
            {/* Top status indicator when image is uploaded */}
            <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
              <Check className="h-3 w-3 text-emerald-400" />
              <span>{label}</span>
            </div>

            {/* Hover overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-navy-soft/60 opacity-0 backdrop-blur-xs transition-opacity duration-200 group-hover/card:opacity-100 group-focus-within/card:opacity-100">
              <span className="flex items-center gap-1.5 rounded-xl bg-white/95 px-3 py-1.5 text-xs font-bold text-on-surface shadow-md">
                <ImagePlus className="h-4 w-4 text-primary" />
                <span>Replace photo</span>
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center">
            <div className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-soft-blush text-primary transition-transform duration-200 group-hover:scale-110">
              <UploadCloud className="h-5 w-5" />
            </div>
            <span className="text-xs font-bold leading-tight text-on-surface">{label}</span>
            <span className="mt-1 line-clamp-1 text-[10px] font-medium leading-tight text-secondary">
              {description}
            </span>
            <span
              className={`mt-2 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide border ${
                required
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-outline-variant/40 bg-surface-container text-secondary"
              }`}
            >
              {required ? "Required" : "Optional"}
            </span>
          </div>
        )}
      </label>

      {reference && onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          title={`Remove ${label}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="absolute -right-2 -top-2 z-20 grid h-7 w-7 place-items-center rounded-full border border-outline-variant/60 bg-white text-secondary shadow-md transition-all hover:border-danger hover:bg-danger-surface hover:text-danger hover:scale-110"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function ProductReferences({
  references,
  onChange,
  saree = false,
  onPromoteLegacyReference,
}: {
  references: Partial<Record<ProductReferenceRole, StudioReference>>;
  onChange: (role: ProductReferenceRole, file: File | null) => void;
  saree?: boolean;
  onPromoteLegacyReference?: (sourceRole: ProductReferenceRole, targetRole: "saree_pallu_spread" | "saree_body_detail") => void;
}) {
  const productSlots = saree ? sareeProductSlots : genericProductSlots;
  const legacyCandidates = saree
    ? (["saree_front_drape", "saree_back_drape", "fabric_pattern", "mannequin", "additional_product"] as ProductReferenceRole[])
      .flatMap((role) => references[role] ? [{ role, reference: references[role]! }] : [])
    : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
        {productSlots.map((slot) => (
          <ReferenceCard
            key={slot.id}
            reference={references[slot.id]}
            label={slot.label}
            description={slot.description}
            required={slot.required}
            onFile={(file) => onChange(slot.id, file)}
            onRemove={references[slot.id] ? () => onChange(slot.id, null) : undefined}
          />
        ))}
      </div>

      {legacyCandidates.length > 0 && onPromoteLegacyReference && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-700" />
            <p className="text-xs font-bold text-amber-900">Map available product evidence to Saree zones</p>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            Reuse one only when it visibly proves the named region. A generic upload is reclassified to the region you choose; a pallu image must show the pallu opened out.
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            {legacyCandidates.map(({ role, reference }) => (
              <div key={role} className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-xs">
                <img src={reference.previewUrl} alt={`${role.replaceAll("_", " ")} evidence`} className="aspect-[4/3] w-full object-cover" />
                <div className="p-2.5">
                  <p className="truncate text-[10px] font-bold uppercase tracking-wide text-amber-900">{role.replaceAll("_", " ")}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!references.saree_pallu_spread && (
                      <button
                        type="button"
                        onClick={() => onPromoteLegacyReference(role, "saree_pallu_spread")}
                        className="rounded-lg bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900 transition hover:bg-amber-200"
                      >
                        Use as pallu
                      </button>
                    )}
                    {!references.saree_body_detail && (
                      <button
                        type="button"
                        onClick={() => onPromoteLegacyReference(role, "saree_body_detail")}
                        className="rounded-lg bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-900 transition hover:bg-amber-200"
                      >
                        Use as body detail
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ModelFaceReference({
  reference,
  onFile,
  onRemove,
}: {
  reference?: StudioReference;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-4">
        <div className="w-[180px] shrink-0">
          <ReferenceCard
            reference={reference}
            label="Model Face Reference"
            description="Clear portrait / face photo"
            onFile={onFile}
            onRemove={reference ? onRemove : undefined}
          />
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface">
            <User className="h-3.5 w-3.5 text-primary" />
            <span>Face Lock Identity</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-secondary">
            <b>Optional.</b> When uploaded, this exact model identity is locked across all 6 poses — every camera angle, framing, and close-up preserves the same facial features. Leave empty to let the studio generate an AI model consistent with your selected demographic.
          </p>
        </div>
      </div>
    </div>
  );
}

export function StyleReferences({
  references,
  onAdd,
  onReplace,
  onRemove,
}: {
  references: StudioReference[];
  onAdd: (files: File[]) => void;
  onReplace: (id: string, file: File) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-secondary">
          Style & Scene References ({references.length}/3)
        </h4>
        <p className="mt-0.5 text-[10px] leading-relaxed text-secondary">
          Guides backdrop, lighting, camera mood & composition. Product references remain authoritative.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {references.map((reference, index) => (
          <ReferenceCard
            key={reference.id}
            reference={reference}
            label={`Style Ref ${index + 1}`}
            description="Scene & mood guide"
            onFile={(file) => onReplace(reference.id, file)}
            onRemove={() => onRemove(reference.id)}
          />
        ))}
        {references.length < 3 && (
          <ReferenceCard
            label="Add Style Ref"
            description="Scene · lighting · mood"
            onFile={(file) => onAdd([file])}
          />
        )}
      </div>
      <p className="text-[10px] text-secondary">PNG, JPEG, or WebP · maximum 20 MB each · up to 3 references</p>
    </div>
  );
}
