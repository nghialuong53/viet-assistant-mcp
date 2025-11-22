#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "@modelcontextprotocol/sdk/zod.js";
import { parseStringPromise } from "xml2js";

// ==============================
// CẤU HÌNH NGUỒN DỮ LIỆU
// ==============================

// 1) 5 báo Việt Nam – có sẵn, không cần chỉnh.
//    Nếu sau này anh muốn đổi link RSS thì chỉ cần set ENV tương ứng.
const NEWS_SOURCES = [
  {
    name: "VnExpress",
    url: process.env.NEWS_VNEXPRESS_RSS || "https://vnexpress.net/rss/tin-moi-nhat.rss",
  },
  {
    name: "TuoiTre",
    url: process.env.NEWS_TUOITRE_RSS || "https://tuoitre.vn/rss/tin-moi-nhat.rss",
  },
  {
    name: "ThanhNien",
    url: process.env.NEWS_THANHNIEN_RSS || "https://thanhnien.vn/rss/home.rss",
  },
  {
    name: "DanTri",
    url: process.env.NEWS_DANTRI_RSS || "https://dantri.com.vn/rss/tin-moi-nhat.rss",
  },
  {
    name: "VietNamNet",
    url: process.env.NEWS_VIETNAMNET_RSS || "https://vietnamnet.vn/rss/tin-moi-nhat.rss",
  },
];

// 2) RSS xổ số miền Nam – mặc định dùng xskt.me.
//    Nếu sau này anh tìm được link RSS khác chuẩn hơn thì gán LOTTERY_RSS_SOUTH.
const LOTTERY_RSS_SOUTH =
  process.env.LOTTERY_RSS_SOUTH || "https://xskt.me/rss/mien-nam";

// 3) Một số trang truyện cổ tích (nếu có RSS).
//    Nếu không đọc được thì tool vẫn yêu cầu model tự bịa truyện.
const STORY_SOURCES = [
  process.env.STORY_SRC_1 || "https://truyencotich.vn/rss",
  process.env.STORY_SRC_2 || "https://truyenchobe.com/rss",
  process.env.STORY_SRC_3 || "https://truyenchobeyeu.com/rss",
  process.env.STORY_SRC_4 || "https://truyenngan.com.vn/rss",
  process.env.STORY_SRC_5 || "https://www.rfa.org/vietnamese/programs/ChildrenStory/story.rss",
];

// ==============================
// HÀM HỖ TRỢ
// ==============================

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch JSON lỗi: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fetch text lỗi: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// Parse RSS (XML) → danh sách item đơn giản
async function fetchRssItems(url, limit = 5) {
  try {
    const xml = await fetchText(url);
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    const channel = parsed?.rss?.channel;
    if (!channel) return [];

    let items = channel.item || [];
    if (!Array.isArray(items)) items = [items];

    return items.slice(0, limit).map((item) => ({
      title: item.title,
      link: item.link,
      description: item.description,
      pubDate: item.pubDate,
    }));
  } catch (err) {
    return [
      {
        title: `Không đọc được RSS: ${url}`,
        link: url,
        description: String(err),
        pubDate: null,
      },
    ];
  }
}

// ==============================
// KHỞI TẠO MCP SERVER
// ==============================

const server = new McpServer({
  name: "viet-assistant-mcp",
  version: "1.0.1",
});

// -------------------------------------------------
// TOOL 1: Tin tức mới từ 5 báo Việt Nam
// -------------------------------------------------

