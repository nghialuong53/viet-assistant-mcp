// index.mjs
// MCP server cho trợ lý tiếng Việt – CHỈ CÓ 4 TIỆN ÍCH:
// 1) Tin tức nhiều nguồn VN
// 2) Giá vàng, tỷ giá, giá coin
// 3) Xổ số miền Nam (7 ngày gần nhất)
// 4) Nguồn kể chuyện cổ tích & truyện sáng tạo
// Yêu cầu: Node >= 18 (có sẵn fetch).

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";

// Tạo MCP server
const server = new McpServer({
  name: "viet-assistant-mcp",
  version: "1.0.0"
});

// Hàm trả kết quả về cho LLM
function makeResult(output) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(output, null, 2)
      }
    ],
    structuredContent: output
  };
}

/* -------------------------------------------------
 * 1. TOOL: TIN TỨC NHIỀU NGUỒN VIỆT NAM
 * ------------------------------------------------- */

const xmlParser = new XMLParser({ ignoreAttributes: false });

// 5 báo lớn VN + nhiều chuyên mục
// (Nếu 1 feed lỗi, tool vẫn chạy với các feed còn lại)
const NEWS_FEEDS = [
  // VnExpress
  {
    id: "vnexpress-tin-moi",
    source: "VnExpress",
    category: "general",
    url: "https://vnexpress.net/rss/tin-moi-nhat.rss"
  },
  {
    id: "vnexpress-thoi-su",
    source: "VnExpress",
    category: "politics",
    url: "https://vnexpress.net/rss/thoi-su.rss"
  },
  {
    id: "vnexpress-kinh-doanh",
    source: "VnExpress",
    category: "business",
    url: "https://vnexpress.net/rss/kinh-doanh.rss"
  },
  {
    id: "vnexpress-so-hoa",
    source: "VnExpress",
    category: "technology",
    url: "https://vnexpress.net/rss/so-hoa.rss"
  },
  {
    id: "vnexpress-the-thao",
    source: "VnExpress",
    category: "sports",
    url: "https://vnexpress.net/rss/the-thao.rss"
  },
  {
    id: "vnexpress-bong-da",
    source: "VnExpress",
    category: "football",
    url: "https://vnexpress.net/rss/bong-da.rss"
  },
  {
    id: "vnexpress-oto-xe-may",
    source: "VnExpress",
    category: "auto",
    url: "https://vnexpress.net/rss/oto-xe-may.rss"
  },
  {
    id: "vnexpress-du-lich",
    source: "VnExpress",
    category: "travel",
    url: "https://vnexpress.net/rss/du-lich.rss"
  },
  {
    id: "vnexpress-giai-tri",
    source: "VnExpress",
    category: "entertainment",
    url: "https://vnexpress.net/rss/giai-tri.rss"
  },

  // Tuổi Trẻ
  {
    id: "tuoitre-tin-moi",
    source: "TuoiTre",
    category: "general",
    url: "https://tuoitre.vn/rss/tin-moi-nhat.rss"
  },
  {
    id: "tuoitre-kinh-doanh",
    source: "TuoiTre",
    category: "business",
    url: "https://tuoitre.vn/rss/kinh-doanh.rss"
  },
  {
    id: "tuoitre-the-thao",
    source: "TuoiTre",
    category: "sports",
    url: "https://tuoitre.vn/rss/the-thao.rss"
  },

  // Thanh Niên
  {
    id: "thanhnien-thoi-su",
    source: "ThanhNien",
    category: "politics",
    url: "https://thanhnien.vn/rss/thoi-su.rss"
  },
  {
    id: "thanhnien-kinh-doanh",
    source: "ThanhNien",
    category: "business",
    url: "https://thanhnien.vn/rss/kinh-doanh.rss"
  },

  // Dân Trí
  {
    id: "dantri-the-gioi",
    source: "DanTri",
    category: "general",
    url: "https://dantri.com.vn/rss.htm"
  },

  // Vietnamnet
  {
    id: "vietnamnet-cong-nghe",
    source: "Vietnamnet",
    category: "technology",
    url: "https://vietnamnet.vn/rss/cong-nghe.rss"
  }
];

