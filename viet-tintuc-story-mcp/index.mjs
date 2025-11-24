// index.mjs
// MCP server: 
// 1) Kể chuyện Việt Nam 
// 2) Tin tức Việt Nam & BBC theo chủ đề
// 3) Giá vàng & tỷ giá USD/VND (quy đổi theo spot vàng quốc tế)
// 4) Bài học + bài tập Toán tiểu học (lớp 1–5)
// 5) Truyện / sách từ nguồn quốc tế (Project Gutenberg, Storynory, ...)

import express from "express";
import Parser from "rss-parser";
import http from "http";
import https from "https";
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
  headers: { "User-Agent": "VN-Story-News-MCP" }
});

// ----------------------
// HTTP GET DÙNG NODE CORE (không dùng node-fetch)
// ----------------------
function httpGet(rawUrl, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(rawUrl);
      const lib = url.protocol === "http:" ? http : https;

      const req = lib.get(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "http:" ? 80 : 443),
          path: url.pathname + (url.search || ""),
          timeout: timeoutMs,
          headers: {
            "User-Agent": "VN-Story-News-MCP/1.2",
            Accept: "*/*"
          }
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve(data);
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy(new Error("Request timeout"));
      });
    } catch (err) {
      reject(err);
    }
  });
}

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
 * 1) TOOL KỂ CHUYỆN VIỆT NAM (GIỮ NGUYÊN, ĐANG CHẠY TỐT)
 * ================================================= */

const STORY_SOURCES = [
  "https://vnexpress.net/rss/giai-tri.rss",
  "https://zingnews.vn/rss/van-hoa.rss",
  "https://baomoi.com/rss/giai-tri.rss",
  "https://dantri.com.vn/rss/van-hoa.rss",
  "https://tuoitre.vn/rss/van-hoa.rss"
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
            content: z.array(z.string()).optional() // các phần của truyện (text sạch)
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const results = [];
    const topicLower = topic ? topic.toLowerCase() : null;
    const seenTitles = new Set();

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
            item.description ||
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
            content: parts
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS (story) từ", url, ":", err.message);
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
      "Lấy danh sách tiêu đề tin tức theo chủ đề (chính trị, bóng đá, tin thế giới, kinh tế, công nghệ...). Có 2 chế độ: 'list' (trả về danh sách tiêu đề) và 'article' (đọc nội dung đầy đủ của 1 bài báo).",
    inputSchema: {
      mode: z
        .enum(["list", "article"])
        .default("list")
        .describe("Chế độ: 'list' = lấy danh sách tiêu đề; 'article' = đọc nội dung 1 bài."),
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
        .describe("Đường link bài báo cần đọc đầy đủ (dùng cho mode='article')."),
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
  async ({ mode, topic, url, sources, limit }) => {
    // --------------------
    // MODE = "article": đọc full 1 bài
    // --------------------
    if (mode === "article") {
      if (!url) {
        return makeResult({
          success: false,
          message: "Mode = 'article' nhưng không có 'url' bài báo."
        });
      }

      // Tìm nguồn theo url (nếu match domain), chỉ để điền tên cho đẹp
      let src = NEWS_SOURCES.find((s) => {
        try {
          return url.includes(new URL(s.rss).hostname);
        } catch {
          return false;
        }
      });
      if (!src) {
        // nếu không đoán được, gán mặc định
        src = {
          id: "unknown",
          name: "Unknown Source"
        };
      }

      try {
        const html = await httpGet(url);

        // Lấy tất cả <p>...</p> rồi nối lại, bỏ tag
        const paragraphs = Array.from(
          html.matchAll(/<p[^>]*>(.*?)<\/p>/gis)
        ).map((m) => m[1]);

        let text = paragraphs.join("\n\n");
        text = stripHtml(text);

        if (!text || text.length < 100) {
          // fallback: strip hết html trong trang
          text = stripHtml(html);
        }

        const contentParts = splitToParts(text, 1000); // phần ~1000 ký tự cho robot đọc

        if (contentParts.length === 0) {
          return makeResult({
            success: false,
            message: "Không trích xuất được nội dung từ bài báo."
          });
        }

        // Tạm thời, lấy title từ <title> trong HTML (nếu cần thì client có thể override)
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const title = titleMatch ? stripHtml(titleMatch[1]) : url;

        return makeResult({
          success: true,
          message: "Đã lấy nội dung bài báo đầy đủ, chia nhiều phần để đọc.",
          article: {
            sourceId: src.id,
            sourceName: src.name,
            title,
            link: url,
            contentParts
          }
        });
      } catch (err) {
        console.error("Lỗi tải bài báo:", err.message);
        return makeResult({
          success: false,
          message: "Lỗi khi tải bài báo: " + err.message
        });
      }
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
            item.description ||
            "";
          const text = stripHtml(raw);

          if (!title || !link) continue;

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
        "Danh sách tiêu đề tin tức theo chủ đề. Dùng field 'link' để đọc nội dung từng bài qua mode='article'.",
      articles
    });
  }
);

