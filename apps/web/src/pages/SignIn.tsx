import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.js";

/**
 * Email + password sign-in.
 *
 * Password rather than magic link because the primary flow is a phone that
 * may be offline-ish in a gym basement, and a link round-trip through an
 * email client is a poor fit for "tap record and talk".
 */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    setBusy(false);
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-950 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Training log</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to see your training.</p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-400">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-400">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-sky-600 px-3 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
