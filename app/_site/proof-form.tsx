// A plain GET form: works without JavaScript.
export function ProofForm() {
  return (
    <form action="/proof" method="get" className="mt-6 flex gap-2">
      <input name="id" required placeholder="run_8a5d80819c57aa9542af" aria-label="Proof id" className="numerals min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 py-2 text-[13px] text-bone placeholder:text-mist/60 focus:border-brand/60 focus:outline-none" />
      <button className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-[13px] font-semibold text-brand hover:bg-brand/20">Verify</button>
    </form>
  );
}
