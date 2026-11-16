// The copy rules' banned words, read from scripts/blogpost.py so the tip emails follow the same list.
import { readFileSync } from "node:fs";
const py = readFileSync(new URL("../../scripts/blogpost.py", import.meta.url), "utf8");
export const BANNED: string[] = [...py.slice(py.indexOf("BANNED = ["), py.indexOf("]", py.indexOf("BANNED = ["))).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