/* =================================================
 * 3) TOOL GIÁ VÀNG & TỶ GIÁ USD/VND TẠI VIỆT NAM
 *    (dùng spot vàng quốc tế + tỷ giá USD/VND)
 * ================================================= */

// Sử dụng:
// - Tỷ giá: https://open.er-api.com/v6/latest/USD (không cần API key)
// - Giá vàng: https://freegoldapi.com/data/latest.csv (spot vàng USD/ounce)

server.registerTool(
  "get_vn_gold_usd_rates",
  {
    title: "Giá vàng & tỷ giá USD/VND",
    description:
      "Cập nhật tỷ giá USD/VND và giá vàng quốc tế (USD/ounce), sau đó quy đổi sang VND. Lưu ý: giá vàng là giá spot quốc tế, không phải giá SJC bán lẻ.",
    inputSchema: {},
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      rates: z
        .object({
          usdVnd: z.number().optional(),
          usdVndUpdatedAt: z.string().optional(),
          goldUsdPerOunce: z.number().optional(),
          goldVndPerOunce: z.number().optional(),
          goldLastDate: z.string().optional(),
          goldSource: z.string().optional(),
          notes: z.string().optional()
        })
        .optional()
    }
  },
  async () => {
    let usdVnd = null;
    let usdUpdatedAt = null;
    let goldUsdPerOunce = null;
    let goldVndPerOunce = null;
    let goldLastDate = null;

    const messages = [];

    // Lấy tỷ giá USD/VND
    try {
      const fxText = await httpGet("https://open.er-api.com/v6/latest/USD");
      const fxJson = JSON.parse(fxText);

      if (
        fxJson &&
        fxJson.result === "success" &&
        fxJson.rates &&
        typeof fxJson.rates.VND === "number"
      ) {
        usdVnd = fxJson.rates.VND;
        usdUpdatedAt =
          fxJson.time_last_update_utc ||
          (fxJson.time_last_update_unix
            ? new Date(fxJson.time_last_update_unix * 1000).toISOString()
            : null);
      } else {
        messages.push("Không lấy được tỷ giá USD/VND từ API.");
      }
    } catch (err) {
      console.error("Lỗi lấy tỷ giá USD/VND:", err.message);
      messages.push("Lỗi khi gọi API tỷ giá USD/VND: " + err.message);
    }

    // Lấy giá vàng (USD/ounce)
    try {
      const csv = await httpGet("https://freegoldapi.com/data/latest.csv");
      const lines = csv
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));

      const last = lines[lines.length - 1];
      const parts = last.split(",");
      if (parts.length >= 2) {
        goldLastDate = parts[0];
        const price = Number(parts[1]);
        if (Number.isFinite(price)) {
          goldUsdPerOunce = price;
        } else {
          messages.push("Không phân tích được giá vàng USD/ounce từ CSV.");
        }
      } else {
        messages.push("Định dạng CSV giá vàng không như mong đợi.");
      }
    } catch (err) {
      console.error("Lỗi lấy giá vàng:", err.message);
      messages.push("Lỗi khi gọi API giá vàng: " + err.message);
    }

    if (usdVnd != null && goldUsdPerOunce != null) {
      goldVndPerOunce = usdVnd * goldUsdPerOunce;
    }

    const hasAny =
      usdVnd != null || goldUsdPerOunce != null || goldVndPerOunce != null;

    if (!hasAny) {
      return makeResult({
        success: false,
        message:
          messages.join(" | ") ||
          "Không lấy được dữ liệu tỷ giá/giá vàng. Thử lại sau ít phút.",
        rates: undefined
      });
    }

    const notes = [
      "Tỷ giá USD/VND lấy từ ExchangeRate-API (open.er-api.com).",
      "Giá vàng là giá spot quốc tế (USD/ounce) từ freegoldapi.com, không phải giá vàng SJC tại cửa hàng.",
      "Giá vàng VND/ounce được tính = giá vàng USD/ounce × tỷ giá USD/VND."
    ].join(" ");

    return makeResult({
      success: true,
      message:
        messages.length === 0
          ? "Đã lấy được tỷ giá USD/VND và/hoặc giá vàng spot quốc tế."
          : "Có dữ liệu nhưng một phần API báo lỗi: " + messages.join(" | "),
      rates: {
        usdVnd: usdVnd ?? undefined,
        usdVndUpdatedAt: usdUpdatedAt ?? undefined,
        goldUsdPerOunce: goldUsdPerOunce ?? undefined,
        goldVndPerOunce: goldVndPerOunce ?? undefined,
        goldLastDate: goldLastDate ?? undefined,
        goldSource:
          "freegoldapi.com (spot vàng quốc tế) + open.er-api.com (tỷ giá USD/VND)",
        notes
      }
    });
  }
);

