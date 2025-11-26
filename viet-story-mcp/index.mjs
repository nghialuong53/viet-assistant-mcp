// index.mjs
// MCP server: 2 tiện ích
// 1) Kể chuyện Việt Nam từ báo lớn VN
// 2) Truyện / bài sách từ chuyên mục sách & kho sách điện tử VN

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
  version: "1.2.0"
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
  headers: { "User-Agent": "VN-Story-Book-MCP" }
});

// Hàm tiện ích: bỏ tag HTML, gom khoảng trắng
function stripHtml(html = "") {
  return html
    .replace(/<[^>]+>/g, " ") // bỏ tất cả thẻ <tag>
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
 * 1) TOOL KỂ CHUYỆN VIỆT NAM
 * ================================================= */

// Nguồn truyện Việt Nam: giải trí / văn hóa các báo lớn (server ổn định)
const STORY_SOURCES = [
  {
    id: "vnexpress_giaitri",
    name: "VnExpress Giải trí",
    rss: "https://vnexpress.net/rss/giai-tri.rss"
  },
  {
    id: "zing_vanhoa",
    name: "Zing Văn hóa",
    rss: "https://zingnews.vn/rss/van-hoa.rss"
  },
  {
    id: "baomoi_giaitri",
    name: "Báo Mới Giải trí",
    rss: "https://baomoi.com/rss/giai-tri.rss"
  },
  {
    id: "dantri_vanhoa",
    name: "Dân Trí Văn hóa",
    rss: "https://dantri.com.vn/rss/van-hoa.rss"
  },
  {
    id: "tuoitre_vanhoa",
    name: "Tuổi Trẻ Văn hóa",
    rss: "https://tuoitre.vn/rss/van-hoa.rss"
  }
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
          "Chủ đề muốn nghe (ví dụ: cổ tích, hài hước, tình cảm, nhân quả...). Để trống nếu muốn lấy ngẫu nhiên."
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
            sourceId: z.string().optional(),
            sourceName: z.string().optional(),
            content: z.array(z.string()).optional()
          })
        )
        .optional(),
      errors: z
        .array(
          z.object({
            sourceId: z.string(),
            sourceName: z.string(),
            rss: z.string(),
            error: z.string()
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const results = [];
    const topicLower = topic ? topic.toLowerCase() : null;
    const seenTitles = new Set();
    const errors = [];

    for (const src of STORY_SOURCES) {
      try {
        const feed = await rss.parseURL(src.rss);
        const items = feed.items || [];

        for (const item of items.slice(0, 5)) {
          const title = (item.title || "Không có tiêu đề").trim();
          const link = (item.link || "").trim();

          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
            item.summary ||
            item.description ||
            "";

          const text = stripHtml(raw);
          if (!title || !link || !text) continue;

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
            sourceId: src.id,
            sourceName: src.name,
            content: parts
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS (story) từ", src.rss, ":", err.message);
        errors.push({
          sourceId: src.id,
          sourceName: src.name,
          rss: src.rss,
          error: String(err.message || err)
        });
      }
    }

    if (results.length === 0) {
      // phân biệt 2 trường hợp cho robot nói đúng
      let message;
      if (errors.length === STORY_SOURCES.length) {
        message =
          "Không truy cập được bất kỳ nguồn truyện nào (có thể do server bị chặn mạng hoặc lỗi tạm thời). Thử lại sau vài phút.";
      } else if (topicLower) {
        message =
          "Không tìm thấy truyện nào khớp với chủ đề bạn yêu cầu. Hãy thử từ khóa đơn giản hơn (ví dụ: 'cổ tích', 'hài hước', 'thiếu nhi').";
      } else {
        message =
          "Không tìm thấy truyện nào từ các nguồn hiện tại. Có thể các báo đang tạm lỗi RSS hoặc thay đổi cấu trúc.";
      }

      return makeResult({
        success: false,
        message,
        stories: [],
        errors: errors.length ? errors : undefined
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy danh sách truyện Việt Nam. Nội dung đã được làm sạch HTML và chia thành nhiều phần để robot đọc.",
      stories: results,
      errors: errors.length ? errors : undefined
    });
  }
);

/* =================================================
 * 2) TOOL TRUYỆN / SÁCH TỪ CHUYÊN MỤC SÁCH & KHO SÁCH VN
 * ================================================= */

const BOOK_SOURCES = [
  {
    id: "zing_xuatban",
    name: "Zing Xuất bản",
    rss: "https://zingnews.vn/rss/xuat-ban.rss"
  },
  {
    id: "vnexpress_vanhoa",
    name: "VnExpress Văn hóa",
    rss: "https://vnexpress.net/rss/van-hoa.rss"
  },
  {
    id: "dantri_vanhoa",
    name: "Dân Trí Văn hóa",
    rss: "https://dantri.com.vn/rss/van-hoa.rss"
  },
  {
    id: "tuoitre_sach",
    name: "Tuổi Trẻ Sách (văn hóa đọc)",
    rss: "https://tuoitre.vn/rss/sach.rss"
  }
];

server.registerTool(
  "get_vietnamese_ebooks",
  {
    title: "Truyện & sách từ kho sách điện tử Việt Nam",
    description:
      "Lấy bài viết giới thiệu sách, trích đoạn truyện, nội dung về văn hóa đọc từ các chuyên mục sách/ xuất bản của báo Việt Nam. Text sạch, chia thành các đoạn ~800 ký tự.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề sách / truyện (ví dụ: thiếu nhi, kỹ năng sống, kinh doanh, lịch sử, tình cảm...). Dùng tiếng Việt."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      books: z
        .array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            link: z.string(),
            sourceId: z.string().optional(),
            sourceName: z.string().optional(),
            content: z.array(z.string()).optional()
          })
        )
        .optional(),
      errors: z
        .array(
          z.object({
            sourceId: z.string(),
            sourceName: z.string(),
            rss: z.string(),
            error: z.string()
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const topicLower = topic ? topic.toLowerCase() : null;
    const results = [];
    const seenTitles = new Set();
    const errors = [];

    for (const src of BOOK_SOURCES) {
      try {
        const feed = await rss.parseURL(src.rss);
        const items = feed.items || [];

        for (const item of items.slice(0, 5)) {
          const title = (item.title || "Không có tiêu đề").trim();
          const link = (item.link || "").trim();

          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
            item.summary ||
            item.description ||
            "";

          const text = stripHtml(raw);
          if (!title || !link || !text) continue;

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
            text.length > 200 ? text.slice(0, 200).trim() + "..." : text;

          results.push({
            title,
            description: shortDesc,
            link,
            sourceId: src.id,
            sourceName: src.name,
            content: parts
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS (ebook) từ", src.rss, ":", err.message);
        errors.push({
          sourceId: src.id,
          sourceName: src.name,
          rss: src.rss,
          error: String(err.message || err)
        });
      }
    }

    if (results.length === 0) {
      let message;
      if (errors.length === BOOK_SOURCES.length) {
        message =
          "Không truy cập được bất kỳ nguồn sách nào (có thể do server bị chặn mạng hoặc lỗi tạm thời). Thử lại sau vài phút.";
      } else if (topicLower) {
        message =
          "Không tìm thấy bài nào khớp với chủ đề bạn yêu cầu. Hãy thử từ khóa khác (ví dụ: thiếu nhi, kỹ năng, kinh doanh).";
      } else {
        message =
          "Không tìm thấy bài sách / truyện nào từ các nguồn hiện tại. Có thể RSS đang thay đổi.";
      }

      return makeResult({
        success: false,
        message,
        books: [],
        errors: errors.length ? errors : undefined
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy danh sách truyện / bài sách Việt Nam. Nội dung sạch và đã chia nhiều phần để robot đọc.",
      books: results,
      errors: errors.length ? errors : undefined
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
    "Vietnam Story & Book MCP server is running. Use POST /mcp for MCP clients."
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
    `Vietnam Story & Book MCP running at http://localhost:${port}/mcp`
  );
});
