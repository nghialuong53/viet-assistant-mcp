// index.mjs
// MCP server: 1) Tin tức Việt Nam & thế giới  2) Kể truyện tiếng Việt

import express from "express";
import Parser from "rss-parser";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ----------------------
// TẠO MCP SERVER
// ----------------------
const server = new McpServer({
  name: "vn-news-story-mcp",
  version: "1.0.0"
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
  headers: { "User-Agent": "VN-News-Story-MCP" }
});

// ----------------------
// TIỆN ÍCH: LÀM SẠCH HTML + CHIA ĐOẠN
// ----------------------

// Bỏ HTML, chỉ giữ text sạch
function stripHtml(html = "") {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Chia text thành các đoạn ~maxLen ký tự, cố gắng cắt theo câu, bỏ đoạn rỗng
function splitToParts(text, maxLen = 800) {
  if (!text) return [];
  const parts = [];
  let remaining = text.trim();

  while (remaining.length > maxLen) {
    let slice = remaining.slice(0, maxLen);

    // Cắt ở dấu . ! ? hoặc xuống dòng gần cuối, nếu không có thì cắt cứng
    let cutIndex = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf("\n")
    );
    if (cutIndex < maxLen * 0.4) {
      cutIndex = maxLen;
    }

    const part = remaining.slice(0, cutIndex).trim();
    if (part.length > 0) parts.push(part);

    remaining = remaining.slice(cutIndex).trim();
  }

  if (remaining.length > 0) parts.push(remaining);

  return parts.filter((p) => p.trim().length > 0);
}

/* =================================================
 * 1) TRUYỆN TIẾNG VIỆT – get_vietnamese_stories
 * ================================================= */

// Các nguồn văn hóa / giải trí lâu năm
const STORY_SOURCES = [
  "https://vnexpress.net/rss/giai-tri.rss",
  "https://zingnews.vn/rss/van-hoa.rss",
  "https://baomoi.com/rss/giai-tri.rss",
  "https://dantri.com.vn/rss/van-hoa.rss",
  "https://tuoitre.vn/rss/van-hoa.rss",
  "https://laodong.vn/rss/van-hoa-giai-tri.rss",
  "https://vov.vn/rss/van-hoa.rss"
];

