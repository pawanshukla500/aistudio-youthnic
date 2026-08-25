import { useState } from "react";
import { ImagePlus, Trash2, UploadCloud } from "lucide-react";
import type { ProductReferenceRole, StudioReference } from "../types";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp";

const genericProductSlots: Array<{
  id: ProductReferenceRole;
  label: string;
  description: string;
  required: boolean;
}> = [
  { id: "front", label: "Upload Front", description: "Click or drop image", required: true },
  { id: "back", label: "Upload Back", description: "Click or drop image", required: true },
  { id: "fabric_pattern", label: "Upload Fabric / Pattern Detail", description: "Click or drop image", required: false },
  { id: "mannequin", label: "Upload Mannequin / Flat-lay Shot", description: "Dress form or flat-lay — sets worn shape and drape", required: false },
  { id: "additional_product", label: "Upload Additional Product Photo", description: "Click or drop image", required: false },
];

const sareeProductSlots: typeof genericProductSlots = [
  { id: "saree_front_drape", label: "Full saree front", description: "Complete front drape, pleats and borders", required: true },
  { id: "saree_back_drape", label: "Rear / back drape", description: "Full rear drape and pallu fall", required: true },
  { id: "saree_pallu_spread", label: "Pallu spread", description: "Fully open pallu artwork and edges", required: true },
  { id: "saree_body_detail", label: "Body fabric / pattern", description: "Close-up of weave, colour and motifs", required: true },
  { id: "saree_border_tassels", label: "Border / tassels", description: "Widths, construction and tassel spacing", required: false },
  { id: "saree_blouse_front", label: "Blouse front", description: "Front construction, neckline and sleeves", required: false },
  { id: "saree_blouse_back_piece", label: "Blouse back / piece", description: "Back construction or unstitched piece", required: false },
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
    <div className="relative">
      <label
        className={`group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed bg-surface-container-lowest p-4 text-center transition-colors hover:border-primary/40 hover:bg-surface-container-low ${dragging ? "border-primary bg-primary/5 ring-2 ring-primary/15" : "border-outline-variant/60"}`}
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
            <img className="absolute inset-0 h-full w-full object-cover" src={reference.previewUrl} alt={`${label} preview`} />
            <span className="absolute inset-0 grid place-items-center bg-navy-soft/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <span className="flex items-center gap-2 rounded-lg bg-black/35 px-3 py-2 text-xs font-bold text-white"><ImagePlus className="h-5 w-5" /> Replace</span>
            </span>
          </>
        ) : (
          <>
            <UploadCloud className="mb-2 h-5 w-5 text-rose-500 transition-colors group-hover:text-rose-600" />
            <span className="text-xs font-bold leading-tight text-on-surface">{label}</span>
            <span className="mt-1 text-[10px] font-medium leading-tight text-secondary">{description}</span>
            <span className={`mt-2 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${required ? "bg-danger-surface text-danger" : "bg-surface-container text-secondary"}`}>{required ? "Required" : "Optional"}</span>
          </>
        )}
      </label>
      {reference && onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="absolute -right-2 -top-2 z-10 grid h-7 w-7 place-items-center rounded-full border border-outline-variant bg-white text-secondary shadow-sm transition-colors hover:border-danger hover:text-danger"
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
      <div className="grid grid-cols-2 gap-3">
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
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-xs font-bold text-amber-900">Map available product evidence carefully</p>
          <p className="mt-1 text-[11px] leading-4 text-amber-800">Reuse one only when it visibly proves the named region. A generic upload is reclassified to the region you choose; a pallu image must show the pallu opened out, not only a fabric close-up.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {legacyCandidates.map(({ role, reference }) => (
              <div key={role} className="overflow-hidden rounded-lg border border-amber-200 bg-white">
                <img src={reference.previewUrl} alt={`${role.replaceAll("_", " ")} evidence`} className="aspect-[4/3] w-full object-cover" />
                <div className="p-2">
                  <p className="truncate text-[10px] font-bold uppercase tracking-wide text-amber-900">{role.replaceAll("_", " ")}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!references.saree_pallu_spread && <button type="button" onClick={() => onPromoteLegacyReference(role, "saree_pallu_spread")} className="rounded-md bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900 hover:bg-amber-200">Use as pallu</button>}
                    {!references.saree_body_detail && <button type="button" onClick={() => onPromoteLegacyReference(role, "saree_body_detail")} className="rounded-md bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900 hover:bg-amber-200">Use as body detail</button>}
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
    <div className="space-y-2">
      <div className="max-w-[220px]">
        <ReferenceCard
          reference={reference}
          label="Upload Model Face Reference"
          description="Click or drop a clear face photo"
          onFile={onFile}
          onRemove={reference ? onRemove : undefined}
        />
      </div>
      <p className="text-[10px] leading-4 text-secondary">
        Optional. When uploaded, this exact face is locked as the model's identity for every pose — the shoot matches it as closely as photographically possible instead of designing its own face. Leave empty to let the shoot design one consistent model.
      </p>
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {references.map((reference, index) => (
          <ReferenceCard
            key={reference.id}
            reference={reference}
            label={`Style reference ${index + 1}`}
            description="Scene guide"
            onFile={(file) => onReplace(reference.id, file)}
            onRemove={() => onRemove(reference.id)}
          />
        ))}
        {references.length < 3 && (
          <ReferenceCard
            label="Style reference"
            description="Scene · composition · light"
            onFile={(file) => onAdd([file])}
          />
        )}
      </div>
      <p className="text-[10px] leading-4 text-secondary">PNG, JPEG, or WebP · maximum 20 MB each · up to three style references</p>
    </div>
  );
}
