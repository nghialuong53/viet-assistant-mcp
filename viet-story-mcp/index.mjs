// index.mjs
// Viet-story-mcp (improved)
// - cache đơn giản
// - timeout khi fetch RSS
// - concurrency control (limit đồng thời)
// - logging rõ ràng
// - output chuẩn cho robot AI
// Dựa trên file gốc anh gửi trước đó. (đã cải tiến). :contentReference[oaicite:2]{index=2}

import express from "express";
import Parser from "rss-parser";
import translate from "@vitalets/google-translate-api";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ---------- Config via env ----------
const PORT = process.env.PORT || 3000;
const USER_AGENT = process.env.USER_AGENT || "Viet-Story-MCP/1.4 (+https://anhrobot.vn)";
const FEED_TIMEOUT_MS = parseInt(process.env.FEED_TIMEOUT_MS || "8000", 10); // timeout cho RSS fetch
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || "120000", 10); // 2 phút default
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || "4", 10);

// ---------- Simple in-memory cache ----------
const cache = new Map(); // key -> { ts, value }
function setCache(key, value) {
  cache.set(key, { ts: Date.now(), value });
}
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

// ---------- Utility ----------
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function stripHtml(html = "") {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function splitToParts(text = "", maxLen = 800) {
  if (!text) return [];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts.filter((p) => p.trim().length > 0);
}

// RSS parser (we'll parse string responses to add timeout)
const parser = new Parser({
  headers: { "User-Agent": USER_AGENT }
});

// fetch with timeout
async function fetchWithTimeout(url, timeoutMs = FEED_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// parse RSS safely (with cache)
async function parseFeedUrl(url) {
  const cached = getCache(url);
  if (cached) return cached;
  try {
    const raw = await fetchWithTimeout(url);
    const feed = await parser.parseString(raw);
    setCache(url, feed);
    return feed;
  } catch (err) {
    throw err;
  }
}

// concurrency queue (simple)
function createQueue(maxConcurrency = MAX_CONCURRENCY) {
  let running = 0;
  const queue = [];
  function runNext() {
    if (running >= maxConcurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    running++;
    fn()
      .then((r) => {
        running--;
        resolve(r);
        runNext();
      })
      .catch((e) => {
        running--;
        reject(e);
        runNext();
      });
  }
  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
  }
  return { enqueue };
}

const queue = createQueue(MAX_CONCURRENCY);

// ---------- Sources (sửa/sắp xếp) ----------
const STORY_SOURCES = [
  { id: "vnexpress_giaitri", name: "VnExpress Giải trí", rss: "https://vnexpress.net/rss/giai-tri.rss" },
  { id: "zing_vanhoa", name: "Zing Văn hóa", rss: "https://zingnews.vn/rss/van-hoa.rss" },
  { id: "dantri_vanhoa", name: "Dân Trí Văn hóa", rss: "https://dantri.com.vn/rss/van-hoa.rss" },
  { id: "tuoitre_vanhoa", name: "Tuổi Trẻ Văn hóa", rss: "https://tuoitre.vn/rss/van-hoa.rss" }
];

const BOOK_SOURCES = [
  { id: "zing_xuatban", name: "Zing Xuất bản", rss: "https://zingnews.vn/rss/xuat-ban.rss" },
  { id: "vnexpress_vanhoa", name: "VnExpress Văn hóa", rss: "https://vnexpress.net/rss/van-hoa.rss" },
  { id: "tuoitre_sach", name: "Tuổi Trẻ Sách", rss: "https://tuoitre.vn/rss/sach.rss" }
];

const NEWS_SOURCES = {
  "Thế giới": [
    "https://vnexpress.net/rss/the-gioi.rss",
    "https://feeds.bbci.co.uk/news/world/rss.xml"
  ],
  "Kinh tế": [
    "https://vnexpress.net/rss/kinh-doanh.rss",
    "https://www.reutersagency.com/feed/?best-topics=business"
  ],
  "Công nghệ": [
    "https://vnexpress.net/rss/so-hoa.rss",
    "https://www.cnet.com/rss/news/"
  ],
  "Văn hóa": [
    "https://vnexpress.net/rss/giai-tri.rss"
  ],
  "Khoa học": [
    "https://vnexpress.net/rss/khoa-hoc.rss",
    "https://www.sciencedaily.com/rss/top.xml"
  ]
};

// ---------- MCP server ----------
const server = new McpServer({
  name: "viet-story-mcp",
  version: "1.4.0"
});

function makeResult(output) {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

// ---------- Helper: extract text from item ----------
function extractTextFromItem(item) {
  const raw =
    item["content:encoded"] ||
    item.content ||
    item.contentSnippet ||
    item.summary ||
    item.description ||
    "";
  return stripHtml(raw || "");
}

// ---------- TOOL: get_vietnamese_stories ----------
server.registerTool(
  "get_vietnamese_stories",
  {
    title: "Kể chuyện Việt Nam",
    description: "Lấy truyện/trang giải trí từ báo VN, nội dung sạch, chia đoạn, trả về arrays cho robot đọc từng phần.",
    inputSchema: {
      topic: z.string().optional().describe("Chủ đề (ví dụ: 'cổ tích', 'thiếu nhi'). Để trống lấy ngẫu nhiên."),
      maxItems: z.number().optional().describe("Số lượng mục tối đa trả về (mặc định 8).")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      stories: z.array(
        z.object({
          title: z.string(),
          description: z.string().optional(),
          link: z.string(),
          sourceId: z.string().optional(),
          sourceName: z.string().optional(),
          content: z.array(z.string()).optional()
        })
      ).optional(),
      errors: z.array(z.object({ sourceId: z.string(), rss: z.string(), error: z.string() })).optional()
    }
  },
  async ({ topic, maxItems = 8 }) => {
    const results = [];
    const errors = [];
    const seen = new Set();
    const topicLower = topic ? topic.toLowerCase() : null;

    // xử lý tuần tự qua queue để tránh spawn quá nhiều request cùng lúc
    const tasks = STORY_SOURCES.map((src) => async () => {
      try {
        const feed = await parseFeedUrl(src.rss);
        const items = feed.items || [];
        for (const item of items.slice(0, 8)) {
          const title = (item.title || "Không tiêu đề").trim();
          const link = (item.link || "").trim();
          const text = extractTextFromItem(item);
          if (!title || !link || !text) continue;
          if (topicLower && !title.toLowerCase().includes(topicLower) && !text.toLowerCase().includes(topicLower)) continue;
          const key = `${src.id}::${title.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            title,
            description: text.length > 160 ? text.slice(0, 160).trim() + "..." : text,
            link,
            sourceId: src.id,
            sourceName: src.name,
            content: splitToParts(text, 900)
          });
          if (results.length >= maxItems) break;
        }
      } catch (e) {
        log("Error story source", src.rss, e.message || e);
        errors.push({ sourceId: src.id, rss: src.rss, error: String(e.message || e) });
      }
    });

    // enqueue tasks with concurrency control
    await Promise.all(tasks.map((t) => queue.enqueue(t)));

    if (results.length === 0) {
      return makeResult({
        success: false,
        message: errors.length ? "Không lấy được truyện từ một vài nguồn." : "Không tìm thấy truyện.",
        stories: [],
        errors: errors.length ? errors : undefined
      });
    }

    return makeResult({
      success: true,
      message: "Đã lấy truyện Việt Nam (làm sạch & chia đoạn).",
      stories: results,
      errors: errors.length ? errors : undefined
    });
  }
);

// ---------- TOOL: get_vietnamese_ebooks ----------
server.registerTool(
  "get_vietnamese_ebooks",
  {
    title: "Truyện & sách VN (chuyên mục sách)",
    description: "Lấy bài giới thiệu sách/trích đoạn từ chuyên mục sách báo VN, làm sạch HTML, chia đoạn.",
    inputSchema: {
      topic: z.string().optional().describe("Chủ đề sách: 'thiếu nhi', 'kinh doanh', ..."),
      maxItems: z.number().optional().describe("Số kết quả tối đa (mặc định 8).")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      books: z.array(z.object({
        title: z.string(),
        description: z.string().optional(),
        link: z.string(),
        sourceId: z.string().optional(),
        sourceName: z.string().optional(),
        content: z.array(z.string()).optional()
      })).optional(),
      errors: z.array(z.object({ sourceId: z.string(), rss: z.string(), error: z.string() })).optional()
    }
  },
  async ({ topic, maxItems = 8 }) => {
    const results = [];
    const errors = [];
    const seen = new Set();
    const topicLower = topic ? topic.toLowerCase() : null;

    const tasks = BOOK_SOURCES.map((src) => async () => {
      try {
        const feed = await parseFeedUrl(src.rss);
        const items = feed.items || [];
        for (const item of items.slice(0, 8)) {
          const title = (item.title || "Không tiêu đề").trim();
          const link = (item.link || "").trim();
          const text = extractTextFromItem(item);
          if (!title || !link || !text) continue;
          if (topicLower && !title.toLowerCase().includes(topicLower) && !text.toLowerCase().includes(topicLower)) continue;
          const key = `${src.id}::${title.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            title,
            description: text.length > 200 ? text.slice(0, 200).trim() + "..." : text,
            link,
            sourceId: src.id,
            sourceName: src.name,
            content: splitToParts(text, 900)
          });
          if (results.length >= maxItems) break;
        }
      } catch (e) {
        log("Error books source", src.rss, e.message || e);
        errors.push({ sourceId: src.id, rss: src.rss, error: String(e.message || e) });
      }
    });

    await Promise.all(tasks.map((t) => queue.enqueue(t)));

    if (results.length === 0) {
      return makeResult({
        success: false,
        message: errors.length ? "Không lấy được bài sách từ một vài nguồn." : "Không tìm thấy bài sách.",
        books: [],
        errors: errors.length ? errors : undefined
      });
    }

    return makeResult({
      success: true,
      message: "Đã lấy bài sách / trích đoạn (làm sạch & chia đoạn).",
      books: results,
      errors: errors.length ? errors : undefined
    });
  }
);

// ---------- TOOL: get_world_news ----------
server.registerTool(
  "get_world_news",
  {
    title: "Tin tức quốc tế (dịch sang tiếng Việt)",
    description: "Lấy tin theo chủ đề từ nguồn quốc tế/VN, dịch (title + content) sang tiếng Việt.",
    inputSchema: {
      topic: z.string().optional().describe("Chủ đề: 'Thế giới', 'Kinh tế', 'Công nghệ', ..."),
      maxItems: z.number().optional().describe("Số bài tối đa (mặc định 12).")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      topic: z.string().optional(),
      articles: z.array(z.object({
        title: z.string(),
        titleVi: z.string().optional(),
        link: z.string().optional(),
        source: z.string().optional(),
        summaryVi: z.string().optional(),
        contentVi: z.string().optional()
      })).optional(),
      errors: z.array(z.object({ source: z.string(), rss: z.string(), error: z.string() })).optional()
    }
  },
  async ({ topic, maxItems = 12 }) => {
    if (!topic) {
      return makeResult({
        success: true,
        message: "Danh sách chủ đề sẵn có.",
        structuredContent: { availableTopics: Object.keys(NEWS_SOURCES) }
      });
    }
    const feeds = NEWS_SOURCES[topic];
    if (!feeds) {
      return makeResult({
        success: false,
        message: "Chủ đề không hợp lệ. Hãy dùng: " + Object.keys(NEWS_SOURCES).join(", "),
        topic,
        articles: []
      });
    }

    const results = [];
    const errors = [];

    const feedTasks = feeds.map((url) => async () => {
      try {
        const feed = await parseFeedUrl(url);
        const items = feed.items || [];
        for (const item of items.slice(0, 6)) {
          const title = (item.title || "").trim();
          const link = (item.link || "").trim();
          const text = extractTextFromItem(item);
          if (!title || !text) continue;

          let titleVi = title;
          let contentVi = text;
          let summaryVi = text.length > 300 ? text.slice(0, 300).trim() + "..." : text;

          try {
            const [t1, t2] = await Promise.all([
              translate(title, { to: "vi" }).catch((e) => ({ text: title })),
              translate(text, { to: "vi" }).catch((e) => ({ text }))
            ]);
            titleVi = t1.text || title;
            contentVi = t2.text || text;
            summaryVi = contentVi.length > 300 ? contentVi.slice(0, 300).trim() + "..." : contentVi;
          } catch (e) {
            log("Translate error", e.message || e);
          }

          results.push({
            title,
            titleVi,
            link,
            source: link ? link.split("/")[2] : "unknown",
            summaryVi,
            contentVi
          });

          if (results.length >= maxItems) break;
        }
      } catch (e) {
        log("Error news source", url, e.message || e);
        errors.push({ source: url.split("/")[2] || "unknown", rss: url, error: String(e.message || e) });
      }
    });

    await Promise.all(feedTasks.map((t) => queue.enqueue(t)));

    if (results.length === 0) {
      return makeResult({
        success: false,
        message: "Không lấy được tin tức cho chủ đề này (có thể bị chặn/timeout).",
        topic,
        articles: [],
        errors: errors.length ? errors : undefined
      });
    }

    return makeResult({
      success: true,
      message: `Đã lấy tin tức cho chủ đề ${topic}.`,
      topic,
      articles: results,
      errors: errors.length ? errors : undefined
    });
  }
);

// ---------- HTTP (MCP transport) ----------
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("viet-story-mcp (improved) running. POST /mcp for MCP clients."));

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  log(`viet-story-mcp (improved) running at http://localhost:${PORT}/mcp`);
});
