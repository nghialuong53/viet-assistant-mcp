// index.mjs
// MCP server: 4 tiện ích cho Robot AI ESP32-C3
// 1) get_vietnamese_stories  – truyện / bài dạng truyện từ báo Việt Nam
// 2) get_vietnamese_ebooks   – bài sách, trích đoạn, văn hóa đọc
// 3) get_world_news           – tin tức quốc tế (Anh + Việt) dịch đầy đủ sang tiếng Việt
// 4) fetch_webpage            – lấy nội dung bất kỳ 1 trang web (báo / blog / tin tức) không tóm tắt

import express from "express";
import Parser from "rss-parser";
import translate from "@vitalets/google-translate-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/* =================================================
 * TẠO MCP SERVER
 * ================================================= */

const server = new McpServer({
  name: "viet-story-mcp",
  version: "2.0.0",
  description:
    "Truyện Việt Nam, bài sách, tin tức quốc tế dịch sang tiếng Việt và tool lấy nội dung web cho Robot AI."
});

function makeResult(output) {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

/* =================================================
 * CẤU HÌNH RSS PARSER + HÀM TIỆN ÍCH CHUNG
 * ================================================= */

const rss = new Parser({
  headers: { "User-Agent": "VN-Story-Book-MCP/2.0" }
});

// Xóa tag HTML, script/style, gom khoảng trắng, decode entity đơn giản
function stripHtml(html = "") {
  if (!html) return "";
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Tách text thành các đoạn nhỏ để robot đọc lần lượt (không bị giữa chừng rồi lỗi)
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
      "Lấy truyện ngắn, cổ tích hoặc truyện giải trí từ các trang báo Việt Nam. Nội dung gốc đầy đủ, làm sạch HTML, chia thành nhiều phần để robot đọc lần lượt.",
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
            // MẢNG TEXT – MỖI PHẦN ~800 KÝ TỰ – ROBOT ĐỌC TỪ PHẦN 1 ĐẾN HẾT
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

          // Lọc theo chủ đề (nếu có)
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

          // description ở đây chỉ là đoạn mở đầu, còn content[] là toàn bộ
          const shortDesc =
            text.length > 300 ? text.slice(0, 300).trim() + "..." : text;

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
        "Đã lấy danh sách truyện Việt Nam. Mỗi truyện có mảng content[], robot hãy đọc lần lượt từng phần để không bị lỗi giữa chừng.",
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
      "Lấy bài giới thiệu sách, trích đoạn truyện, nội dung về văn hóa đọc từ các chuyên mục sách/ xuất bản. Text gốc đầy đủ, làm sạch HTML, chia phần để đọc.",
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
            text.length > 300 ? text.slice(0, 300).trim() + "..." : text;

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
        "Đã lấy danh sách truyện / bài sách. Mỗi bài có content[] là toàn bộ nội dung gốc đã chia nhỏ để robot đọc.",
      books: results,
      errors: errors.length ? errors : undefined
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
    title: "Tin tức quốc tế dịch sang tiếng Việt (đầy đủ)",
    description:
      "Lấy danh sách tin tức theo chủ đề từ các báo/đài quốc tế (Anh + Việt), dịch tiêu đề + nội dung sang tiếng Việt để robot đọc đầy đủ, không tóm tắt.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề tin: 'Thế giới', 'Kinh tế', 'Công nghệ', 'Giáo dục', 'Văn hóa', 'Khoa học'. Để trống để xem danh sách chủ đề."
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
            // contentVi là BẢN DỊCH ĐẦY ĐỦ, robot nên đọc theo field này
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
          "Chủ đề không hợp lệ. Hãy dùng một trong: " +
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

          let titleVi = title;
          let contentVi = text;
          let summaryVi = text.length > 300 ? text.slice(0, 300).trim() + "..." : text;

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
            console.error("Lỗi dịch tin tức:", e.message);
          }

          results.push({
            title,
            titleVi,
            link,
            source: link ? link.split("/")[2] : "unknown",
            summaryVi,
            contentVi
          });

          if (results.length >= 15) break;
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
        ". Robot hãy dùng contentVi để đọc đầy đủ nội dung tiếng Việt.",
      topic,
      articles: results,
      errors: errors.length ? errors : undefined
    });
  }
);

/* =================================================
 * 4) TOOL LẤY NỘI DUNG TRANG WEB BẤT KỲ
 * ================================================= */

// Lấy <title> từ HTML
function extractTitle(html = "") {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return null;
  return m[1].trim();
}

// Ưu tiên lấy article/main/body
function extractMainBlock(html = "") {
  if (!html) return "";
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) return articleMatch[0];

  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch) return mainMatch[0];

  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  if (bodyMatch) return bodyMatch[0];

  return html;
}