/* =================================================
 * 4) TOOL DẠY TOÁN TIỂU HỌC (LỚP 1–5)
 * ================================================= */

// Hàm random tiện ích
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Sinh 1 bài toán theo khối lớp + độ khó
function generateMathQuestion(grade, level) {
  const lvl = level || "easy";
  let a;
  let b;
  let op;
  let question;
  let answer;
  let explanation;

  if (grade === 1) {
    // Cộng trừ trong phạm vi 20
    op = Math.random() < 0.5 ? "+" : "-";
    a = randInt(0, 20);
    b = randInt(0, 20);
    if (op === "-" && b > a) {
      [a, b] = [b, a];
    }
  } else if (grade === 2) {
    // Cộng trừ trong phạm vi 100
    op = Math.random() < 0.5 ? "+" : "-";
    a = randInt(10, 100);
    b = randInt(1, 90);
    if (op === "-" && b > a) {
      [a, b] = [b, a];
    }
  } else if (grade === 3) {
    // Cộng, trừ, nhân, chia trong phạm vi 100
    const ops = ["+", "-", "×", "÷"];
    op = ops[randInt(0, ops.length - 1)];
    if (op === "×") {
      a = randInt(2, 12);
      b = randInt(2, 12);
    } else if (op === "÷") {
      b = randInt(2, 12);
      const q = randInt(2, 12);
      a = b * q;
    } else {
      a = randInt(20, 100);
      b = randInt(5, 80);
      if (op === "-" && b > a) {
        [a, b] = [b, a];
      }
    }
  } else if (grade === 4) {
    // Số có 3 chữ số, cộng trừ, nhân đơn giản
    const ops = ["+", "-", "×"];
    op = ops[randInt(0, ops.length - 1)];
    if (op === "×") {
      a = randInt(10, 99);
      b = randInt(2, 9);
    } else {
      a = randInt(100, 999);
      b = randInt(50, 800);
      if (op === "-" && b > a) {
        [a, b] = [b, a];
      }
    }
  } else {
    // Lớp 5: phép tính lớn hơn + chia hết
    const ops = ["+", "-", "×", "÷"];
    op = ops[randInt(0, ops.length - 1)];
    if (op === "×") {
      a = randInt(100, 999);
      b = randInt(2, 9);
    } else if (op === "÷") {
      b = randInt(2, 9);
      const q = randInt(10, 99);
      a = b * q;
    } else {
      a = randInt(200, 999);
      b = randInt(50, 500);
      if (op === "-" && b > a) {
        [a, b] = [b, a];
      }
    }
  }

  switch (op) {
    case "+":
      answer = a + b;
      question = `${a} + ${b} = ?`;
      explanation =
        "Cộng hai số: đặt thẳng hàng các chữ số, cộng từ phải sang trái, nhớ nếu tổng ≥ 10.";
      break;
    case "-":
      answer = a - b;
      question = `${a} - ${b} = ?`;
      explanation =
        "Trừ hai số: đặt thẳng hàng, nếu không đủ trừ thì mượn 1 chục ở hàng bên trái rồi tiếp tục trừ.";
      break;
    case "×":
      answer = a * b;
      question = `${a} × ${b} = ?`;
      explanation =
        "Nhân: lấy số thứ nhất nhân lần lượt với từng chữ số của số thứ hai, viết kết quả rồi cộng lại (nếu là nhân một chữ số thì chỉ cần nhân trực tiếp).";
      break;
    case "÷":
      answer = a / b;
      question = `${a} ÷ ${b} = ?`;
      explanation =
        "Chia: tìm số nhân với số chia để được số bị chia. Có thể dùng bảng cửu chương để tìm nhanh.";
      break;
    default:
      answer = a + b;
      question = `${a} + ${b} = ?`;
      explanation = "Cộng hai số tự nhiên đơn giản.";
  }

  return {
    question,
    answer: String(answer),
    explanation
  };
}

