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
  version: "1.2.0" // bump version cho dễ phân biệt
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
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ") // bỏ script
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ") // bỏ style
    .replace(/<[^>]+>/g, " ") // bỏ mọi thẻ HTML còn lại
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Chia text thành các đoạn maxLen ký tự, cố gắng cắt theo câu, bỏ đoạn rỗng
function splitToParts(text, maxLen = 800) {
  if (!text) return [];
  const parts = [];
  let remaining = text.trim();

  while (remaining.length > maxLen) {
    let slice = remaining.slice(0, maxLen);

    // Cố gắng cắt ở dấu chấm / xuống dòng gần cuối, hạn chế cắt giữa câu
    let cutIndex = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf("\n")
    );
    if (cutIndex < maxLen * 0.4) {
      // nếu không tìm được điểm cắt hợp lý thì cứ cắt cứng
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
 * 1) TOOL KỂ CHUYỆN VIỆT NAM
 * ================================================= */

// Thêm một số nguồn văn hóa / giải trí lâu năm, giữ nguyên các nguồn cũ
const STORY_SOURCES = [
  "https://vnexpress.net/rss/giai-tri.rss",
  "https://zingnews.vn/rss/van-hoa.rss",
  "https://baomoi.com/rss/giai-tri.rss",
  "https://dantri.com.vn/rss/van-hoa.rss",
  "https://tuoitre.vn/rss/van-hoa.rss",
  // thêm vài báo lâu năm (nếu RSS lỗi sẽ bị catch, không làm rớt tool)
  "https://laodong.vn/rss/van-hoa-giai-tri.rss",
  "https://vov.vn/rss/van-hoa.rss"
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
        .describe(
          "Chủ đề muốn nghe (ví dụ: cổ tích, hài hước, tình cảm, nhân quả...)"
        )
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

    // chống trùng truyện giữa các báo: key = link || title
    const seenStoryKeys = new Set();

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

          const key =
            (link && link.toLowerCase()) || title.toLowerCase() || text.slice(0, 80).toLowerCase();
          if (seenStoryKeys.has(key)) continue;
          seenStoryKeys.add(key);

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
        // bỏ qua nguồn lỗi, các nguồn khác vẫn chạy
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

// Tool: get_news – vừa liệt kê tiêu đề, vừa đọc nội dung bài
server.registerTool(
  "get_news",
  {
    title: "Tin tức Việt Nam & BBC theo chủ đề",
    description:
      "Lấy danh sách tiêu đề tin tức theo chủ đề (chính trị, bóng đá, tin thế giới, kinh tế, công nghệ...). Có 2 chế độ: 'list' (trả về danh sách tiêu đề) và 'article' (đọc nội dung ngắn gọn của 1 bài báo từ RSS).",
    inputSchema: {
      mode: z
        .enum(["list", "article"])
        .default("list")
        .describe(
          "Chế độ: 'list' = lấy danh sách tiêu đề; 'article' = đọc nội dung 1 bài (từ RSS, không dùng node-fetch)."
        ),
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề tin tức, ví dụ: 'chính trị', 'bóng đá', 'tin thế giới', 'kinh tế', 'công nghệ'... (dùng cho mode='list')."
        ),
      url: z
        .string()
        .url()
        .optional()
        .describe(
          "Đường link bài báo cần đọc (dùng cho mode='article', nên dùng link lấy từ mode='list')."
        ),
      sourceId: z
        .enum(NEWS_SOURCE_IDS)
        .optional()
        .describe(
          "Mã nguồn tin của bài báo (ví dụ: 'vnexpress', 'tuoitre'...). Nên truyền để tool tìm bài nhanh và ổn định hơn (dùng cho mode='article')."
        ),
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
  async ({ mode, topic, url, sources, limit, sourceId }) => {
    // --------------------
    // MODE = "article": đọc 1 bài từ RSS (không dùng node-fetch)
    // --------------------
    if (mode === "article") {
      if (!url) {
        return makeResult({
          success: false,
          message: "Mode = 'article' nhưng không có 'url' bài báo."
        });
      }

      const targetUrl = url.trim();
      let src = null;

      // Nếu client truyền sourceId thì ưu tiên dùng
      if (sourceId) {
        src = NEWS_SOURCES.find((s) => s.id === sourceId) || null;
      }

      // Nếu chưa có, đoán nguồn theo hostname trong URL
      if (!src) {
        try {
          const targetHost = new URL(targetUrl).hostname.replace(/^www\./, "");
          src =
            NEWS_SOURCES.find((s) => {
              const feedHost = new URL(s.rss).hostname.replace(/^www\./, "");
              return feedHost === targetHost;
            }) || null;
        } catch {
          // nếu URL không parse được thì bỏ qua, để dùng all sources
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
            // khớp tương đối để tránh khác nhau ?query string
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
          console.error("Lỗi đọc RSS (article) từ", s.rss, ":", err.message);
          // thử nguồn khác, không làm rớt cả tool
        }
      }

      if (!foundItem) {
        return makeResult({
          success: false,
          message:
            "Không tìm được nội dung bài này trong RSS của các nguồn đã cấu hình. Hãy chắc chắn dùng link được lấy từ mode='list'."
        });
      }

      const raw =
        foundItem["content:encoded"] ||
        foundItem.content ||
        foundItem.contentSnippet ||
        "";
      let text = stripHtml(raw);

      if (!text || text.length < 50) {
        // Nếu trong RSS không có nội dung đủ dài thì trả nội dung ngắn gọn
        text = stripHtml(
          (foundItem.title || "") +
            ". " +
            (foundItem.contentSnippet || foundItem.summary || "")
        );
      }

      const contentParts = splitToParts(text, 800); // ~800 ký tự / phần

      if (contentParts.length === 0) {
        return makeResult({
          success: false,
          message:
            "Không trích xuất được nội dung văn bản đủ để đọc từ RSS của bài báo."
        });
      }

      const title = (foundItem.title || targetUrl).trim();

      return makeResult({
        success: true,
        message:
          "Đã lấy nội dung bài báo từ RSS, làm sạch HTML và chia thành nhiều phần để đọc.",
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
    // MODE = "list": liệt kê tiêu đề theo chủ đề
    // --------------------
    const topicLower = topic ? topic.toLowerCase() : null;
    const selectedSources =
      sources && sources.length > 0
        ? NEWS_SOURCES.filter((s) => sources.includes(s.id))
        : NEWS_SOURCES;

    const articles = [];
    let nextId = 1;
    const seenArticleKeys = new Set(); // chống trùng bài giữa các báo (theo link)

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

          const key = link.toLowerCase();
          if (seenArticleKeys.has(key)) continue;
          seenArticleKeys.add(key);

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
        // bỏ qua nguồn lỗi, không làm rớt cả tool
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
        "Danh sách tiêu đề tin tức theo chủ đề. Dùng field 'link' (và 'sourceId') để đọc nội dung từng bài qua mode='article'.",
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
  res.send(
    "Vietnam Story & News MCP server is running. Use POST /mcp for MCP clients."
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
  console.log(
    `Vietnam Story & News MCP running at http://localhost:${port}/mcp`
  );
});
