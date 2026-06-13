import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Mail, Lock, Loader2, Phone, Building2, CheckCircle2, FolderOpen } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { toast } from "@/components/ui/use-toast";

export default function Register() {
  const [form, setForm] = useState({
    email: "", password: "", confirmPassword: "",
    first_name: "", last_name: "", phone: "", business_name: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  // Invitation detection state
  const [detectingInvite, setDetectingInvite] = useState(false);
  const [inviteInfo, setInviteInfo] = useState(null); // { role, projects: [{name}] }
  const [emailChecked, setEmailChecked] = useState("");

  // Detect invitation when email field blurs
  const handleEmailBlur = async () => {
    const email = form.email.trim().toLowerCase();
    if (!email || email === emailChecked) return;
    setEmailChecked(email);
    setDetectingInvite(true);
    setInviteInfo(null);
    try {
      const res = await base44.functions.invoke('invitationService', { action: 'detect', email });
      const data = res?.data;
      if (data?.status === 'pending' && data.invitedUser) {
        const inv = data.invitedUser;
        // Fetch pending assignments to list projects
        const assignments = await base44.entities.PendingProjectAssignment.filter
          ? null : null; // Will be fetched below via service role — use a simple list call
        // Fetch projects from pending assignments via invitationService detect response
        // We'll display the role and fetch projects separately
        let projects = [];
        try {
          const allAssignments = await base44.functions.invoke('invitationService', {
            action: 'listAssignments',
            email,
          });
          projects = allAssignments?.data?.projects || [];
        } catch (_) {}
        setInviteInfo({
          role: inv.app_role || 'External',
          invitedUserId: inv.id,
          projects,
        });
      }
    } catch (_) {
      // Silent — non-critical
    } finally {
      setDetectingInvite(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await base44.auth.register({ email: form.email, password: form.password });
      setShowOtp(true);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await base44.auth.verifyOtp({ email: form.email, otpCode });
      if (result?.access_token) {
        base44.auth.setToken(result.access_token);
      }
      // Save profile data
      try {
        await base44.auth.updateMe({
          first_name: form.first_name,
          last_name: form.last_name,
          phone: form.phone,
          business_name: form.business_name,
          // If invited, apply the assigned role; never use a self-selected role
          ...(inviteInfo?.role ? { construction_role: inviteInfo.role } : {}),
        });
      } catch (_) { /* non-critical */ }
      // Trigger pending assignment activation
      try {
        await base44.functions.invoke('processPendingAssignments', {});
      } catch (_) { /* non-critical */ }
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    try {
      await base44.auth.resendOtp(form.email);
      toast({ title: "Code sent", description: "Check your email for the new code." });
    } catch (err) {
      setError(err.message || "Failed to resend code");
    }
  };

  const handleGoogle = () => {
    base44.auth.loginWithProvider("google", "/");
  };

  if (showOtp) {
    return (
      <AuthLayout icon={Mail} title="Verify your email" subtitle={`We sent a code to ${form.email}`}>
        {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}
        <div className="flex justify-center mb-6">
          <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode} autoFocus autoComplete="one-time-code">
            <InputOTPGroup>
              {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <Button className="w-full h-12 font-medium" onClick={handleVerify} disabled={loading || otpCode.length < 6}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : "Verify"}
        </Button>
        <p className="text-center text-sm text-muted-foreground mt-4">
          Didn't receive the code?{" "}
          <button onClick={handleResend} className="text-primary font-medium hover:underline">Resend</button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      title="Create your account"
      subtitle="Sign up to get started"
      footer={
        <>Already have an account?{" "}<Link to="/login" className="text-primary font-medium hover:underline">Log in</Link></>
      }
    >
      <Button variant="outline" className="w-full h-12 text-sm font-medium mb-6" onClick={handleGoogle}>
        <GoogleIcon className="w-5 h-5 mr-2" />
        Continue with Google
      </Button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">or</span>
        </div>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}

      {/* Invitation banner — shown when a pending invite is detected */}
      {inviteInfo && (
        <div className="mb-5 p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-primary">You have been invited to ConstructIQ</span>
          </div>
          <div className="text-sm text-foreground">
            <span className="text-muted-foreground">Assigned Role: </span>
            <Badge variant="secondary" className="text-xs ml-1">{inviteInfo.role}</Badge>
          </div>
          {inviteInfo.projects?.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground text-xs">Projects waiting:</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {inviteInfo.projects.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    <FolderOpen className="w-3 h-3" />{p.name || p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="first_name">First Name</Label>
            <Input id="first_name" value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} placeholder="First name" className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Last Name</Label>
            <Input id="last_name" value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} placeholder="Last name" className="h-11" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="email" type="email" autoComplete="email" placeholder="you@example.com"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              onBlur={handleEmailBlur}
              className="pl-10 h-12"
              required
            />
            {detectingInvite && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="phone" type="tel" placeholder="+1 (555) 000-0000" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="pl-10 h-12" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="business_name">Organisation</Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="business_name" placeholder="Your company" value={form.business_name} onChange={e => setForm({...form, business_name: e.target.value})} className="pl-10 h-12" />
          </div>
        </div>

        {/* Role: show read-only if invited, hidden entirely if not */}
        {inviteInfo && (
          <div className="space-y-2">
            <Label>Role</Label>
            <div className="h-12 px-3 flex items-center rounded-md border border-input bg-muted/50 text-sm text-muted-foreground">
              {inviteInfo.role}
              <span className="ml-auto text-xs text-muted-foreground/60">Assigned by administrator</span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="password" type="password" autoComplete="new-password" placeholder="••••••••" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="pl-10 h-12" required />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input id="confirm" type="password" autoComplete="new-password" placeholder="••••••••" value={form.confirmPassword} onChange={e => setForm({...form, confirmPassword: e.target.value})} className="pl-10 h-12" required />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating account...</> : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}