// index.mjs
// MCP server: kể chuyện Việt Nam (1 tiện ích duy nhất)

import express from "express";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ----------------------
// TẠO MCP SERVER
// ----------------------
const server = new McpServer({
  name: "viet-story-mcp",
  version: "1.0.0"
});

function makeResult(output) {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

// ----------------------
// NGUỒN TRUYỆN VIỆT NAM
// ----------------------
const SOURCES = [
  "https://vnexpress.net/rss/giai-tri.rss",
  "https://zingnews.vn/rss/van-hoa.rss",
  "https://baomoi.com/rss/giai-tri.rss",
  "https://dantri.com.vn/rss/van-hoa.rss",
  "https://tuoitre.vn/rss/van-hoa.rss"
];

// ----------------------
// TOOL: get_vietnamese_stories
// ----------------------
server.registerTool(
  "get_vietnamese_stories",
  {
    title: "Kể chuyện Việt Nam",
    description:
      "Tự động lấy truyện ngắn, cổ tích hoặc truyện giải trí từ các trang báo Việt Nam và chia thành nhiều phần nếu dài.",
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
            content: z.array(z.string()).optional() // các phần của truyện
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const results = [];

    for (const url of SOURCES) {
      try {
        const res = await fetch(url);
        const xml = await res.text();

        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
        for (const item of items.slice(0, 3)) {
          const title = item[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || "Không có tiêu đề";
          const link = item[1].match(/<link>(.*?)<\/link>/)?.[1] || "";
          const desc = item[1].match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] || "";

          // Nếu có chủ đề, lọc
          if (topic && !title.toLowerCase().includes(topic.toLowerCase()) && !desc.toLowerCase().includes(topic.toLowerCase())) {
            continue;
          }

          // Chia truyện dài thành từng phần (mỗi 700 ký tự)
          const parts = desc.length > 700 ? desc.match(/.{1,700}/g) : [desc];

          results.push({
            title,
            description: desc.slice(0, 120) + "...",
            link,
            content: parts
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS:", err.message);
      }
    }

    if (results.length === 0) {
      return makeResult({
        success: false,
        message: "Không tìm thấy truyện nào phù hợp, hãy thử lại với chủ đề khác (ví dụ: cổ tích, hài hước, tình cảm...)"
      });
    }

    return makeResult({
      success: true,
      message: "Các truyện Việt Nam được tìm thấy. Mỗi truyện có thể chia thành nhiều phần nếu dài.",
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