function buildIntroAndTips(grade) {
  let intro;
  let tips;

  switch (grade) {
    case 1:
      intro =
        "Bài học Toán lớp 1: Làm quen với các phép cộng và trừ đơn giản, giúp bé nhẩm nhanh trong phạm vi 20.";
      tips = [
        "Đọc to phép tính trước khi làm để bé quen với cách phát âm số.",
        "Có thể dùng que tính, đồ chơi, hoặc ngón tay để minh họa cho bé."
      ];
      break;
    case 2:
      intro =
        "Bài học Toán lớp 2: Luyện cộng trừ trong phạm vi 100, làm quen với nhớ và mượn.";
      tips = [
        "Nhắc bé viết các số thẳng cột: hàng đơn vị – chục – trăm.",
        "Giải chậm rãi từng bước, không thúc ép bé làm quá nhanh."
      ];
      break;
    case 3:
      intro =
        "Bài học Toán lớp 3: Luyện bốn phép tính cộng, trừ, nhân, chia với số trong phạm vi 100.";
      tips = [
        "Ôn lại bảng cửu chương trước khi làm bài nhân và chia.",
        "Khuyến khích bé tự kiểm tra lại kết quả bằng cách làm ngược lại (ví dụ: kiểm tra phép chia bằng phép nhân)."
      ];
      break;
    case 4:
      intro =
        "Bài học Toán lớp 4: Làm quen với các phép tính có 3 chữ số, rèn kỹ năng đặt tính và tính chính xác.";
      tips = [
        "Dạy bé kiểm tra lại kết quả bằng cách ước lượng: số kết quả khoảng bao nhiêu.",
        "Cho bé trình bày từng bước trên giấy, không chỉ viết đáp số."
      ];
      break;
    case 5:
      intro =
        "Bài học Toán lớp 5: Luyện tập các phép tính với số lớn hơn, chuẩn bị nền tảng lên cấp 2.";
      tips = [
        "Khuyến khích bé giải thích lại bằng lời: 'Con đã làm như thế nào?'.",
        "Tập cho bé thói quen kiểm tra lại bài bằng cách làm một phép thử nhanh."
      ];
      break;
    default:
      intro = "Bài học Toán tiểu học.";
      tips = [
        "Luôn động viên bé, tránh gây áp lực.",
        "Cho bé nghỉ giữa giờ nếu làm nhiều bài một lúc."
      ];
  }

  return { intro, tips };
}

