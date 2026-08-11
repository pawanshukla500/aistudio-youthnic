// oxlint-disable react/only-export-components -- provider and consumer hook intentionally share the workspace contract.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFirebaseAuth } from "./FirebaseAuthContext";
import { supabase } from "./supabase";
import { getErrorMessage } from "./errors";

export type WorkspaceValue = {
  organization: Record<string, any> & { _id: string; id: string; name: string };
  user: Record<string, any> & { _id: string; id: string; email: string; displayName: string };
  membership: Record<string, any> & { _id: string };
  roles: Array<Record<string, any> & { _id: string; id: string; name: string; slug: string }>;
  permissions: string[];
  isAdmin: boolean;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function LoadingWorkspace({ label = "Preparing Youthnic Studio…" }: { label?: string }) {
  return <div className="grid min-h-screen place-items-center bg-background"><div className="flex items-center gap-3 text-sm font-semibold text-secondary"><span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />{label}</div></div>;
}

function normalizeWorkspace(value: Record<string, any>): WorkspaceValue | null {
  if (!value?.organization || !value?.member) return null;
  const organization = { ...value.organization, _id: value.organization.id };
  const member = { ...value.member, _id: value.member.id };
  const userSource = value.user || {};
  const user = {
    ...userSource,
    _id: userSource.id || member.id,
    id: userSource.id || member.id,
    email: userSource.email || member.email || "",
    displayName: userSource.name || member.display_name || member.email || "Workspace member",
  };
  const roles = (Array.isArray(value.roles) ? value.roles : []).map((role: Record<string, any>) => ({
    ...role,
    _id: String(role.id),
    id: String(role.id),
    name: String(role.name || "Role"),
    slug: String(role.slug || "member"),
  }));
  return { organization, user, membership: member, roles, permissions: Array.isArray(value.permissions) ? value.permissions : [], isAdmin: Boolean(value.isAdmin) };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user: firebaseUser, isLoading: firebaseLoading, signOut } = useFirebaseAuth();
  const [workspace, setWorkspace] = useState<WorkspaceValue | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const refresh = () => setRetry((current) => current + 1);
    window.addEventListener("workspace-refresh", refresh);
    return () => window.removeEventListener("workspace-refresh", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    if (!firebaseUser) {
      setWorkspace(undefined);
      setError("");
      return () => { active = false; };
    }
    setWorkspace(undefined);
    setError("");
    void firebaseUser.getIdToken(true).then(async () => {
      const { data, error: rpcError } = await supabase.rpc("app_current_workspace");
      if (rpcError) throw rpcError;
      if (active) setWorkspace(normalizeWorkspace(data as Record<string, any>));
    }).catch((reason) => {
      if (active) setError(getErrorMessage(reason, "Could not load your Supabase workspace."));
    });
    return () => { active = false; };
  }, [firebaseUser, retry]);

  const value = useMemo(() => workspace || null, [workspace]);
  if (firebaseLoading) return <LoadingWorkspace label="Checking your secure session…" />;
  if (!firebaseUser) return <>{children}</>;
  if (error) {
    return <div className="grid min-h-screen place-items-center bg-background p-6"><div className="max-w-md rounded-2xl border border-danger/20 bg-white p-6 text-center shadow-sm"><h1 className="text-lg font-bold text-on-surface">Workspace connection failed</h1><p className="mt-2 text-sm leading-6 text-secondary">{error}</p><div className="mt-5 flex justify-center gap-3"><button onClick={() => setRetry((current) => current + 1)} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white">Retry</button><button onClick={() => void signOut()} className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-secondary">Sign out</button></div></div></div>;
  }
  if (workspace === undefined) return <LoadingWorkspace label="Loading your Supabase workspace…" />;
  if (!value) {
    return <div className="grid min-h-screen place-items-center bg-background p-6"><div className="max-w-md rounded-2xl border border-outline-variant bg-white p-6 text-center shadow-sm"><h1 className="text-lg font-bold text-on-surface">No active workspace access</h1><p className="mt-2 text-sm leading-6 text-secondary">This Firebase account is valid but has no active Supabase organization membership. Ask an administrator to enable access.</p><button onClick={() => void signOut()} className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white">Sign out</button></div></div>;
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}
