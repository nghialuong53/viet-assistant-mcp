// index.mjs
// MCP server: 2 tiện ích
// 1) Kể chuyện Việt Nam (từ báo, mục giải trí / văn hóa)
// 2) Truyện / bài sách từ kho sách điện tử & chuyên mục sách (báo lớn VN)

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

// Dùng rss-parser đọc RSS chuẩn, ổn định hơn tự parse HTML
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
    rss: "https://news.zing.vn/rss/van-hoa.rss"
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
            sourceId: z.string().optional(),
            sourceName: z.string().optional(),
            content: z.array(z.string()).optional() // các phần của truyện (text sạch)
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const results = [];
    const topicLower = topic ? topic.toLowerCase() : null;

    // Dùng Set để tránh trùng tiêu đề giữa các báo
    const seenTitles = new Set();

    for (const src of STORY_SOURCES) {
      try {
        const feed = await rss.parseURL(src.rss);
        const items = feed.items || [];

        // Mỗi nguồn lấy tối đa 3 truyện
        for (const item of items.slice(0, 3)) {
          const title = (item.title || "Không có tiêu đề").trim();
          const link = (item.link || "").trim();

          // Nội dung ngắn ưu tiên: content:encoded -> content -> snippet -> description
          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
            item.summary ||
            item.description ||
            "";

          const text = stripHtml(raw);

          // Bỏ qua nếu không có nội dung
          if (!text) continue;

          // Lọc theo chủ đề nếu có
          if (
            topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)
          ) {
            continue;
          }

          // Tránh truyện trùng tiêu đề
          const normTitle = title.toLowerCase();
          if (seenTitles.has(normTitle)) continue;
          seenTitles.add(normTitle);

          // Chia truyện dài thành từng phần ~800 ký tự
          const parts = splitToParts(text, 800);

          // Mô tả ngắn gửi cho robot để giới thiệu
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
        // Không throw ra ngoài để tránh làm hỏng toàn bộ response
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
 * 2) TOOL: TRUYỆN / SÁCH TỪ KHO SÁCH ĐIỆN TỬ & MỤC SÁCH
 * ================================================= */

/**
 * Ở Việt Nam, các “kho sách điện tử” lớn thường không mở API public.
 * Cách an toàn là dùng RSS của:
 *  - Các chuyên mục sách / xuất bản / văn hóa đọc trên báo lớn (Zing Xuất bản, v.v.) :contentReference[oaicite:1]{index=1}
 *  - Một số mục văn hóa / sách lâu năm khác (VnExpress, Dân Trí, Tuổi Trẻ...)
 *
 * Robot có thể:
 *  - Lấy nội dung bài giới thiệu sách, trích đoạn, bài viết về văn hóa đọc
 *  - Làm sạch HTML → chia nhỏ → đọc thành “sách nói” tiếng Việt cho người dùng
 */

const BOOK_SOURCES = [
  // Zing News – chuyên mục Xuất bản (sách, tác giả, trích đoạn) – RSS công khai
  {
    id: "zing_xuatban",
    name: "Zing Xuất bản",
    rss: "https://news.zing.vn/rss/xuat-ban.rss"
  },
  // Một số mục văn hóa/sách khác (dùng chung với truyện nhưng tập trung bài sách, review)
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
    rss: "https://tuoitre.vn/rss/sach.rss" // nếu sai định dạng → sẽ bị catch, không làm rớt tool
  }
];

server.registerTool(
  "get_vietnamese_ebooks",
  {
    title: "Truyện & sách từ kho sách điện tử Việt Nam",
    description:
      "Lấy các bài giới thiệu sách, trích đoạn, truyện dài, truyện ngắn từ chuyên mục sách / xuất bản / văn hóa đọc trên các báo, kho sách điện tử Việt Nam. Nội dung được làm sạch HTML và chia thành nhiều phần ~800 ký tự để robot đọc tiếng Việt.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề sách / truyện muốn nghe (ví dụ: thiếu nhi, kỹ năng sống, kinh doanh, lịch sử, tình cảm...). Dùng tiếng Việt."
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
            content: z.array(z.string()).optional() // text sạch, đã chia phần
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const topicLower = topic ? topic.toLowerCase() : null;
    const results = [];
    const seenTitles = new Set();

    for (const src of BOOK_SOURCES) {
      try {
        const feed = await rss.parseURL(src.rss);
        const items = feed.items || [];

        // Mỗi nguồn lấy tối đa 5 bài sách / truyện
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

          // Lọc theo chủ đề nếu có
          if (
            topicLower &&
            !title.toLowerCase().includes(topicLower) &&
            !text.toLowerCase().includes(topicLower)
          ) {
            continue;
          }

          // Chống trùng theo tiêu đề
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
        // Không throw: 1 nguồn chết, các nguồn khác vẫn chạy
      }
    }

    if (results.length === 0) {
      return makeResult({
        success: false,
        message:
          "Không tìm thấy truyện / sách phù hợp. Hãy thử lại với chủ đề khác (ví dụ: thiếu nhi, kỹ năng, kinh doanh, lịch sử...)."
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy danh sách truyện / sách từ các nguồn điện tử Việt Nam. Nội dung đã được làm sạch HTML và chia thành nhiều phần để robot đọc.",
      books: results
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
