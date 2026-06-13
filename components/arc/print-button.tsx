"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
    >
      Download PDF
    </button>
  );
}
