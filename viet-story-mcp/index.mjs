// index.mjs
// MCP server: kể chuyện Việt Nam (1 tiện ích duy nhất, ổn định hơn)

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
  version: "1.0.1"
});

function makeResult(output) {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

// ----------------------
// RSS PARSER + NGUỒN TRUYỆN VIỆT NAM
// ----------------------

// Dùng rss-parser đọc RSS chuẩn, ít lỗi hơn regex thủ công
const rss = new Parser({
  headers: { "User-Agent": "VN-Story-MCP" }
});

const SOURCES = [
  "https://vnexpress.net/rss/giai-tri.rss",
  "https://zingnews.vn/rss/van-hoa.rss",
  "https://baomoi.com/rss/giai-tri.rss",
  "https://dantri.com.vn/rss/van-hoa.rss",
  "https://tuoitre.vn/rss/van-hoa.rss"
];

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

// ----------------------
// TOOL: get_vietnamese_stories
// ----------------------
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

    // Dùng Set để tránh trùng tiêu đề giữa các báo
    const seenTitles = new Set();

    for (const url of SOURCES) {
      try {
        const feed = await rss.parseURL(url);
        const items = feed.items || [];

        // Mỗi nguồn lấy tối đa 3 truyện
        for (const item of items.slice(0, 3)) {
          const title = (item.title || "Không có tiêu đề").trim();
          const link = (item.link || "").trim();

          // Nội dung ngắn ưu tiên: content:encoded -> content -> snippet
          const raw =
            item["content:encoded"] ||
            item.content ||
            item.contentSnippet ||
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
            content: parts
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS từ", url, ":", err.message);
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

// ----------------------
// KHỞI ĐỘNG MCP SERVER
// ----------------------
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Vietnam Story MCP server is running. Use POST /mcp for MCP clients.");
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
  console.log(`Vietnam Story MCP running at http://localhost:${port}/mcp`);
});
