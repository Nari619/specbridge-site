import { NextResponse } from "next/server";
import { findTwin } from "@/lib/twin-detection";
import type { Capability } from "@/lib/analyze-core";

export const dynamic = "force-dynamic";

/**
 * Twin-catcher endpoint. Additive and isolated from /api/analyze — the demo
 * calls this after an analysis to check for an overlapping past PRD. Any failure
 * returns { twin: null } so the callout just doesn't appear; it can never break
 * the analysis flow or the production single engine.
 */
export async function POST(request: Request) {
  try {
    const { prd, capabilities } = await request.json();
    if (typeof prd !== "string" || !Array.isArray(capabilities)) {
      return NextResponse.json({ twin: null });
    }
    const twin = await findTwin(prd, capabilities as Capability[]);
    return NextResponse.json({ twin });
  } catch {
    return NextResponse.json({ twin: null });
  }
}
