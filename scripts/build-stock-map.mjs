import fs from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";
import JSZip from "jszip";

const SOURCES = [
  {
    url: "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip",
    market: "KOSPI",
    tailWidth: 228,
  },
  {
    url: "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip",
    market: "KOSDAQ",
    tailWidth: 222,
  },
];

const decodeMst = (buf) => iconv.decode(buf, "cp949");

const parseMaster = (raw, market, tailWidth) => {
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const head = line.length > tailWidth ? line.slice(0, line.length - tailWidth) : line;
    const code = head.slice(0, 9).trim();
    const name = head.slice(21).trim();
    if (!code || !name) continue;
    out.push({ code, name, market });
  }
  return out;
};

const downloadAndParse = async (source) => {
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`download failed: ${source.url} (${res.status})`);

  const ab = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(ab);
  const first = Object.keys(zip.files).find((name) => !zip.files[name].dir);
  if (!first) throw new Error(`zip file empty: ${source.url}`);

  const mstBuf = await zip.files[first].async("nodebuffer");
  return parseMaster(decodeMst(mstBuf), source.market, source.tailWidth);
};

const main = async () => {
  const rows = [];
  for (const source of SOURCES) {
    const parsed = await downloadAndParse(source);
    rows.push(...parsed);
  }

  const dedup = new Map();
  for (const row of rows) {
    if (!dedup.has(row.code)) dedup.set(row.code, row);
  }

  const list = [...dedup.values()].sort((a, b) => a.code.localeCompare(b.code));
  const outDir = path.join(process.cwd(), "data");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "kr-stocks.json"), JSON.stringify(list, null, 2), "utf-8");

  console.log(`wrote data/kr-stocks.json (${list.length} items)`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

