/** Contract: docs/api-contract.md § The journal */

export interface JournalTarget {
  ra: number;
  dec: number;
  epoch: number;
  pm_ra: number | null;
  pm_dec: number | null;
}

export interface JournalView {
  detector?: number | null;
  pass?: number | null;
  frame?: string | null;
}

export interface JournalEntry {
  id: string;
  name: string;
  source: string;
  status: string;
  kind: string | null;
  method: string | null;
  confidence: string | null;
  significance: number | null;
  ra: number;
  dec: number;
  epoch: number | null;
  target: JournalTarget;
  preset: string | null;
  found: string | null;
  known: string | null;
  measured: string | null;
  category?: string | null;
  view?: JournalView | null;
  shared?: string | null;
}

export interface JournalFile {
  format: "spherex-explorer/journal";
  version: number;
  generated: string;
  entries: JournalEntry[];
}

export interface JournalLiveResponse {
  open: boolean;
  limit?: number;
  per_hour?: number;
  entries: JournalEntry[];
}

const JOURNAL_URL = `${import.meta.env.BASE_URL}samples/journal.json`;

/** Team checks from the static file. */
export async function fetchJournalFile(signal?: AbortSignal): Promise<JournalFile> {
  const res = await fetch(JOURNAL_URL, { signal });
  if (!res.ok) throw new Error(`Failed to load journal: ${res.status}`);
  const data = (await res.json()) as JournalFile;
  if (data.format !== "spherex-explorer/journal") {
    throw new Error("Not a SPHEREx journal file");
  }
  return data;
}

/** Unconfirmed first (invite to look), then the rest in file order. */
export function sortJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => {
    const rank = (s: string) => (s === "unconfirmed" ? 0 : s === "synthetic" ? 2 : 1);
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return 0;
  });
}

export function journalStatusLabel(status: string): string {
  if (status === "unconfirmed") return "Not in the catalogs we asked. Have a look.";
  if (status === "synthetic") return "SYNTHETIC";
  if (status === "confirmed") return "Confirmed";
  return status;
}