// Cắt bớt nếu quá dài (tránh lỗi input quá lớn)
function limitLength(text, maxChars = 20000) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[Đã cắt bớt nội dung vì quá dài...]";
}

server.registerTool(
  "fetch_webpage",
  {
    title: "Lấy nội dung một trang web (bài báo / blog / tin tức)",
    description:
      "Cho URL bất kỳ (http/https). Tool sẽ tải trang, bóc article/main/body và trả về text đầy đủ (không tóm tắt).",
    inputSchema: {
      url: z
        .string()
        .url()
        .describe("Địa chỉ URL cần lấy nội dung, ví dụ: https://vnexpress.net/..."),
      maxChars: z
        .number()
        .int()
        .min(1000)
        .max(50000)
        .optional()
        .describe(
          "Giới hạn số ký tự tối đa của nội dung trả về. Mặc định ~20000 để tránh lỗi input quá lớn."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      url: z.string().optional(),
      httpStatus: z.number().optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      meta: z
        .object({
          contentLength: z.number().optional(),
          truncated: z.boolean().optional(),
          note: z.string().optional()
        })
        .optional(),
      error: z.string().optional()
    }
  },
  async ({ url, maxChars }) => {
    const limit = maxChars || 20000;

    if (!/^https?:\/\//i.test(url)) {
      return makeResult({
        success: false,
        message: "Chỉ hỗ trợ URL bắt đầu bằng http:// hoặc https://",
        url,
        error: "INVALID_PROTOCOL"
      });
    }

    let res;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "viet-story-mcp/2.0 (+robot-ai; like Mozilla/5.0; VN Content Fetcher)"
        },
        redirect: "follow"
      });
    } catch (err) {
      console.error("❌ Lỗi mạng khi fetch URL:", url, err);
      return makeResult({
        success: false,
        message:
          "Không kết nối được tới trang này. Có thể do chặn IP, lỗi mạng, hoặc URL không tồn tại.",
        url,
        error: String(err.message || err)
      });
    }

    const status = res.status;
    if (!res.ok) {
      console.error("❌ HTTP lỗi:", status, "URL:", url);
      return makeResult({
        success: false,
        message:
          "Máy chủ trả về mã lỗi HTTP " +
          status +
          ". Có thể trang yêu cầu đăng nhập, chặn bot, hoặc không tồn tại.",
        url,
        httpStatus: status,
        error: "HTTP_ERROR_" + status
      });
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      console.warn("⚠️ Nội dung không phải HTML:", contentType);
      const text = await res.text().catch(() => "");
      return makeResult({
        success: true,
        message:
          "Trang không phải HTML (content-type: " +
          contentType +
          "). Đã trả về nội dung thô.",
        url,
        httpStatus: status,
        title: null,
        content: limitLength(text, limit),
        meta: {
          contentLength: text.length,
          truncated: text.length > limit,
          note: "Không phải HTML, không bóc được article/main."
        }
      });
    }

    const html = await res.text();
    const title = extractTitle(html);
    const mainBlock = extractMainBlock(html);
    const text = stripHtml(mainBlock);
    const finalText = limitLength(text, limit);

    if (!finalText) {
      return makeResult({
        success: false,
        message:
          "Đã tải được trang nhưng không bóc được nội dung văn bản (có thể trang dùng JS nặng hoặc nội dung nằm trong iframe).",
        url,
        httpStatus: status,
        title,
        error: "EMPTY_CONTENT"
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy nội dung trang web thành công. Nội dung đã được làm sạch HTML và không tóm tắt.",
      url,
      httpStatus: status,
      title,
      content: finalText,
      meta: {
        contentLength: text.length,
        truncated: text.length > limit,
        note:
          text.length > limit
            ? "Nội dung gốc dài hơn giới hạn, đã cắt bớt để tránh lỗi."
            : "Nội dung đầy đủ."
      }
    });
  }
);

/* =================================================
 * KHỞI ĐỘNG MCP SERVER (HTTP STREAM)
 * ================================================= */

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send(
    "viet-story-mcp 2.0 đang chạy. Dùng POST /mcp cho client MCP (imcp.pro, xiaozhi, v.v.)."
  );
});

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      request: req,
      response: res
    });

    await server.connect(transport);
    await transport.handleRequest();
  } catch (err) {
    console.error("❌ Lỗi xử lý MCP /mcp:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message:
            "Lỗi nội bộ trên viet-story-mcp: " + String(err.message || err)
        }
      });
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(
    `viet-story-mcp 2.0 running at http://localhost:${port}/mcp (POST)`
  );
});
