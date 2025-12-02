// index.mjs
// MCP server: 3 tiện ích
// 1) Kể chuyện Việt Nam từ báo lớn VN
// 2) Truyện / bài sách từ chuyên mục sách & kho sách điện tử VN
// 3) Tin tức quốc tế (Anh + Việt) để robot dịch sang tiếng Việt

import express from "express";
import Parser from "rss-parser";
import translate from "@vitalets/google-translate-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/* =================================================
 * CẤU HÌNH CHUNG
 * ================================================= */

const APP_NAME = "viet-story-mcp";
const APP_VERSION = "1.4.0";

const MAX_ITEMS_PER_FEED = 5;     // số bài lấy mỗi nguồn
const CHUNK_LEN = 800;           // độ dài 1 đoạn text cho robot đọc

// Tạo MCP server
const server = new McpServer({
  name: APP_NAME,
  version: APP_VERSION
});

// Helper: trả kết quả MCP
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
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Chia text thành các đoạn maxLen ký tự, bỏ đoạn rỗng
function splitToParts(text, maxLen = CHUNK_LEN) {
  if (!text) return [];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts.filter((p) => p.trim().length > 0);
}

// Helper: parse 1 RSS với log lỗi rõ ràng
async function safeParseRss(url, sourceLabel, errors) {
  try {
    const feed = await rss.parseURL(url);
    return feed.items || [];
  } catch (err) {
    const msg = String(err?.message || err);
    console.error(`[RSS ERROR] ${sourceLabel} (${url}):`, msg);
    errors.push({
      source: sourceLabel,
      rss: url,
      error: msg
    });
    return [];
  }
}

/* =================================================
 * 1) TOOL KỂ CHUYỆN VIỆT NAM
 * ================================================= */

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
            sourceId: z.string().optional(),
            sourceName: z.string().optional(),
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
      const items = await safeParseRss(src.rss, src.name, errors);

      for (const item of items.slice(0, MAX_ITEMS_PER_FEED)) {
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

        // Tránh trùng tiêu đề
        const normTitle = title.toLowerCase();
        if (seenTitles.has(normTitle)) continue;
        seenTitles.add(normTitle);

        const parts = splitToParts(text);
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
    }

    // Tổng kết kết quả + lỗi
    const allSourcesFailed =
      errors.length === STORY_SOURCES.length && results.length === 0;

    if (results.length === 0) {
      let message;
      if (allSourcesFailed) {
        message =
          "Không truy cập được bất kỳ nguồn truyện nào. Có thể server bị chặn mạng (firewall), đứt cáp, hoặc RSS tạm thời bị lỗi. Thử lại sau vài phút hoặc dùng Wi-Fi khác.";
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
        errors: errors.length
          ? errors.map((e) => ({
              sourceId:
                STORY_SOURCES.find((s) => s.name === e.source)?.id || "",
              sourceName: e.source,
              rss: e.rss,
              error: e.error
            }))
          : undefined
      });
    }

    const messageBase =
      "Đã lấy danh sách truyện Việt Nam. Nội dung đã được làm sạch HTML và chia thành nhiều phần để robot đọc.";
    const messageExtra =
      errors.length > 0
        ? " Một số nguồn truyện đang không truy cập được, nhưng các nguồn khác vẫn hoạt động."
        : "";

    return makeResult({
      success: true,
      message: messageBase + messageExtra,
      stories: results,
      errors: errors.length
        ? errors.map((e) => ({
            sourceId: STORY_SOURCES.find((s) => s.name === e.source)?.id || "",
            sourceName: e.source,
            rss: e.rss,
            error: e.error
          }))
        : undefined
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
      "Lấy bài viết giới thiệu sách, trích đoạn truyện, nội dung về văn hóa đọc từ các chuyên mục sách/xuất bản. Text sạch, chia thành các đoạn ~800 ký tự.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề sách/truyện (ví dụ: thiếu nhi, kỹ năng sống, kinh doanh, lịch sử, tình cảm...). Dùng tiếng Việt."
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
            sourceId: z.string().optional(),
            sourceName: z.string().optional(),
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
      const items = await safeParseRss(src.rss, src.name, errors);

      for (const item of items.slice(0, MAX_ITEMS_PER_FEED)) {
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

        const parts = splitToParts(text);
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
    }

    const allSourcesFailed =
      errors.length === BOOK_SOURCES.length && results.length === 0;

    if (results.length === 0) {
      let message;
      if (allSourcesFailed) {
        message =
          "Không truy cập được bất kỳ nguồn sách/truyện nào. Có thể server bị chặn mạng (firewall), đứt cáp, hoặc RSS tạm thời bị lỗi. Thử lại sau ít phút.";
      } else if (topicLower) {
        message =
          "Không tìm thấy bài nào khớp với chủ đề bạn yêu cầu. Hãy thử từ khóa khác (ví dụ: thiếu nhi, kỹ năng, kinh doanh).";
      } else {
        message =
          "Không tìm thấy bài sách/truyện nào từ các nguồn hiện tại. Có thể RSS đang thay đổi.";
      }

      return makeResult({
        success: false,
        message,
        books: [],
        errors: errors.length
          ? errors.map((e) => ({
              sourceId:
                BOOK_SOURCES.find((s) => s.name === e.source)?.id || "",
              sourceName: e.source,
              rss: e.rss,
              error: e.error
            }))
          : undefined
      });
    }

    const baseMsg =
      "Đã lấy danh sách truyện/bài sách Việt Nam. Nội dung sạch và đã chia nhiều phần để robot đọc.";
    const extraMsg =
      errors.length > 0
        ? " Một số nguồn sách đang lỗi nhưng các nguồn khác vẫn OK."
        : "";

    return makeResult({
      success: true,
      message: baseMsg + extraMsg,
      books: results,
      errors: errors.length
        ? errors.map((e) => ({
            sourceId: BOOK_SOURCES.find((s) => s.name === e.source)?.id || "",
            sourceName: e.source,
            rss: e.rss,
            error: e.error
          }))
        : undefined
    });
  }
);

