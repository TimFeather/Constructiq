import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function Login() {
  const [searchParams] = useSearchParams();
  const resetSuccess = searchParams.get("reset") === "success";
  const justRegistered = searchParams.get("registered") === "1";
  // Set by invokeFunction when Supabase refuses to refresh a session that was
  // ended elsewhere — see recoverSession() in src/api/supabaseClient.js.
  const sessionExpired = searchParams.get("expired") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      window.location.href = "/dashboard";
    } catch (err) {
      // "Email not confirmed" is Supabase's wording for an account left
      // unverified by the old registration flow (which emailed a one-time link
      // that mail scanners routinely consumed). Registration now confirms on
      // creation, so re-opening the invite link repairs the account — say so,
      // because the raw message tells the user nothing they can act on.
      const raw = err.message || "";
      setError(
        /email not confirmed/i.test(raw)
          ? "This account was never activated. Open the \"Create a free account\" link in your invitation email again to finish setting it up — you can reuse this email address and choose a new password."
          : raw || "Invalid email or password"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="Welcome back"
      subtitle="Log in to your account"
      footer={
        <span className="text-muted-foreground">
          Access is by invitation only. Contact your administrator to be invited.
        </span>
      }
    >
      {resetSuccess && !error && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 text-sm">
          Your password has been reset. Log in with your new password.
        </div>
      )}

      {justRegistered && !error && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 text-sm">
          Your account is ready. Log in with the email you were invited on and the password you just chose.
        </div>
      )}

      {sessionExpired && !error && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400 text-sm">
          Your session has expired. Log in again to carry on.
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Logging in...
            </>
          ) : (
            "Log in"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
