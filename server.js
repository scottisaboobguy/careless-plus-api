import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const app = express();
app.use(cors());
app.use(express.json());

// ─── Your YouTube channel ───────────────────────────────────────────────────
const CHANNEL_URL = "https://www.youtube.com/@carelessscott";

// ─── Category keyword rules (first match wins) ──────────────────────────────
const CATEGORY_RULES = [
  {
    keywords: [
      "assassin", "cod", "call of duty", "gaming", "game", "gameplay",
      "minecraft", "fortnite", "warzone", "xbox", "playstation", "ps4",
      "ps5", "clips", "level", "boss", "dungeon", "quest", "raid",
      "gta", "batman", "arkham", "colina", "heist", "odyssey",
    ],
    category: "Gaming",
  },
  {
    keywords: [
      "reaction", "react", "watching", "reacting", "review", "responding",
      "cheated", "caught",
    ],
    category: "Reaction Videos",
  },
  {
    keywords: [
      "skit", "comedy", "funny", "prank", "challenge", "taser", "shocked",
      "vlog", "news", "caveman", "multifari", "landon",
    ],
    category: "Skits & Comedy",
  },
];

function detectCategory(title) {
  const lower = title.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.category;
  }
  return "All Videos";
}

function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

// ─── 30-minute in-memory cache ───────────────────────────────────────────────
let cachedRows = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchChannelVideos() {
  const now = Date.now();
  if (cachedRows && now < cacheExpiry) return cachedRows;

  const { stdout } = await execFileAsync("yt-dlp", [
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    CHANNEL_URL,
  ]);

  const lines = stdout.trim().split("\n").filter(Boolean);
  const rowMap = new Map();

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    const videoId = entry.id ?? "";
    if (!videoId) continue;

    const title = entry.title ?? "Untitled";
    const entryUrl = entry.url ?? "";
    const isShort = entryUrl.includes("/shorts/");
    const duration = isShort
      ? "Short"
      : (entry.duration_string ?? formatDuration(entry.duration ?? 0));

    const thumbs = entry.thumbnails ?? [];
    const hd =
      thumbs.find((t) => (t.height ?? 0) >= 180)?.url ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const sd = thumbs[0]?.url ?? hd;

    const category = isShort ? "Shorts" : detectCategory(title);
    if (!rowMap.has(category)) rowMap.set(category, []);
    rowMap.get(category).push({ videoId, title, duration, thumbnailUrl: sd, thumbnailHd: hd });
  }

  const ORDER = ["Gaming", "Reaction Videos", "Skits & Comedy", "Shorts", "All Videos"];
  const rows = [];
  for (const cat of ORDER) {
    const items = rowMap.get(cat);
    if (items?.length > 0) rows.push({ category: cat, items });
  }
  for (const [cat, items] of rowMap) {
    if (!ORDER.includes(cat) && items.length > 0) rows.push({ category: cat, items });
  }

  cachedRows = rows;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return rows;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
app.get("/api/videos", async (req, res) => {
  try {
    const rows = await fetchChannelVideos();
    res.json({ rows });
  } catch (err) {
    console.error("Failed to fetch videos:", err);
    res.status(500).json({ error: "Failed to fetch videos" });
  }
});

app.get("/api/stream/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) return res.status(400).json({ error: "videoId required" });

  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const { stdout } = await execFileAsync("yt-dlp", [
      "--extractor-args", "youtube:player_client=android_vr",
      "-f", "best[ext=mp4]/best",
      "-g",
      "--no-warnings",
      url,
    ]);
    const streamUrl = stdout.trim().split("\n")[0];
    if (!streamUrl) return res.status(404).json({ error: "No stream URL found" });
    res.json({ url: streamUrl });
  } catch (err) {
    console.error("Stream resolve failed:", err);
    res.status(500).json({ error: "Failed to resolve stream URL" });
  }
});

app.get("/", (req, res) => res.json({ status: "ok", service: "CARELESS+ API" }));

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CARELESS+ API running on port ${PORT}`));
