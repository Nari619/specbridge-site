import { supabase } from "@/lib/supabase";

/**
 * The tool shape SpecBridge's matching code expects — identical to the legacy
 * 25-tool registry in data/registry.json so it can drop in unchanged later.
 */
export type RegistryTool = {
  name: string;
  description: string;
  input_parameters: { name: string; type: string; required: boolean }[];
  owner_team: string;
  owner_contact: string;
  docs_url: string | null;
  repo_path: string | null;
  version: string | null;
  compliance_tags: string[];
  status: string;
  est_cost_per_call_usd: { low: number; high: number };
  example_call: unknown;
  example_response: unknown;
};

/** Raw shape of a row in the Supabase "tools" table (as it actually exists). */
type ToolRow = {
  name: string | null;
  description: string | null;
  category: string | null;
  input_parameters: unknown;
  owner_team: string | null;
  owner_contact: string | null;
  compliance_tags: unknown;
  status: string | null;
  est_cost_per_call_usd: number | string | null;
  docs_url: string | null;
  repo_path: string | null;
  version: string | null;
};

function mapParameters(
  raw: unknown,
): { name: string; type: string; required: boolean }[] {
  if (!Array.isArray(raw)) return []; // column is nullable in the DB
  return raw.map((p) => {
    const o = (typeof p === "object" && p !== null ? p : {}) as Record<
      string,
      unknown
    >;
    return {
      name: String(o.name ?? ""),
      type: String(o.type ?? ""),
      required: Boolean(o.required),
    };
  });
}

/** Map one DB row onto the legacy registry tool shape. */
function mapRow(row: ToolRow): RegistryTool {
  const cost = Number(row.est_cost_per_call_usd);
  const costVal = Number.isFinite(cost) ? cost : 0;
  return {
    name: row.name ?? "",
    description: row.description ?? "",
    input_parameters: mapParameters(row.input_parameters),
    owner_team: row.owner_team ?? "",
    owner_contact: row.owner_contact ?? "",
    docs_url: row.docs_url ?? null,
    repo_path: row.repo_path ?? null,
    version: row.version ?? null,
    compliance_tags: Array.isArray(row.compliance_tags)
      ? row.compliance_tags.map(String)
      : [],
    status: row.status ?? "active",
    // DB stores a single point estimate; the legacy shape uses a {low, high}
    // band, so map the point to a degenerate range (low === high).
    est_cost_per_call_usd: { low: costVal, high: costVal },
    // Not present in the Supabase schema; the legacy shape carries these.
    example_call: null,
    example_response: null,
  };
}

/**
 * Reads every row from the Supabase "tools" table and returns them in the
 * legacy registry shape. (Supabase returns up to 1000 rows per select by
 * default, comfortably above the 100 tools here.)
 */
export async function getRegistryTools(): Promise<RegistryTool[]> {
  const { data, error } = await supabase.from("tools").select("*");
  if (error) {
    throw new Error(`Failed to read tools from Supabase: ${error.message}`);
  }
  return (data ?? []).map((row) => mapRow(row as ToolRow));
}