server.tool(
  "news_latest",
  "Lấy tin tức mới nhất từ 5 báo Việt Nam lớn (VnExpress, Tuổi Trẻ, Thanh Niên, Dân Trí, VietNamNet). Thích hợp khi người dùng nói: 'cập nhật tin tức mới nhất'",
  {
    inputSchema: z
      .object({
        limitPerSource: z.number().int().min(1).max(10).default(3),
        category: z
          .enum([
            "tat_ca",
            "thoi_su",
            "chinh_tri",
            "kinh_doanh",
            "cong_nghe",
            "bong_da",
            "the_thao",
            "du_lich",
            "giai_tri",
          ])
          .default("tat_ca"),
      })
      .describe("Tùy chọn giới hạn số tin và loại chủ đề (tạm thời chủ yếu dùng tat_ca)"),
  },
  async ({ input }) => {
    const { limitPerSource } = input;

    const results = [];
    for (const src of NEWS_SOURCES) {
      const items = await fetchRssItems(src.url, limitPerSource);
      results.push({
        source: src.name,
        rssUrl: src.url,
        items,
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              note:
                "Tin được lấy từ RSS báo Việt Nam. Model hãy tóm tắt và đọc lại cho người dùng bằng tiếng Việt dễ hiểu.",
              data: results,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// -------------------------------------------------
// TOOL 2: Giá vàng, tỷ giá, giá coins
// -------------------------------------------------

server.tool(
  "finance_overview",
  "Lấy nhanh tỷ giá USD/VND, một số tỷ giá khác, và giá một vài đồng crypto phổ biến (BTC, ETH, USDT). Giá vàng hiện tại chỉ mô tả trạng thái hỗ trợ, chưa có API vàng trực tiếp.",
  {
    inputSchema: z
      .object({
        includeGold: z.boolean().default(true),
        includeForex: z.boolean().default(true),
        includeCrypto: z.boolean().default(true),
      })
      .describe("Chọn phần muốn lấy. Mặc định lấy hết."),
  },
  async ({ input }) => {
    const { includeGold, includeForex, includeCrypto } = input;

    const output = {
      forex: null,
      gold: null,
      crypto: null,
    };

    // Forex – dùng open.er-api.com (không cần API key)
    if (includeForex) {
      try {
        const data = await fetchJson("https://open.er-api.com/v6/latest/USD");
        output.forex = {
          base: data.base_code,
          lastUpdate: data.time_last_update_utc,
          rates: {
            VND: data.rates.VND,
            EUR: data.rates.EUR,
            JPY: data.rates.JPY,
            GBP: data.rates.GBP,
            CNY: data.rates.CNY,
          },
        };
      } catch (err) {
        output.forex = { error: String(err) };
      }
    }

    // Giá vàng – tạm thời không gọi API bên ngoài để tránh lỗi key.
    // Robot sẽ nói rõ với anh là “chưa hỗ trợ giá vàng realtime”.
    if (includeGold) {
      output.gold = {
        note:
          "Phiên bản hiện tại chưa kết nối API giá vàng trực tiếp. Model hãy thông báo rõ cho người dùng khi được hỏi về giá vàng.",
      };
    }

    // Crypto – dùng CoinGecko simple/price (public, không cần key)
    if (includeCrypto) {
      try {
        const ids = "bitcoin,ethereum,tether";
        const vs = "usd,vnd";
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}`;
        const data = await fetchJson(url);
        output.crypto = data;
      } catch (err) {
        output.crypto = {
          error: "Không lấy được giá crypto (có thể do giới hạn hoặc thay đổi API).",
          detail: String(err),
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              note:
                "Model hãy tóm tắt lại cho người dùng bằng tiếng Việt: tỷ giá (nhất là VND), giá BTC/ETH/USDT. Với giá vàng hãy nói rõ rằng chưa có số liệu realtime nếu người dùng hỏi.",
              data: output,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// -------------------------------------------------
// TOOL 3: Kết quả xổ số Miền Nam 7 ngày trở lại
// -------------------------------------------------

server.tool(
  "lottery_south_history",
  "Đọc kết quả xổ số Miền Nam trong một số ngày gần đây dựa trên RSS (ví dụ xskt.me).",
  {
    inputSchema: z
      .object({
        days: z.number().int().min(1).max(7).default(7),
      })
      .describe("Số ngày gần đây muốn lấy, tối đa 7."),
  },
  async ({ input }) => {
    const { days } = input;

    const items = await fetchRssItems(LOTTERY_RSS_SOUTH, days);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              note:
                "Đây là các bản tin kết quả xổ số Miền Nam lấy từ RSS. Model hãy phân tích, đọc lại cho người dùng theo yêu cầu (ví dụ: đài nào, ngày nào, giải đặc biệt...). Nếu RSS bị lỗi hãy giải thích rõ cho người dùng.",
              rssUrl: LOTTERY_RSS_SOUTH,
              items,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// -------------------------------------------------
// TOOL 4: Kể chuyện cổ tích / truyện AI sáng tạo
// -------------------------------------------------

server.tool(
  "story_mix",
  "Kể chuyện cổ tích, chuyện thiếu nhi hoặc truyện sáng tạo theo chủ đề người dùng yêu cầu. Có thể tham khảo tiêu đề từ một số trang truyện.",
  {
    inputSchema: z
      .object({
        topic: z
          .string()
          .describe(
            "Chủ đề / nhân vật chính (ví dụ: 'cậu bé bán trà sữa robot', 'chuyện cổ tích về lòng tốt').",
          ),
        style: z
          .enum(["co_tich_viet_nam", "thieu_nhi_hai_huoc", "suy_ngam_cam_dong", "ngau_nhien"])
          .default("co_tich_viet_nam")
          .describe("Phong cách kể chuyện."),
        length: z
          .enum(["rat_ngan", "ngan", "vua", "dai"])
          .default("vua")
          .describe("Độ dài mong muốn."),
      })
      .describe("Thông tin để tạo truyện."),
  },
  async ({ input }) => {
    const { topic, style, length } = input;

    // Cố gắng đọc 1–2 RSS truyện để gợi ý tiêu đề / motip
    const storyHints = [];
    for (let i = 0; i < STORY_SOURCES.length; i++) {
      const url = STORY_SOURCES[i];
      try {
        const items = await fetchRssItems(url, 2);
        storyHints.push({
          source: url,
          titles: items.map((it) => it.title),
        });
      } catch {
        // nếu lỗi thì bỏ qua nguồn đó
      }
    }

    const promptForModel = {
      huong_dan_model:
        "Hãy dùng tiếng Việt, xưng 'tớ' / 'mình' với trẻ em cho thân thiện. Không chép nguyên văn bất kỳ truyện nào trên web, chỉ dùng tiêu đề / motip làm gợi ý rồi tự sáng tạo.",
      yeu_cau_nguoi_dung: {
        topic,
        style,
        length,
      },
      goi_y_tu_rss: storyHints,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(promptForModel, null, 2),
        },
      ],
    };
  },
);

// ==============================
// CHẠY SERVER QUA STDIO
// ==============================

const transport = new StdioServerTransport({ server });

transport
  .listen()
  .then(() => {
    console.error("viet-assistant-mcp server is running via stdio...");
  })
  .catch((err) => {
    console.error("Error starting MCP server:", err);
    process.exit(1);
  });
