import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/ui/Layout";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Studio } from "./features/studio/Studio";
import { Planning } from "./features/planning/Planning";
import { Events } from "./features/events/Events";
import { History } from "./features/history/History";
import { Admin } from "./features/admin/Admin";
import { Notifications } from "./features/notifications/Notifications";
import { Login } from "./features/auth/Login";
import { useWorkspace } from "./lib/WorkspaceContext";
import { useFirebaseAuth } from "./lib/FirebaseAuthContext";

function Guard({ permission, admin, children }: { permission?: string; admin?: boolean; children: React.ReactNode }) {
  const workspace = useWorkspace();
  const allowed = admin
    ? workspace.isAdmin || workspace.permissions.some((key) => key.startsWith("admin."))
    : !permission || workspace.isAdmin || workspace.permissions.includes(permission);
  return allowed ? children : <Navigate to="/" replace />;
}

function AppRoutes() {
  const workspace = useWorkspace();
  const landing = workspace.isAdmin || workspace.permissions.includes("reports.view")
    ? "/dashboard"
    : workspace.permissions.includes("studio.view")
      ? "/studio"
      : workspace.permissions.includes("planning.view")
        ? "/planning"
        : "/notifications";

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to={landing} replace />} />
        <Route path="dashboard" element={<Guard permission="reports.view"><Dashboard /></Guard>} />
        <Route path="studio" element={<Guard permission="studio.view"><Studio /></Guard>} />
        <Route path="planning" element={<Guard permission="planning.view"><Planning /></Guard>} />
        <Route path="events" element={<Guard permission="planning.view"><Events /></Guard>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="history" element={<Guard permission="studio.view"><History /></Guard>} />
        <Route path="admin" element={<Guard admin><Admin /></Guard>} />
        <Route path="*" element={<Navigate to={landing} replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { user, isLoading } = useFirebaseAuth();
  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-[#f7f3f0]"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }
  return (
    <BrowserRouter>
      {user ? <AppRoutes /> : <Login />}
    </BrowserRouter>
  );
}
