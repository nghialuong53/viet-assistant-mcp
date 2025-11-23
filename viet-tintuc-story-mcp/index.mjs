// index.mjs
// MCP server: 1) Kể chuyện Việt Nam  2) Tin tức Việt Nam & BBC theo chủ đề

import express from "express";
import Parser from "rss-parser";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ----------------------
// TẠO MCP SERVER
// ----------------------
const server = new McpServer({
  name: "viet-story-mcp",
  version: "1.1.0"
});

function makeResult(output) {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

// ----------------------
// RSS PARSER DÙNG CHUNG
// ----------------------
const rss = new Parser({
  headers: { "User-Agent": "VN-Story-News-MCP" }
});

// Hàm tiện ích: bỏ tag HTML, gom khoảng trắng
function stripHtml(html = "") {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Chia text thành các đoạn maxLen ký tự, bỏ đoạn rỗng
function splitToParts(text, maxLen = 800) {
  if (!text) return [];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts.filter((p) => p.trim().length > 0);
}

/* =================================================
 * 1) TOOL KỂ CHUYỆN VIỆT NAM (GIỮ NGUYÊN, ĐANG CHẠY TỐT)
 * ================================================= */

const STORY_SOURCES = [
  "https://vnexpress.net/rss/giai-tri.rss",
  "https://zingnews.vn/rss/van-hoa.rss",
  "https://baomoi.com/rss/giai-tri.rss",
  "https://dantri.com.vn/rss/van-hoa.rss",
  "https://tuoitre.vn/rss/van-hoa.rss"
];

server.registerTool(
  "get_vietnamese_stories",
  {
    title: "Kể chuyện Việt Nam",
    description:
      "Tự động lấy truyện ngắn, cổ tích hoặc truyện giải trí từ các trang báo Việt Nam. Nội dung được làm sạch HTML và chia thành nhiều phần nếu dài.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe("Chủ đề muốn nghe (ví dụ: cổ tích, hài hước, tình cảm, nhân quả...)")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      stories: z
        .array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            link: z.string(),
            content: z.array(z.string()).optional() // các phần của truyện (text sạch)
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const results = [];
    const topicLower = topic ? topic.toLowerCase() : null;
    const seenTitles = new Set();

    for (const url of STORY_SOURCES) {
      try {
        const feed = await rss.parseURL(url);
        const items = feed.items || [];

        for (const item of items.slice(0, 3)) {
          const title = (item.title || "Không có tiêu đề").trim();
          const link = (item.link || "").trim();

          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
            "";

          const text = stripHtml(raw);
          if (!text) continue;

          if (
            topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)
          ) {
            continue;
          }

          const normTitle = title.toLowerCase();
          if (seenTitles.has(normTitle)) continue;
          seenTitles.add(normTitle);

          const parts = splitToParts(text, 800);
          const shortDesc =
            text.length > 160 ? text.slice(0, 160).trim() + "..." : text;

          results.push({
            title,
            description: shortDesc,
            link,
            content: parts
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS (story) từ", url, ":", err.message);
      }
    }

    if (results.length === 0) {
      return makeResult({
        success: false,
        message:
          "Không tìm thấy truyện nào phù hợp. Hãy thử lại với chủ đề khác (ví dụ: cổ tích, hài hước, tình cảm...)"
      });
    }

    return makeResult({
      success: true,
      message:
        "Các truyện Việt Nam đã được tìm thấy. Mỗi truyện đã được làm sạch HTML và chia thành nhiều phần nếu dài.",
      stories: results
    });
  }
);

/* =================================================
 * 2) TOOL TIN TỨC VIỆT NAM + BBC THEO CHỦ ĐỀ
 * ================================================= */

// Các nguồn tin tức chính thống VN + BBC (RSS công khai)
const NEWS_SOURCES = [
  {
    id: "vnexpress",
    name: "VnExpress",
    rss: "https://vnexpress.net/rss/tin-moi-nhat.rss"
  },
  {
    id: "tuoitre",
    name: "Tuổi Trẻ",
    rss: "https://tuoitre.vn/rss/tin-moi-nhat.rss"
  },
  {
    id: "thanhnien",
    name: "Thanh Niên",
    rss: "https://thanhnien.vn/rss/home.rss"
  },
  {
    id: "dantri",
    name: "Dân Trí",
    rss: "https://dantri.com.vn/rss/home.rss"
  },
  {
    id: "vietnamnet",
    name: "Vietnamnet",
    rss: "https://vietnamnet.vn/rss/home.rss"
  },
  {
    id: "bbc_world",
    name: "BBC News - World",
    rss: "https://feeds.bbci.co.uk/news/world/rss.xml"
  }
];

const NEWS_SOURCE_IDS = NEWS_SOURCES.map((s) => s.id);

// Tool: get_news – vừa liệt kê tiêu đề, vừa đọc nội dung bài
server.registerTool(
  "get_news",
  {
    title: "Tin tức Việt Nam & BBC theo chủ đề",
    description:
      "Lấy danh sách tiêu đề tin tức theo chủ đề (chính trị, bóng đá, tin thế giới, kinh tế, công nghệ...). Có 2 chế độ: 'list' (trả về danh sách tiêu đề) và 'article' (đọc nội dung đầy đủ của 1 bài báo).",
    inputSchema: {
      mode: z
        .enum(["list", "article"])
        .default("list")
        .describe("Chế độ: 'list' = lấy danh sách tiêu đề; 'article' = đọc nội dung 1 bài."),
      topic: z
        .string()
        .optional()
        .describe("Chủ đề tin tức, ví dụ: 'chính trị', 'bóng đá', 'tin thế giới', 'kinh tế', 'công nghệ'... (dùng cho mode='list')."),
      url: z
        .string()
        .url()
        .optional()
        .describe("Đường link bài báo cần đọc đầy đủ (dùng cho mode='article')."),
      sources: z
        .array(z.enum(NEWS_SOURCE_IDS))
        .optional()
        .describe("Danh sách nguồn tin muốn lấy. Bỏ trống = dùng tất cả."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(10)
        .describe("Số lượng bài tối đa (cho mode='list').")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      // Kết quả cho mode = list
      articles: z
        .array(
          z.object({
            id: z.number(),
            sourceId: z.string(),
            sourceName: z.string(),
            title: z.string(),
            summary: z.string().optional(),
            link: z.string(),
            publishedAt: z.string().optional()
          })
        )
        .optional(),
      // Kết quả cho mode = article
      article: z
        .object({
          sourceId: z.string(),
          sourceName: z.string(),
          title: z.string(),
          link: z.string(),
          contentParts: z.array(z.string()) // nội dung chia nhỏ cho TTS đọc không bị đứng
        })
        .optional()
    }
  },
  async ({ mode, topic, url, sources, limit }) => {
    // --------------------
    // MODE = "article": đọc full 1 bài
    // --------------------
    if (mode === "article") {
      if (!url) {
        return makeResult({
          success: false,
          message: "Mode = 'article' nhưng không có 'url' bài báo."
        });
      }

      // Tìm nguồn theo url (nếu match domain), chỉ để điền tên cho đẹp
      let src = NEWS_SOURCES.find((s) => url.includes(new URL(s.rss).hostname));
      if (!src) {
        // nếu không đoán được, gán mặc định
        src = {
          id: "unknown",
          name: "Unknown Source"
        };
      }

      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const html = await res.text();

        // Lấy tất cả <p>...</p> rồi nối lại, bỏ tag
        const paragraphs = Array.from(
          html.matchAll(/<p[^>]*>(.*?)<\/p>/gis)
        ).map((m) => m[1]);

        let text = paragraphs.join("\n\n");
        text = stripHtml(text);

        if (!text || text.length < 100) {
          // fallback: strip hết html trong trang
          text = stripHtml(html);
        }

        const contentParts = splitToParts(text, 1000); // phần ~1000 ký tự cho robot đọc

        if (contentParts.length === 0) {
          return makeResult({
            success: false,
            message: "Không trích xuất được nội dung từ bài báo."
          });
        }

        // Tạm thời, lấy title từ <title> trong HTML (nếu cần thì client có thể override)
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const title = titleMatch ? stripHtml(titleMatch[1]) : url;

        return makeResult({
          success: true,
          message: "Đã lấy nội dung bài báo đầy đủ, chia nhiều phần để đọc.",
          article: {
            sourceId: src.id,
            sourceName: src.name,
            title,
            link: url,
            contentParts
          }
        });
      } catch (err) {
        console.error("Lỗi tải bài báo:", err.message);
        return makeResult({
          success: false,
          message: "Lỗi khi tải bài báo: " + err.message
        });
      }
    }

    // --------------------
    // MODE = "list": liệt kê tiêu đề theo chủ đề
    // --------------------
    const topicLower = topic ? topic.toLowerCase() : null;
    const selectedSources =
      sources && sources.length > 0
        ? NEWS_SOURCES.filter((s) => sources.includes(s.id))
        : NEWS_SOURCES;

    const articles = [];
    let nextId = 1;

    for (const src of selectedSources) {
      try {
        const feed = await rss.parseURL(src.rss);
        const items = feed.items || [];

        for (const item of items) {
          if (articles.length >= limit) break;

          const title = (item.title || "").trim();
          const link = (item.link || "").trim();
          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
            "";
          const text = stripHtml(raw);

          if (!title || !link) continue;

          if (
            topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)
          ) {
            continue;
          }

          const summary =
            text.length > 200 ? text.slice(0, 200).trim() + "..." : text;

          articles.push({
            id: nextId++,
            sourceId: src.id,
            sourceName: src.name,
            title,
            summary,
            link,
            publishedAt: item.pubDate || ""
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS (news) từ", src.rss, ":", err.message);
      }

      if (articles.length >= limit) break;
    }

    if (articles.length === 0) {
      return makeResult({
        success: false,
        message:
          "Không tìm thấy bản tin phù hợp với chủ đề. Hãy thử chủ đề khác (ví dụ: 'chính trị', 'bóng đá', 'tin thế giới', 'kinh tế', 'công nghệ'...)."
      });
    }

    return makeResult({
      success: true,
      message:
        "Danh sách tiêu đề tin tức theo chủ đề. Dùng field 'link' để đọc nội dung từng bài qua mode='article'.",
      articles
    });
  }
);

/* =================================================
 * KHỞI ĐỘNG MCP SERVER
 * ================================================= */

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Vietnam Story & News MCP server is running. Use POST /mcp for MCP clients.");
});

app.get("/mcp", (req, res) => {
  res.send("MCP endpoint active. Use POST /mcp.");
});

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true
  });

  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Vietnam Story & News MCP running at http://localhost:${port}/mcp`);
});
