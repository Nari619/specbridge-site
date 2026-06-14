"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-md bg-brand px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-brand/90"
    >
      Download PDF
    </button>
  );
}
