// A student's work on each sheet, in this browser (localStorage), keyed by the sheet's id and
// tagged with the hash of the sheet it started from, so a sheet updated on the site is noticed.
const PREFIX = "proofsheets:v1:";

export interface SavedSheet { text: string; sha256: string; saved: string }

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; /* storage full or blocked: work stays in the page */ }
}

export const loadSheet = (id: string): SavedSheet | null => read<SavedSheet>(`sheet:${id}`);
export const saveSheet = (id: string, text: string, sha256: string): void =>
  void write(`sheet:${id}`, { text, sha256, saved: new Date().toISOString() } satisfies SavedSheet);
export const forgetSheet = (id: string): void => { try { localStorage.removeItem(PREFIX + `sheet:${id}`); } catch { /* ignore */ } };
export const lastSheet = (): string | null => read<string>("last");
export const setLastSheet = (id: string): void => { write("last", id); };
export const teacherMode = (): boolean => read<boolean>("teacher") ?? false;
export const setTeacherModeStored = (on: boolean): void => { write("teacher", on); };
export const showTacticState = (): boolean => read<boolean>("tacticState") ?? false;
/** The environments (snapshot entry names) this browser used last, most recent first: the ones
 * whose ~1 GB inflated regions the cache keeps (qed64.ts). */
let recentInMemory: string[] = []; // storage blocked, unreadable or not writable: this page keeps its own
let recentStored = true;
export const recentEnvironments = (): string[] => {
  if (!recentStored) return recentInMemory;
  try {
    const raw = localStorage.getItem(PREFIX + "recentEnvironments");
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return recentInMemory;
  }
};
export const setRecentEnvironments = (names: string[]): void => { recentInMemory = names; recentStored = write("recentEnvironments", names); };
export const setShowTacticState = (on: boolean): void => { write("tacticState", on); };
