// index.mjs
// MCP server: 3 tiện ích (FULL CONTENT, KHÔNG TÓM TẮT)
// 1) Kể chuyện Việt Nam từ báo lớn VN (đầy đủ nội dung gốc)
// 2) Truyện / bài sách từ chuyên mục sách & kho sách điện tử VN (đầy đủ)
// 3) Tin tức quốc tế (Anh + Việt) dịch FULL sang tiếng Việt (không rút gọn)

import express from "express";
import Parser from "rss-parser";
import translate from "@vitalets/google-translate-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ----------------------
// TẠO MCP SERVER
// ----------------------
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
function splitToParts(text, maxLen = 1200) {
  if (!text) return [];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts.filter((p) => p.trim().length > 0);
}

// Dịch text dài theo từng khúc nhỏ để tránh lỗi
async function translateFull(text, to = "vi", chunkSize = 2500) {
  if (!text) return "";
  if (text.length <= chunkSize) {
    const r = await translate(text, { to });
    return r.text;
  }
  const chunks = splitToParts(text, chunkSize);
  const out = [];
  for (const c of chunks) {
    const r = await translate(c, { to });
    out.push(r.text);
  }
  return out.join(" ");
}

/* =================================================
 * 1) TOOL KỂ CHUYỆN VIỆT NAM (FULL NỘI DUNG GỐC)
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
    title: "Kể chuyện Việt Nam (đầy đủ nội dung)",
    description:
      "Tự động lấy truyện ngắn, cổ tích hoặc truyện giải trí từ các trang báo Việt Nam. Trả về FULL nội dung gốc (không tóm tắt), kèm mảng 'parts' để robot đọc từng đoạn.",
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
            link: z.string(),
            sourceId: z.string().optional(),
            sourceName: z.string().optional(),
            fullText: z.string(), // toàn bộ truyện
            parts: z.array(z.string()) // các đoạn ~1200 ký tự, đủ hết truyện
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

          const parts = splitToParts(text, 1200);

          results.push({
            title,
            link,
            sourceId: src.id,
            sourceName: src.name,
            fullText: text,
            parts
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
        "Đã lấy danh sách truyện Việt Nam. Mỗi truyện có 'fullText' (nội dung đầy đủ) và 'parts' để robot đọc từng đoạn, KHÔNG TÓM TẮT.",
      stories: results,
      errors: errors.length ? errors : undefined
    });
  }
);

/* =================================================
 * 2) TOOL TRUYỆN / SÁCH TỪ CHUYÊN MỤC SÁCH & KHO SÁCH VN (FULL)
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
    title: "Truyện & sách điện tử Việt Nam (nội dung đầy đủ)",
    description:
      "Lấy bài viết giới thiệu sách, trích đoạn truyện, nội dung về văn hóa đọc từ các chuyên mục sách / xuất bản của báo Việt Nam. Trả FULL text (không tóm tắt), kèm 'parts' để robot đọc.",
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
            link: z.string(),
            sourceId: z.string().optional(),
            sourceName: z.string().optional(),
            fullText: z.string(), // nội dung bài sách/truyện
            parts: z.array(z.string()) // các đoạn ~1200 ký tự
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

          const parts = splitToParts(text, 1200);

          results.push({
            title,
            link,
            sourceId: src.id,
            sourceName: src.name,
            fullText: text,
            parts
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
        "Đã lấy danh sách truyện / bài sách Việt Nam. Mỗi bài có 'fullText' đầy đủ và 'parts' để robot đọc, KHÔNG TÓM TẮT.",
      books: results,
      errors: errors.length ? errors : undefined
    });
  }
);

/* =================================================
 * 3) TOOL TIN TỨC QUỐC TẾ (ANH + VIỆT) DỊCH FULL SANG TIẾNG VIỆT
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
    title: "Tin tức quốc tế dịch FULL sang tiếng Việt",
    description:
      "Lấy danh sách tin tức theo chủ đề từ các báo/đài quốc tế (Anh + Việt). Dịch TOÀN BỘ nội dung sang tiếng Việt (không rút gọn). Trả về 'contentViFull' (full text) và 'contentViParts' (các đoạn để robot đọc).",
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
            titleVi: z.string(), // tiêu đề đã dịch
            link: z.string().optional(),
            source: z.string().optional(),
            contentViFull: z.string(), // toàn bộ bài tiếng Việt
            contentViParts: z.array(z.string()) // các đoạn tiếng Việt
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
    // Nếu không truyền topic → chỉ trả danh sách chủ đề
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
      try {
        const feed = await rss.parseURL(url);
        const items = feed.items || [];

        for (const item of items.slice(0, 5)) {
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

          try {
            const titleVi = await translateFull(title, "vi", 500);
            const contentViFull = await translateFull(text, "vi", 2500);
            const contentViParts = splitToParts(contentViFull, 1200);

            results.push({
              title,
              titleVi,
              link,
              source: link ? link.split("/")[2] : "unknown",
              contentViFull,
              contentViParts
            });
          } catch (e) {
            console.error("Lỗi dịch tin tức:", e.message);
          }

          if (results.length >= 20) break;
        }
      } catch (err) {
        console.error("Lỗi đọc RSS (news) từ", url, ":", err.message);
        errors.push({
          source: url.split("/")[2] || "unknown",
          rss: url,
          error: String(err.message || err)
        });
      }
    }

    if (results.length === 0) {
      return makeResult({
        success: false,
        message:
          "Không lấy được tin tức cho chủ đề này. Có thể các nguồn RSS đang lỗi hoặc bị chặn.",
        topic,
        articles: [],
        errors: errors.length ? errors : undefined
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy danh sách tin tức quốc tế cho chủ đề " +
        topic +
        ". Mỗi bài có 'contentViFull' (nguyên văn tiếng Việt, KHÔNG TÓM TẮT) và 'contentViParts' để robot đọc từng đoạn.",
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

app.get("/", (req, res) => {
  res.send(
    "Vietnam Story, Book & World News MCP server is running (FULL TEXT mode). Use POST /mcp for MCP clients."
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
    `Vietnam Story, Book & World News MCP (FULL TEXT) running at http://localhost:${port}/mcp`
  );
});
