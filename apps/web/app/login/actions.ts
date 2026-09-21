"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email or password is incorrect." };

  // Where someone lands depends on what they are. Admins go on to the second factor, which is
  // required for every admin session; agents go to their dialer screen, which carries no MFA
  // requirement because an agent can only work the leads already assigned to them.
  const { data: isAdmin } = await supabase.rpc("is_listed_admin");
  if (isAdmin) redirect("/mfa");

  const { data: isAgent } = await supabase.rpc("is_listed_agent");
  redirect(isAgent ? "/dialer" : "/not-authorized");
}
