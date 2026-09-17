import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" description="Super admin access only. Accounts are created by invitation.">
      <LoginForm />
    </AuthShell>
  );
}
