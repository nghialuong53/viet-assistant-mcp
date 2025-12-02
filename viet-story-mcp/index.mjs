// index.mjs
// Viet-story-mcp (2025) — phiên bản fix native fetch + tối ưu cho Render
// Không dùng node-fetch. Hoàn toàn dùng fetch native của Node 18+
// Các chức năng: truyện, sách, tin tức quốc tế (dịch tiếng Việt), cache, timeout, concurrency.

import express from "express";
import Parser from "rss-parser";
import translate from "@vitalets/google-translate-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// --------------------------------------
// CONFIG
// --------------------------------------
const PORT = process.env.PORT || 3000;
const USER_AGENT = process.env.USER_AGENT || "Viet-Story-MCP/1.5";
const FEED_TIMEOUT_MS = parseInt(process.env.FEED_TIMEOUT_MS || "8000", 10);
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || "120000", 10);
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || "4", 10);

// --------------------------------------
// SIMPLE CACHE
// --------------------------------------
const cache = new Map();
function getCache(key) {
  const data = cache.get(key);
  if (!data) return null;
  if (Date.now() - data.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return data.value;
}
function setCache(key, value) {
  cache.set(key, { time: Date.now(), value });
}

// --------------------------------------
// LOGGING
// --------------------------------------
function log(...msg) {
  console.log(new Date().toISOString(), ...msg);
}

// --------------------------------------
// CLEAN HTML → TEXT
// --------------------------------------
function stripHtml(html = "") {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function splitToParts(text = "", size = 900) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += size;
  }
  return out;
}

// --------------------------------------
// FETCH WITH TIMEOUT (native fetch)
// --------------------------------------
async function fetchWithTimeout(url, timeout = FEED_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });

    clearTimeout(id);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return await res.text();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// --------------------------------------
// RSS PARSER + CACHE
// --------------------------------------
const parser = new Parser({ headers: { "User-Agent": USER_AGENT } });

async function parseFeedUrl(url) {
  const cached = getCache(url);
  if (cached) return cached;

  const xml = await fetchWithTimeout(url);
  const feed = await parser.parseString(xml);
  setCache(url, feed);
  return feed;
}

// --------------------------------------
// CONCURRENCY QUEUE
// --------------------------------------
function createQueue(limit = MAX_CONCURRENCY) {
  let running = 0;
  const queue = [];

  function run() {
    if (running >= limit || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    running++;
    fn()
      .then((r) => {
        running--;
        resolve(r);
        run();
      })
      .catch((e) => {
        running--;
        reject(e);
        run();
      });
  }

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      run();
    });
  }

  return { enqueue };
}

const queue = createQueue(MAX_CONCURRENCY);

// --------------------------------------
// SOURCES
// --------------------------------------
const STORY_SOURCES = [
  { id: "vnexpress_giaitri", name: "VnExpress Giải trí", rss: "https://vnexpress.net/rss/giai-tri.rss" },
  { id: "zing_vanhoa", name: "Zing Văn hóa", rss: "https://zingnews.vn/rss/van-hoa.rss" },
  { id: "dantri_vanhoa", name: "Dân Trí Văn hóa", rss: "https://dantri.com.vn/rss/van-hoa.rss" }
];

const BOOK_SOURCES = [
  { id: "zing_xuatban", name: "Zing Xuất bản", rss: "https://zingnews.vn/rss/xuat-ban.rss" },
  { id: "tuoitre_sach", name: "Tuổi Trẻ Sách", rss: "https://tuoitre.vn/rss/sach.rss" }
];

const NEWS_SOURCES = {
  "Thế giới": [
    "https://vnexpress.net/rss/the-gioi.rss",
    "https://feeds.bbci.co.uk/news/world/rss.xml"
  ],
  "Công nghệ": [
    "https://vnexpress.net/rss/so-hoa.rss",
    "https://www.cnet.com/rss/news/"
  ],
  "Kinh tế": [
    "https://vnexpress.net/rss/kinh-doanh.rss"
  ]
};

// --------------------------------------
// MCP SERVER INIT
// --------------------------------------
const server = new McpServer({
  name: "viet-story-mcp",
  version: "1.5"
});

function makeResult(content) {
  return {
    content: [{ type: "text", text: JSON.stringify(content, null, 2) }],
    structuredContent: content
  };
}

// --------------------------------------
// UTIL: Extract text
// --------------------------------------
function extractText(item) {
  const html =
    item["content:encoded"] ||
    item.content ||
    item.summary ||
    item.description ||
    "";
  return stripHtml(html);
}

