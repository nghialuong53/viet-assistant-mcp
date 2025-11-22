// index.mjs
// MCP server: kể chuyện Việt Nam (1 tiện ích duy nhất)

import express from "express";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
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
/* -------------------------------------------------
 * TIN TỨC VIỆT NAM – RSS CÁC BÁO LỚN
 * ------------------------------------------------- */

const rssParser = new XMLParser({ ignoreAttributes: false });

// Các chủ đề chính (anh có thể dùng để lọc)
const NEWS_CATEGORIES = [
  "all",
  "general",
  "politics",
  "business",
  "technology",
  "sports",
  "entertainment"
];

// 5 báo Việt Nam phổ biến
const NEWS_FEEDS = [
  {
    id: "vnexpress-tin-moi",
    name: "VnExpress - Tin mới nhất",
    category: "general",
    url: "https://vnexpress.net/rss/tin-moi-nhat.rss"
  },
  {
    id: "tuoitre-tin-moi",
    name: "Tuổi Trẻ - Tin mới nhất",
    category: "general",
    url: "https://tuoitre.vn/rss/tin-moi-nhat.rss"
  },
  {
    id: "thanhnien-thoi-su",
    name: "Thanh Niên - Thời sự",
    category: "politics",
    url: "https://thanhnien.vn/rss/thoi-su.rss"
  },
  {
    id: "vietnamnet-tin-moi",
    name: "VietNamNet - Tin mới nhất",
    category: "general",
    url: "https://vietnamnet.vn/rss/tin-moi-nhat.rss"
  },
  {
    id: "dantri-tin-moi",
    name: "Dân Trí - Tin mới",
    category: "general",
    url: "https://dantri.com.vn/rss/home.rss"
  }
];
/* -------------------------------------------------
 * TOOL: get_latest_vn_news
 * Lấy tin tức mới nhất từ các báo Việt Nam
 * ------------------------------------------------- */

server.registerTool(
  "get_latest_vn_news",
  {
    title: "Tin tức Việt Nam mới nhất",
    description:
      "Lấy danh sách tin mới từ các báo lớn Việt Nam (VnExpress, Tuổi Trẻ, Thanh Niên, VietNamNet, Dân Trí). " +
      "Có thể lọc theo chủ đề và giới hạn số bài trên mỗi nguồn.",
    inputSchema: {
      category: z
        .enum(NEWS_CATEGORIES)
        .default("all")
        .describe(
          "Chủ đề: all, general, politics, business, technology, sports, entertainment. " +
            "Nếu không chắc thì cứ để 'all'."
        ),
      limitPerSource: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(3)
        .describe("Số bài tối đa lấy từ MỖI báo (1-10). Mặc định 3.")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      category: z.string().optional(),
      limitPerSource: z.number().optional(),
      items: z
        .array(
          z.object({
            title: z.string(),
            link: z.string(),
            publishedAt: z.string().optional(),
            source: z.string(),
            category: z.string(),
            feedId: z.string()
          })
        )
        .optional(),
      errors: z
        .array(
          z.object({
            feedId: z.string(),
            source: z.string(),
            error: z.string()
          })
        )
        .optional()
    }
  },
  async ({ category, limitPerSource }) => {
    const limit = limitPerSource ?? 3;

    // Chọn feed theo chủ đề
    const feedsToUse =
      category === "all"
        ? NEWS_FEEDS
        : NEWS_FEEDS.filter((f) => f.category === category);

    const allItems = [];
    const errors = [];

    await Promise.all(
      feedsToUse.map(async (feed) => {
        try {
          const res = await fetch(feed.url);
          if (!res.ok) {
            errors.push({
              feedId: feed.id,
              source: feed.name,
              error: `HTTP ${res.status}`
            });
            return;
          }

          const xmlText = await res.text();
          const json = rssParser.parse(xmlText);
          const channel = json?.rss?.channel;

          let items = channel?.item || [];
          if (!Array.isArray(items)) {
            items = items ? [items] : [];
          }

          items.slice(0, limit).forEach((item) => {
            allItems.push({
              title: item.title || "",
              link: item.link || "",
              publishedAt: item.pubDate || "",
              source: feed.name,
              category: feed.category,
              feedId: feed.id
            });
          });
        } catch (err) {
          errors.push({
            feedId: feed.id,
            source: feed.name,
            error: err?.message || String(err)
          });
        }
      })
    );

    return makeResult({
      success: true,
      message: `Đã lấy tin tức mới nhất từ ${feedsToUse.length} nguồn báo Việt Nam.`,
      category,
      limitPerSource: limit,
      items: allItems,
      errors: errors.length ? errors : undefined
    });
  }
);