server.registerTool(
  "get_vietnamese_stories",
  {
    title: "Kể truyện tiếng Việt",
    description:
      "Lấy truyện / bài viết văn hóa – giải trí tiếng Việt từ nhiều báo lớn. Làm sạch HTML, chia thành nhiều đoạn ~800 ký tự cho TTS đọc mượt.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề truyện, ví dụ: 'cổ tích', 'nhân quả', 'hài hước', 'tình cảm', 'gia đình'..."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      stories: z
        .array(
          z.object({
            title: z.string(),
            description: z.string().optional(), // mô tả ngắn
            link: z.string(),
            content: z.array(z.string()) // các phần truyện đã chia
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const topicLower = topic ? topic.toLowerCase() : null;
    const results = [];
    const seenKeys = new Set(); // chống trùng giữa các báo

    for (const url of STORY_SOURCES) {
      try {
        const feed = await rss.parseURL(url);
        const items = feed.items || [];

        // Không cần quá nhiều, lấy khoảng 3–5 bài / nguồn cho nhẹ
        for (const item of items.slice(0, 5)) {
          const title = (item.title || "").trim();
          const link = (item.link || "").trim();

          if (!title || !link) continue;

          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
            "";
          const text = stripHtml(raw);
          if (!text) continue;

          // Lọc theo topic trên title + nội dung ngắn
          if (
            topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)
          ) {
            continue;
          }

          // chống trùng: key theo link + title
          const key =
            link.toLowerCase() +
            "::" +
            title.toLowerCase().slice(0, 80);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const parts = splitToParts(text, 800);
          if (!parts.length) continue;

          const desc =
            text.length > 200 ? text.slice(0, 200).trim() + "..." : text;

          results.push({
            title,
            description: desc,
            link,
            content: parts
          });
        }
      } catch (err) {
        // 1 nguồn lỗi thì log rồi bỏ qua, không làm rớt cả tool
        console.error("Lỗi đọc RSS truyện từ", url, ":", err.message);
      }
    }

    if (!results.length) {
      return makeResult({
        success: false,
        message:
          "Không tìm thấy truyện phù hợp với chủ đề hiện tại. Hãy thử chủ đề khác, ví dụ: 'cổ tích', 'hài hước', 'nhân quả', 'tình cảm'...",
        stories: []
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy danh sách truyện tiếng Việt. Mỗi truyện đã được làm sạch HTML và chia thành nhiều phần ~800 ký tự.",
      stories: results
    });
  }
);

/* =================================================
 * 2) TIN TỨC VIỆT NAM & THẾ GIỚI – get_news
 * ================================================= */

// Các nguồn tin tức chính thống VN + BBC
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
    id: "laodong",
    name: "Lao Động",
    rss: "https://laodong.vn/rss/home.rss"
  },
  {
    id: "vov",
    name: "VOV",
    rss: "https://vov.vn/rss/home.rss"
  },
  {
    id: "bbc_world",
    name: "BBC News - World",
    rss: "https://feeds.bbci.co.uk/news/world/rss.xml"
  }
];

const NEWS_SOURCE_IDS = NEWS_SOURCES.map((s) => s.id);

// Tool đọc / liệt kê tin tức
server.registerTool(
  "get_news",
  {
    title: "Tin tức Việt Nam & thế giới",
    description:
      "Lấy tin tức Việt Nam & BBC theo chủ đề. Có 2 mode: 'list' (danh sách tiêu đề 1,2,3,4...) và 'article' (đọc nội dung 1 bài, chia đoạn ~800 ký tự). Sử dụng rss-parser, không crawl HTML.",
    inputSchema: {
      mode: z
        .enum(["list", "article"])
        .default("list")
        .describe(
          "Mode: 'list' = lấy danh sách tiêu đề; 'article' = đọc nội dung 1 bài."
        ),
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề tin tức, ví dụ: 'chính trị', 'bóng đá', 'công nghệ', 'kinh tế', 'sức khỏe', 'tin thế giới'..."
        ),
      url: z
        .string()
        .url()
        .optional()
        .describe(
          "Link bài báo cần đọc nội dung (dùng cho mode='article', nên lấy từ kết quả mode='list')."
        ),
      sourceId: z
        .enum(NEWS_SOURCE_IDS)
        .optional()
        .describe(
          "Mã nguồn báo, ví dụ: 'vnexpress', 'tuoitre'... (dùng cho mode='article' để tìm nhanh và ổn định hơn)."
        ),
      sources: z
        .array(z.enum(NEWS_SOURCE_IDS))
        .optional()
        .describe(
          "Danh sách nguồn báo muốn dùng. Bỏ trống = dùng tất cả nguồn."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(10)
        .describe("Số lượng bài tối đa khi lấy danh sách (list).")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      // Mode = list
      articles: z
        .array(
          z.object({
            id: z.number(), // số thứ tự 1,2,3,4,... để robot đọc
            sourceId: z.string(),
            sourceName: z.string(),
            title: z.string(),
            summary: z.string().optional(), // nội dung ngắn đã làm sạch
            link: z.string(),
            publishedAt: z.string().optional()
          })
        )
        .optional(),
      // Mode = article
      article: z
        .object({
          sourceId: z.string(),
          sourceName: z.string(),
          title: z.string(),
          link: z.string(),
          contentParts: z.array(z.string()) // các đoạn ~800 ký tự, text sạch
        })
        .optional()
    }
  },
  async ({ mode, topic, url, sourceId, sources, limit }) => {
    // --------------------
    // MODE = "article": đọc nội dung 1 bài từ RSS
    // --------------------
    if (mode === "article") {
      if (!url) {
        return makeResult({
          success: false,
          message:
            "Mode = 'article' nhưng không có 'url' bài báo. Hãy truyền đúng link lấy từ kết quả 'list'."
        });
      }

      const targetUrl = url.trim();
      let src = null;

      // Ưu tiên sourceId nếu có
      if (sourceId) {
        src = NEWS_SOURCES.find((s) => s.id === sourceId) || null;
      }

      // Nếu chưa có, đoán nguồn theo hostname của URL
      if (!src) {
        try {
          const host = new URL(targetUrl).hostname.replace(/^www\./, "");
          src =
            NEWS_SOURCES.find((s) => {
              const feedHost = new URL(s.rss).hostname.replace(/^www\./, "");
              return feedHost === host;
            }) || null;
        } catch {
          // URL lỗi thì sẽ thử tất cả nguồn
        }
      }

      const sourcesToTry = src ? [src] : NEWS_SOURCES;

      let foundItem = null;
      let usedSource = null;

      for (const s of sourcesToTry) {
        try {
          const feed = await rss.parseURL(s.rss);
          const items = feed.items || [];
          const item = items.find((it) => {
            const link = (it.link || "").trim();
            if (!link) return false;
            return (
              targetUrl === link ||
              targetUrl.startsWith(link) ||
              link.startsWith(targetUrl)
            );
          });

          if (item) {
            foundItem = item;
            usedSource = s;
            break;
          }
        } catch (err) {
          console.error("Lỗi đọc RSS bài báo từ", s.rss, ":", err.message);
          // bỏ qua nguồn lỗi, thử nguồn khác
        }
      }

      if (!foundItem) {
        return makeResult({
          success: false,
          message:
            "Không tìm thấy bài báo này trong RSS của các nguồn đã cấu hình. Hãy chắc chắn dùng link lấy từ mode='list'."
        });
      }

      const raw =
        foundItem["content:encoded"] ||
        foundItem.content ||
        foundItem.contentSnippet ||
        "";
      let text = stripHtml(raw);

      // Nếu RSS không có nội dung dài thì dùng title + snippet
      if (!text || text.length < 50) {
        text = stripHtml(
          (foundItem.title || "") +
            ". " +
            (foundItem.contentSnippet || foundItem.summary || "")
        );
      }

      const contentParts = splitToParts(text, 800);
      if (!contentParts.length) {
        return makeResult({
          success: false,
          message:
            "Không trích xuất được nội dung văn bản đủ để đọc từ RSS bài báo này."
        });
      }

      const title = (foundItem.title || targetUrl).trim();

      return makeResult({
        success: true,
        message:
          "Đã lấy nội dung bài báo từ RSS, làm sạch HTML và chia thành nhiều phần ~800 ký tự.",
        article: {
          sourceId: usedSource ? usedSource.id : "unknown",
          sourceName: usedSource ? usedSource.name : "Unknown Source",
          title,
          link: targetUrl,
          contentParts
        }
      });
    }

    // --------------------
    // MODE = "list": lấy danh sách tiêu đề tin tức
    // --------------------
    const topicLower = topic ? topic.toLowerCase() : null;

    const selectedSources =
      sources && sources.length
        ? NEWS_SOURCES.filter((s) => sources.includes(s.id))
        : NEWS_SOURCES;

    const articles = [];
    let nextId = 1;
    const seenKeys = new Set(); // chống trùng bài giữa các báo (theo link)

    for (const src of selectedSources) {
      try {
        const feed = await rss.parseURL(src.rss);
        const items = feed.items || [];

        for (const item of items) {
          if (articles.length >= limit) break;

          const title = (item.title || "").trim();
          const link = (item.link || "").trim();
          if (!title || !link) continue;

          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
            "";
          const text = stripHtml(raw);

          // Lọc theo topic trên title + nội dung ngắn
          if (
            topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)
          ) {
            continue;
          }

          const key = link.toLowerCase();
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

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
        console.error("Lỗi đọc RSS tin tức từ", src.rss, ":", err.message);
        // 1 báo lỗi thì bỏ qua, vẫn tiếp tục với các báo khác
      }

      if (articles.length >= limit) break;
    }

    if (!articles.length) {
      return makeResult({
        success: false,
        message:
          "Không tìm thấy bản tin phù hợp với chủ đề hiện tại. Hãy thử chủ đề khác, ví dụ: 'chính trị', 'bóng đá', 'công nghệ', 'kinh tế', 'sức khỏe', 'tin thế giới'...",
        articles: []
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy danh sách tin tức. Mỗi bài có id 1,2,3,... để robot đọc theo số thứ tự; kèm link + sourceId để đọc full bài bằng mode='article'.",
      articles
    });
  }
);

/* =================================================
 * KHỞI ĐỘNG MCP SERVER (HTTP + /mcp)
 * ================================================= */

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send(
    "VN News & Story MCP server is running. Use POST /mcp for MCP clients."
  );
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
  console.log(`VN News & Story MCP running at http://localhost:${port}/mcp`);
});