// --------------------------------------
// TOOL: TRUYỆN VIỆT
// --------------------------------------
server.registerTool(
  "get_vietnamese_stories",
  {
    title: "Kể chuyện Việt Nam",
    description: "Lấy truyện VN, làm sạch, chia đoạn.",
    inputSchema: { topic: z.string().optional(), maxItems: z.number().optional() },
    outputSchema: {}
  },
  async ({ topic, maxItems = 8 }) => {
    const out = [];
    const errors = [];
    const keySet = new Set();
    const topicLower = topic ? topic.toLowerCase() : null;

    const tasks = STORY_SOURCES.map((src) => async () => {
      try {
        const feed = await parseFeedUrl(src.rss);
        for (const item of feed.items.slice(0, 10)) {
          const title = (item.title || "").trim();
          const link = (item.link || "").trim();
          const text = extractText(item);
          if (!title || !link || !text) continue;

          if (topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)) continue;

          const key = src.id + "::" + title.toLowerCase();
          if (keySet.has(key)) continue;
          keySet.add(key);

          out.push({
            title,
            link,
            source: src.name,
            description: text.slice(0, 150) + "...",
            content: splitToParts(text)
          });

          if (out.length >= maxItems) break;
        }
      } catch (e) {
        errors.push({ src: src.rss, error: String(e) });
      }
    });

    await Promise.all(tasks.map((t) => queue.enqueue(t)));

    return makeResult({
      success: true,
      message: "Đã lấy truyện Việt Nam",
      stories: out,
      errors: errors.length ? errors : undefined
    });
  }
);

// --------------------------------------
// TOOL: SÁCH VN
// --------------------------------------
server.registerTool(
  "get_vietnamese_ebooks",
  {
    title: "Sách Việt Nam",
    description: "Lấy sách/trích đoạn sách từ báo VN.",
    inputSchema: { topic: z.string().optional(), maxItems: z.number().optional() },
    outputSchema: {}
  },
  async ({ topic, maxItems = 8 }) => {
    const out = [];
    const errors = [];
    const topicLower = topic ? topic.toLowerCase() : null;
    const seen = new Set();

    const tasks = BOOK_SOURCES.map((src) => async () => {
      try {
        const feed = await parseFeedUrl(src.rss);
        for (const item of feed.items.slice(0, 10)) {
          const title = (item.title || "").trim();
          const link = (item.link || "").trim();
          const text = extractText(item);
          if (!title || !link || !text) continue;

          if (topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)) continue;

          const key = src.id + "::" + title.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          out.push({
            title,
            link,
            source: src.name,
            summary: text.slice(0, 200) + "...",
            content: splitToParts(text)
          });

          if (out.length >= maxItems) break;
        }
      } catch (e) {
        errors.push({ src: src.rss, error: String(e) });
      }
    });

    await Promise.all(tasks.map((t) => queue.enqueue(t)));

    return makeResult({
      success: true,
      message: "Đã lấy sách VN",
      books: out,
      errors: errors.length ? errors : undefined
    });
  }
);

// --------------------------------------
// TOOL: TIN TỨC QUỐC TẾ (DỊCH)
// --------------------------------------
server.registerTool(
  "get_world_news",
  {
    title: "Tin tức quốc tế",
    description: "Lấy tin tức quốc tế + dịch tiếng Việt.",
    inputSchema: { topic: z.string(), maxItems: z.number().optional() },
    outputSchema: {}
  },
  async ({ topic, maxItems = 10 }) => {
    if (!NEWS_SOURCES[topic]) {
      return makeResult({
        success: false,
        message: "Chủ đề không hợp lệ",
        availableTopics: Object.keys(NEWS_SOURCES)
      });
    }

    const urls = NEWS_SOURCES[topic];
    const out = [];
    const errors = [];

    const tasks = urls.map((rssUrl) => async () => {
      try {
        const feed = await parseFeedUrl(rssUrl);

        for (const item of feed.items.slice(0, 8)) {
          const title = (item.title || "").trim();
          const link = item.link || "";
          const text = extractText(item);
          if (!title || !text) continue;

          let titleVi = title;
          let contentVi = text;

          try {
            const translated = await Promise.all([
              translate(title, { to: "vi" }).catch(() => ({ text: title })),
              translate(text, { to: "vi" }).catch(() => ({ text }))
            ]);

            titleVi = translated[0].text;
            contentVi = translated[1].text;
          } catch {}

          out.push({
            title,
            titleVi,
            link,
            source: link.split("/")[2] || "unknown",
            contentVi
          });

          if (out.length >= maxItems) break;
        }
      } catch (e) {
        errors.push({ src: rssUrl, error: String(e) });
      }
    });

    await Promise.all(tasks.map((t) => queue.enqueue(t)));

    return makeResult({
      success: true,
      topic,
      articles: out,
      errors: errors.length ? errors : undefined
    });
  }
);

// --------------------------------------
// HTTP MCP SERVER
// --------------------------------------
const app = express();
app.use(express.json());

app.get("/", (req, res) =>
  res.send("viet-story-mcp 1.5 running. POST → /mcp")
);

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true
  });

  res.on("close", () => transport.close());

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  log(`viet-story-mcp running at http://localhost:${PORT}/mcp`);
});
