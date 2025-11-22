#!/usr/bin/env node

// LƯU Ý: Chỉ import từ root SDK, không dùng đường dẫn dist/server nữa
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/sdk";
import { z } from "@modelcontextprotocol/sdk/zod.js";
import { parseStringPromise } from "xml2js";

// ==============================
// CẤU HÌNH NGUỒN DỮ LIỆU
// ==============================

// 1) 5 báo Việt Nam
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

// 2) Xổ số miền Nam
const LOTTERY_RSS_SOUTH =
  process.env.LOTTERY_RSS_SOUTH || "https://xskt.me/rss/mien-nam";

// 3) Nguồn truyện
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
  "Lấy tin tức mới nhất từ 5 báo Việt Nam lớn (VnExpress, Tuổi Trẻ, Thanh Niên, Dân Trí, VietNamNet).",
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
      .describe("Giới hạn số tin trên mỗi nguồn (tạm thời chủ yếu dùng tat_ca)"),
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
// TOOL 2: Giá vàng, tỷ giá, crypto
// -------------------------------------------------

server.tool(
  "finance_overview",
  "Lấy nhanh tỷ giá USD/VND, một số tỷ giá khác, và giá một vài đồng crypto phổ biến (BTC, ETH, USDT).",
  {
    inputSchema: z
      .object({
        includeGold: z.boolean().default(true),
        includeForex: z.boolean().default(true),
        includeCrypto: z.boolean().default(true),
      })
      .describe("Mặc định lấy hết: tỷ giá, vàng (note), crypto."),
  },
  async ({ input }) => {
    const { includeGold, includeForex, includeCrypto } = input;

    const output = {
      forex: null,
      gold: null,
      crypto: null,
    };

    // Forex
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

    // Vàng – chỉ note trạng thái
    if (includeGold) {
      output.gold = {
        note:
          "Phiên bản hiện tại chưa kết nối API giá vàng trực tiếp. Model hãy nói rõ với người dùng nếu họ hỏi giá vàng.",
      };
    }

    // Crypto
    if (includeCrypto) {
      try {
        const ids = "bitcoin,ethereum,tether";
        const vs = "usd,vnd";
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}`;
        const data = await fetchJson(url);
        output.crypto = d
