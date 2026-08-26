type ReferenceEntry = {
  imageNumber?: number;
  role?: string;
  filename?: string;
  hash?: string;
  authority?: string;
};

export function ReferenceNode({ data }: { data?: { poseIndex?: number; referenceManifest?: { references?: ReferenceEntry[] } | null } }) {
  const references = Array.isArray(data?.referenceManifest?.references) ? data.referenceManifest.references : [];
  const isBack = data?.poseIndex === 3;

  return (
    <div className="min-w-[240px] rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-3 shadow-sm">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-secondary">References sent to generator</div>
      {isBack && <p className="mb-2 rounded bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">True back: rear product reference is the sole visual authority.</p>}
      {references.length ? (
        <ol className="space-y-1">
          {references.map((reference, index) => (
            <li key={`${reference.hash || reference.filename || reference.role}:${index}`} className="text-[11px] text-on-surface">
              <span className="font-semibold">{reference.imageNumber || index + 1}. {(reference.role || "reference").replace(/_/g, " ")}</span>
              {reference.authority === "true_back_product_authority" && <span className="ml-1 text-[9px] font-bold uppercase text-emerald-700">rear authority</span>}
              {reference.filename && <span className="block truncate text-[10px] text-secondary">{reference.filename}</span>}
            </li>
          ))}
        </ol>
      ) : <div className="text-xs text-secondary">This older attempt did not persist a source manifest.</div>}
    </div>
  );
}