const NEWS_CATEGORIES = [
  "all",
  "general",
  "politics",
  "business",
  "technology",
  "sports",
  "football",
  "auto",
  "travel",
  "entertainment"
];

server.registerTool(
  "get_vn_news",
  {
    title: "Tin tức Việt Nam nhiều nguồn",
    description:
      "Lấy tin tức mới nhất từ các báo lớn Việt Nam (VnExpress, Tuổi Trẻ, Thanh Niên, Dân Trí, Vietnamnet) theo chủ đề.",
    inputSchema: {
      category: z
        .enum(NEWS_CATEGORIES)
        .default("all")
        .describe(
          "Chủ đề: all, general, politics, business, technology, sports, football, auto, travel, entertainment."
        ),
      limitPerSource: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Số bài tối đa lấy từ mỗi nguồn (1–10).")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      category: z.string().optional(),
      items: z
        .array(
          z.object({
            title: z.string(),
            link: z.string(),
            publishedAt: z.string().optional(),
            description: z.string().optional(),
            source: z.string(),
            feedId: z.string(),
            category: z.string()
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
    const feeds =
      category === "all"
        ? NEWS_FEEDS
        : NEWS_FEEDS.filter((f) => f.category === category);

    if (feeds.length === 0) {
      return makeResult({
        success: false,
        message: "Không có feed nào cho chủ đề này."
      });
    }

    const items = [];
    const errors = [];

    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        try {
          const res = await fetch(feed.url);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const xml = await res.text();
          const json = xmlParser.parse(xml);
          const channel = json?.rss?.channel;
          let list = channel?.item || [];
          if (!Array.isArray(list)) list = list ? [list] : [];

          const mapped = list.slice(0, limitPerSource).map((it) => ({
            title: it.title || "",
            link: it.link || "",
            publishedAt: it.pubDate || "",
            description: it.description || "",
            source: feed.source,
            feedId: feed.id,
            category: feed.category
          }));

          items.push(...mapped);
        } catch (e) {
          errors.push({
            feedId: feed.id,
            source: feed.source,
            error: e.message || String(e)
          });
        }
      })
    );

    // sắp xếp sơ theo thời gian nếu có pubDate
    items.sort((a, b) => {
      const da = Date.parse(a.publishedAt || "") || 0;
      const db = Date.parse(b.publishedAt || "") || 0;
      return db - da;
    });

    return makeResult({
      success: true,
      message: "Đã lấy tin tức từ nhiều nguồn.",
      category,
      items,
      errors: errors.length ? errors : undefined
    });
  }
);

/* -------------------------------------------------
 * 2. TOOL: GIÁ VÀNG, TỶ GIÁ, GIÁ COIN
 * ------------------------------------------------- */

server.registerTool(
  "get_market_data",
  {
    title: "Giá vàng, tỷ giá, giá coin",
    description:
      "Lấy giá vàng (XAU), tỷ giá một số ngoại tệ so với VND và giá crypto (BTC, ETH, USDT) so với USD/VND.",
    inputSchema: {
      fiatBase: z
        .string()
        .default("VND")
        .describe("Tiền pháp định chính để quy đổi, mặc định VND."),
      forexSymbols: z
        .array(z.string())
        .default(["USD", "EUR", "JPY"])
        .describe("Danh sách mã ngoại tệ, ví dụ: ['USD','EUR','JPY']."),
      cryptoSymbols: z
        .array(z.string())
        .default(["BTC", "ETH", "USDT"])
        .describe("Các mã coin muốn lấy: BTC, ETH, USDT..."),
      includeGold: z
        .boolean()
        .default(true)
        .describe("Có lấy giá vàng (XAU) hay không.")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      date: z.string().optional(),
      fiatBase: z.string().optional(),
      gold: z
        .object({
          base: z.string(),
          quote: z.string(),
          rate: z.number()
        })
        .optional(),
      forexRates: z.record(z.number()).optional(),
      cryptoRatesUsd: z.record(z.number()).optional(),
      cryptoRatesBase: z.record(z.number()).optional()
    }
  },
  async ({ fiatBase, forexSymbols, cryptoSymbols, includeGold }) => {
    try {
      // Tỷ giá fiat (USD, EUR, JPY...) so với fiatBase (thường là VND)
      const forexUrl =
        "https://api.exchangerate.host/latest?base=" +
        encodeURIComponent(fiatBase) +
        "&symbols=" +
        encodeURIComponent(forexSymbols.join(","));

      const forexRes = await fetch(forexUrl);
      if (!forexRes.ok) {
        throw new Error("Không gọi được API forex.");
      }
      const forexData = await forexRes.json();

      // Giá vàng: 1 XAU -> fiatBase
      let gold = undefined;
      if (includeGold) {
        const goldUrl =
          "https://api.exchangerate.host/latest?base=XAU&symbols=" +
          encodeURIComponent(fiatBase);
        const goldRes = await fetch(goldUrl);
        if (goldRes.ok) {
          const goldData = await goldRes.json();
          const rate = goldData.rates?.[fiatBase];
          if (rate) {
            gold = {
              base: "XAU",
              quote: fiatBase,
              rate
            };
          }
        }
      }

      // Giá crypto: coi USDT ~ USD
      const cryptoRatesUsd = {};
      const cryptoRatesBase = {};

      for (const sym of cryptoSymbols) {
        const url =
          "https://api.exchangerate.host/latest?base=" +
          encodeURIComponent(sym) +
          "&symbols=USD," +
          encodeURIComponent(fiatBase);
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const r = data.rates || {};
        if (typeof r["USD"] === "number") {
          cryptoRatesUsd[sym] = r["USD"];
        }
        if (typeof r[fiatBase] === "number") {
          cryptoRatesBase[sym] = r[fiatBase];
        }
      }

      return makeResult({
        success: true,
        message: "Đã lấy dữ liệu thị trường (vàng, forex, crypto).",
        date: forexData.date,
        fiatBase,
        gold,
        forexRates: forexData.rates || {},
        cryptoRatesUsd: Object.keys(cryptoRatesUsd).length ? cryptoRatesUsd : undefined,
        cryptoRatesBase:
          Object.keys(cryptoRatesBase).length ? cryptoRatesBase : undefined
      });
    } catch (err) {
      return makeResult({
        success: false,
        message: "Lỗi khi lấy dữ liệu thị trường: " + err.message
      });
    }
  }
);

/* -------------------------------------------------
 * 3. TOOL: XỔ SỐ MIỀN NAM (7 NGÀY)
 * ------------------------------------------------- */

server.registerTool(
  "get_lottery_mien_nam",
  {
    title: "Kết quả xổ số miền Nam (tối đa 7 ngày gần nhất)",
    description:
      "Trả về danh sách link tra cứu kết quả xổ số miền Nam cho N ngày gần nhất (1–7). Client có thể đọc nội dung và đọc lại cho người dùng.",
    inputSchema: {
      days: z
        .number()
        .int()
        .min(1)
        .max(7)
        .default(1)
        .describe("Số ngày gần nhất muốn xem (1–7). 1 = hôm nay/gần nhất."),
      today: z
        .string()
        .optional()
        .describe(
          "Ngày gốc định dạng YYYY-MM-DD (nếu bỏ trống thì dùng ngày hiện tại của server)."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      days: z.number().optional(),
      entries: z
        .array(
          z.object({
            date: z.string(),
            url: z.string(),
            status: z.string().optional()
          })
        )
        .optional()
    }
  },
  async ({ days, today }) => {
    try {
      const baseDate = today ? new Date(today) : new Date();
      const entries = [];

      for (let i = 0; i < days; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() - i);

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");

        // Mẫu URL Minh Ngọc cho miền Nam theo ngày
        const url = `https://www.minhngoc.net.vn/ket-qua-xo-so/mien-nam/${yyyy}-${mm}-${dd}.html`;

        let status = "unknown";
        try {
          const res = await fetch(url);
          status = res.ok ? "ok" : `http_${res.status}`;
        } catch (e) {
          status = "fetch_error";
        }

        entries.push({
          date: `${yyyy}-${mm}-${dd}`,
          url,
          status
        });
      }

      return makeResult({
        success: true,
        message:
          "Đã tạo danh sách link kết quả xổ số miền Nam cho N ngày gần nhất. Client có thể mở link theo ngày người dùng yêu cầu và đọc lại kết quả.",
        days,
        entries
      });
    } catch (err) {
      return makeResult({
        success: false,
        message: "Lỗi khi lấy danh sách xổ số: " + err.message
      });
    }
  }
);

/* -------------------------------------------------
 * 4. TOOL: NGUỒN KỂ CHUYỆN CỔ TÍCH & TRUYỆN SÁNG TẠO
 * ------------------------------------------------- */

// 5 nguồn truyện (cổ tích / thiếu nhi / tổng hợp) nhiều người dùng
const STORY_SOURCES = [
  {
    id: "kho-tang-co-tich",
    name: "Kho tàng truyện cổ tích Việt Nam",
    type: "fairy_tale",
    url: "https://truyencotich.vn/",
    note: "Kho truyện cổ tích Việt Nam và thế giới."
  },
  {
    id: "truyen-co-tich-vn",
    name: "Truyện cổ tích VN",
    type: "fairy_tale",
    url: "https://khotruyencotich.com/",
    note: "Tổng hợp nhiều truyện cổ tích quen thuộc."
  },
  {
    id: "truyen-cho-be",
    name: "Truyện cho bé",
    type: "kids_story",
    url: "https://truyenchobe.com/",
    note: "Truyện thiếu nhi, truyện kể cho bé trước khi ngủ."
  },
  {
    id: "sach-hay-online",
    name: "Sách Hay Online - Truyện ngắn",
    type: "short_story",
    url: "https://sachhayonline.com/tua-sach/truyen-ngan.43/",
    note: "Nhiều truyện ngắn hiện đại, có thể dùng làm chất liệu sáng tác."
  },
  {
    id: "vnexpress-gia-dinh",
    name: "VnExpress - Góc gia đình & chuyện kể",
    type: "mixed",
    url: "https://vnexpress.net/gia-dinh",
    note: "Nhiều câu chuyện đời sống, cảm hứng để AI sáng tạo thêm."
  }
];

server.registerTool(
  "get_story_sources",
  {
    title: "Nguồn kể chuyện cổ tích & truyện sáng tạo",
    description:
      "Trả về danh sách các trang web truyện cổ tích / truyện ngắn phổ biến để trợ lý dùng làm cảm hứng kể chuyện hoặc phong cách tham khảo.",
    inputSchema: {
      type: z
        .enum(["all", "fairy_tale", "kids_story", "short_story", "mixed"])
        .default("all")
        .describe("Lọc theo loại truyện: all, fairy_tale, kids_story, short_story, mixed.")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      type: z.string().optional(),
      sources: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            url: z.string(),
            note: z.string().optional()
          })
        )
        .optional(),
      suggestion: z.string().optional()
    }
  },
  async ({ type }) => {
    const filtered =
      type === "all"
        ? STORY_SOURCES
        : STORY_SOURCES.filter((s) => s.type === type);

    const suggestion =
      "Hãy chọn 1 nguồn phù hợp, sau đó tạo ra câu chuyện cổ tích hoặc truyện ngắn mới, mang phong cách, không sao chép nguyên văn. Kể lại cho người dùng bằng tiếng Việt tự nhiên, sinh động.";

    return makeResult({
      success: true,
      message: "Đã trả về danh sách nguồn truyện để AI dựa vào và sáng tạo.",
      type,
      sources: filtered,
      suggestion
    });
  }
);

/* -------------------------------------------------
 * KHỞI ĐỘNG MCP SERVER (HTTP /mcp)
 * ------------------------------------------------- */

const app = express();
app.use(express.json());

// Test GET /
app.get("/", (req, res) => {
  res.send("Viet Assistant MCP (4 tools) is running. Use POST /mcp for MCP clients.");
});

// Test GET /mcp
app.get("/mcp", (req, res) => {
  res.send("MCP endpoint is alive. Clients should use POST /mcp.");
});

// Endpoint chính cho MCP: POST /mcp
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Lắng nghe
const port = parseInt(process.env.PORT || "3000", 10);
app
  .listen(port, () => {
    console.log(`Viet Assistant MCP server (4 tools) running at http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
