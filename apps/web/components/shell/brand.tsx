import Link from "next/link";

/** Wordmark: an ink signal glyph with an orange live dot, then the product name in tracked caps. */
export function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Unlimited Dialer Checker home">
      <span aria-hidden className="relative flex size-8 items-end justify-center gap-[3px] rounded-md bg-ink pb-[7px]">
        <span className="h-2 w-[3px] rounded-full bg-on-dark" />
        <span className="h-3.5 w-[3px] rounded-full bg-on-dark" />
        <span className="h-[18px] w-[3px] rounded-full bg-on-dark" />
        <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-surface" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-bold tracking-[0.08em] text-ink">UNLIMITED</span>
        <span className="mt-0.5 text-legal font-medium tracking-[0.02em] text-muted">Dialer Checker</span>
      </span>
    </Link>
  );
}