/* =================================================
 * 3) TOOL TIN TỨC QUỐC TẾ (ANH + VIỆT) DỊCH SANG TIẾNG VIỆT
 * ================================================= */

const NEWS_SOURCES = {
  "Thế giới": [
    "https://www.bbc.com/vietnamese/index.xml",
    "https://vnexpress.net/rss/the-gioi.rss",
    "https://www.voatiengviet.com/api/z$yyteitit"
  ],
  "Kinh tế": [
    "https://vnexpress.net/rss/kinh-doanh.rss",
    "https://www.reuters.com/rssFeed/businessNews"
  ],
  "Công nghệ": [
    "https://vnexpress.net/rss/so-hoa.rss",
    "https://www.cnet.com/rss/news/",
    "https://www.techradar.com/rss"
  ],
  "Giáo dục": [
    "https://vnexpress.net/rss/giao-duc.rss",
    "https://www.voatiengviet.com/api/zt$qtiequt"
  ],
  "Văn hóa": [
    "https://www.rfi.fr/vi/văn-hóa/rss",
    "https://vnexpress.net/rss/giai-tri.rss"
  ],
  "Khoa học": [
    "https://vnexpress.net/rss/khoa-hoc.rss",
    "https://www.sciencedaily.com/rss/top.xml"
  ]
};

