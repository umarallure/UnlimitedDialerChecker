"use client";
import { useActionState } from "react";
import { Alert, Field, Input, PrimaryButton } from "@/components/ui";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.error && <Alert>{state.error}</Alert>}
      <PrimaryButton disabled={pending} className="mt-2 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </PrimaryButton>
    </form>
  );
}
