import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ImportForm } from "./import-form";

export default async function ImportNumbersPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("dids").select("e164, lifecycle, notes");

  return (
    <>
      <PageHeader
        eyebrow="Numbers"
        title="Import numbers"
        description="Upload a CSV of caller-ID numbers from Teleinx. New numbers start in Aging; numbers already in the pool get their details updated and keep their lifecycle."
      />
      <ImportForm existing={data ?? []} />
    </>
  );
}