server.registerTool(
  "get_primary_math_lesson",
  {
    title: "Bài học Toán tiểu học (lớp 1–5)",
    description:
      "Sinh tự động bài học + bộ câu hỏi luyện tập Toán cho học sinh tiểu học (lớp 1 đến lớp 5). Robot có thể dùng để giảng giải, hỏi – đáp, và chữa bài cho bé.",
    inputSchema: {
      grade: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe("Khối lớp: 1, 2, 3, 4 hoặc 5."),
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề mong muốn (ví dụ: 'cộng trong phạm vi 20', 'bảng cửu chương 2,3,4', 'chia có dư'...). Có thể bỏ trống."
        ),
      level: z
        .enum(["easy", "medium", "hard"])
        .default("easy")
        .describe("Độ khó: easy (dễ), medium (trung bình), hard (khó)."),
      numQuestions: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Số lượng câu hỏi/bài tập muốn sinh (1–20).")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      lesson: z
        .object({
          grade: z.number(),
          topic: z.string().optional(),
          level: z.string(),
          intro: z.string(),
          tips: z.array(z.string()),
          questions: z.array(
            z.object({
              id: z.number(),
              question: z.string(),
              answer: z.string(),
              explanation: z.string()
            })
          )
        })
        .optional()
    }
  },
  async ({ grade, topic, level, numQuestions }) => {
    const { intro, tips } = buildIntroAndTips(grade);
    const questions = [];

    const n = numQuestions || 5;
    for (let i = 0; i < n; i++) {
      const q = generateMathQuestion(grade, level);
      questions.push({
        id: i + 1,
        ...q
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã tạo bài học Toán tiểu học kèm bộ câu hỏi luyện tập. Robot có thể giải thích từng câu hỏi cho bé.",
      lesson: {
        grade,
        topic: topic || undefined,
        level: level || "easy",
        intro,
        tips,
        questions
      }
    });
  }
);

/* =================================================
 * 5) TOOL TRUYỆN / SÁCH QUỐC TẾ (NGUỒN LỚN, UY TÍN)
 * ================================================= */

// Một số nguồn quốc tế lớn:
// - Project Gutenberg: ebook miễn phí, public domain
// - Storynory: audio story cho trẻ em

const INTL_STORY_SOURCES = [
  "http://www.gutenberg.org/cache/epub/feeds/today.rss", // Sách mới từ Project Gutenberg
  "https://www.storynory.com/feeds/stories" // Audio stories cho trẻ em
];

server.registerTool(
  "get_international_stories",
  {
    title: "Truyện & sách quốc tế (nguồn lớn, nổi tiếng)",
    description:
      "Tìm truyện hay / sách hay từ các nguồn quốc tế lớn (Project Gutenberg, Storynory...). Nội dung được làm sạch HTML và chia nhỏ để robot có thể dịch sang tiếng Việt và đọc cho bé nghe.",
    inputSchema: {
      topic: z
        .string()
        .optional()
        .describe(
          "Chủ đề hoặc từ khóa (ví dụ: fairy tale, adventure, children, animal...). Dùng tiếng Anh sẽ lọc tốt hơn."
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
            source: z.string(),
            content: z.array(z.string()).optional()
          })
        )
        .optional()
    }
  },
  async ({ topic }) => {
    const topicLower = topic ? topic.toLowerCase() : null;
    const results = [];
    const seenTitles = new Set();

    for (const url of INTL_STORY_SOURCES) {
      try {
        const feed = await rss.parseURL(url);
        const items = feed.items || [];

        for (const item of items.slice(0, 5)) {
          const title = (item.title || "Untitled").trim();
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

          const sourceName = feed.title || "International Source";

          results.push({
            title,
            description: shortDesc,
            link,
            source: sourceName,
            content: parts
          });
        }
      } catch (err) {
        console.error("Lỗi đọc RSS (international story) từ", url, ":", err.message);
      }
    }

    if (results.length === 0) {
      return makeResult({
        success: false,
        message:
          "Không tìm thấy truyện quốc tế phù hợp. Hãy thử từ khóa tiếng Anh khác (ví dụ: children, fairy tale, adventure...)."
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy danh sách truyện/sách quốc tế. Robot có thể dịch sang tiếng Việt rồi đọc cho bé nghe.",
      stories: results
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
  console.log(`Vietnam Story & News MCP running at http://localhost:${port}/mcp`);
});
