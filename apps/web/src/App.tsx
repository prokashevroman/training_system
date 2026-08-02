import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { useAuth } from "./lib/auth.js";
import { History } from "./pages/History.js";
import { ImportReview } from "./pages/ImportReview.js";
import { More } from "./pages/More.js";
import { Record } from "./pages/Record.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { SignIn } from "./pages/SignIn.js";
import { Today } from "./pages/Today.js";

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-950 text-slate-500">
        Loading…
      </div>
    );
  }

  // Everything behind the shell requires a session. RLS would refuse the
  // queries anyway, but gating here avoids a screen full of empty states.
  if (!session) return <SignIn />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/record" element={<Record />} />
        <Route path="/history" element={<History />} />
        <Route path="/sessions/:id" element={<SessionDetail />} />
        <Route path="/import-review" element={<ImportReview />} />
        <Route path="/more" element={<More />} />
        <Route path="*" element={<Today />} />
      </Routes>
    </AppShell>
  );
}
