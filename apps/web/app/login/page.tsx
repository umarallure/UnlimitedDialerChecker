import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-xl font-semibold">Unlimited Dialer Checker</h1>
        <p className="text-sm text-zinc-500">Super admin sign in. Accounts are created by invitation only.</p>
      </div>
      <LoginForm />
    </main>
  );
}