server.registerTool(
  "get_world_news",
  {
    title: "Tin tức quốc tế dịch sang tiếng Việt",
    description:
      "Lấy danh sách tin tức theo chủ đề từ các báo/đài quốc tế (Anh + Việt), dịch tiêu đề + nội dung sang tiếng Việt để robot đọc.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề tin: 'Thế giới', 'Kinh tế', 'Công nghệ', 'Giáo dục', 'Văn hóa', 'Khoa học'. Để trống để xem tất cả chủ đề có sẵn."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      availableTopics: z.array(z.string()).optional(),
      topic: z.string().optional(),
      articles: z
        .array(
          z.object({
            title: z.string(),
            titleVi: z.string().optional(),
            link: z.string().optional(),
            source: z.string().optional(),
            summaryVi: z.string().optional(),
            contentVi: z.string().optional()
          })
        )
        .optional(),
      errors: z
        .array(
          z.object({
            source: z.string(),
            rss: z.string(),
            error: z.string()
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    // Không truyền topic → trả danh sách chủ đề để robot gợi ý
    if (!topic) {
      return makeResult({
        success: true,
        message:
          "Danh sách chủ đề tin tức quốc tế. Hãy chọn 1 chủ đề rồi gọi lại tool với tham số 'topic'.",
        availableTopics: Object.keys(NEWS_SOURCES)
      });
    }

    const feeds = NEWS_SOURCES[topic];
    if (!feeds) {
      return makeResult({
        success: false,
        message:
          "Chủ đề không hợp lệ. Hãy dùng một trong các chủ đề: " +
          Object.keys(NEWS_SOURCES).join(", "),
        topic,
        articles: []
      });
    }

    const results = [];
    const errors = [];

    for (const url of feeds) {
      const label = url.split("/")[2] || "unknown";
      const items = await safeParseRss(url, label, errors);

      for (const item of items.slice(0, MAX_ITEMS_PER_FEED)) {
        const title = (item.title || "").trim();
        const link = (item.link || "").trim();

        const raw =
          item["content:encoded"] ||
          item.content ||
          item.summary ||
          item.contentSnippet ||
          "";

        const text = stripHtml(raw);
        if (!title || !text) continue;

        // Dịch tiêu đề + nội dung sang tiếng Việt
        let titleVi = title;
        let contentVi = text;
        let summaryVi =
          text.length > 300 ? text.slice(0, 300).trim() + "..." : text;

        try {
          const [tTitle, tContent] = await Promise.all([
            translate(title, { to: "vi" }),
            translate(text, { to: "vi" })
          ]);
          titleVi = tTitle.text;
          contentVi = tContent.text;
          summaryVi =
            contentVi.length > 300
              ? contentVi.slice(0, 300).trim() + "..."
              : contentVi;
        } catch (e) {
          console.error("[TRANSLATE ERROR]", e?.message || e);
        }

        results.push({
          title,
          titleVi,
          link,
          source: link ? link.split("/")[2] : label,
          summaryVi,
          contentVi
        });

        if (results.length >= 15) break;
      }
    }

    const allFeedsFailed =
      errors.length === feeds.length && results.length === 0;

    if (results.length === 0) {
      const msg = allFeedsFailed
        ? "Không lấy được tin tức cho chủ đề này vì tất cả nguồn RSS đều lỗi hoặc bị chặn. Thử lại sau hoặc kiểm tra hạ tầng mạng của server."
        : "Không lấy được tin tức cho chủ đề này. Có thể các nguồn RSS đang lỗi hoặc bị chặn.";

      return makeResult({
        success: false,
        message: msg,
        topic,
        articles: [],
        errors: errors.length ? errors : undefined
      });
    }

    const baseMsg =
      "Đã lấy danh sách tin tức quốc tế cho chủ đề " + topic + ". Robot có thể gợi ý tiêu đề để bạn chọn rồi đọc nội dung tiếng Việt.";
    const extraMsg =
      errors.length > 0
        ? " Một số nguồn tin đang gặp lỗi nhưng các nguồn khác vẫn cập nhật được."
        : "";

    return makeResult({
      success: true,
      message: baseMsg + extraMsg,
      topic,
      articles: results,
      errors: errors.length ? errors : undefined
    });
  }
);

/* =================================================
 * KHỞI ĐỘNG MCP SERVER (HTTP TRANSPORT)
 * ================================================= */

const app = express();
app.use(express.json());

// Health check đơn giản
app.get("/", (req, res) => {
  res.send(
    "Vietnam Story, Book & World News MCP server is running. Use POST /mcp for MCP clients."
  );
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    name: APP_NAME,
    version: APP_VERSION,
    time: new Date().toISOString()
  });
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
    `Vietnam Story, Book & World News MCP running at http://localhost:${port}/mcp`
  );
});
