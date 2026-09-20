/**
 * The link an agent clicks to open a lead in the CRM.
 *
 * VICIdial substitutes lead fields into the campaign's web form address using its own
 * `--A--field--B--` markers, and does it on the dialer at call time. So what we store here is a
 * template with `{id}` where the CRM's lead id goes, and what VICIdial gets is that template
 * with the marker in place.
 *
 * The id travels in `source_id`, not `vendor_lead_code`: a CRM id is often a UUID at 36
 * characters, and vendor_lead_code is varchar(20) — it would be silently truncated into a link
 * that opens nothing.
 */

/** The lead field carrying the CRM's id. 50 characters, enough for a UUID. */
export const CRM_ID_FIELD = "source_id";

const TOKEN = `--A--${CRM_ID_FIELD}--B--`;

export class LeadLinkError extends Error {}

/** Turn the template an operator typed into the address VICIdial should hold. */
export function toWebFormAddress(template: string): string {
  const trimmed = template.trim();
  if (!trimmed) throw new LeadLinkError("Give a link, or leave it empty to remove the button.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new LeadLinkError("That is not a full web address. Start with https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LeadLinkError("A link must be http or https.");
  }
  if (!trimmed.includes("{id}")) {
    throw new LeadLinkError("Put {id} where the lead's id belongs, for example https://crm.example.com/leads/{id}");
  }

  return trimmed.replaceAll("{id}", TOKEN);
}

/** The reverse, for showing a stored address back to whoever set it. */
export function fromWebFormAddress(address: string | null | undefined): string {
  return (address ?? "").replaceAll(TOKEN, "{id}");
}

/** What the agent will actually open, for the confirmation line in the UI. */
export function exampleLink(template: string, sampleId = "8f14e45f-ea8d-4c4a-9f6b-1f0a2b3c4d5e"): string {
  return template.replaceAll("{id}", sampleId);
}
