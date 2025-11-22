// index.mjs
// MCP server đa tiện ích cho Việt Nam:
// - 1) Thời tiết
// - 2) Tin tức
// - 3) Giá vàng / USD / crypto
// - 4) Xổ số
// - 5) Radio
// - 6) Podcast
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

// Hàm trả kết quả chuẩn MCP
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
 * 1. TOOL: THỜI TIẾT (Open-Meteo)
 * ------------------------------------------------- */

server.registerTool(
  "get_weather",
  {
    title: "Lấy thời tiết hiện tại",
    description:
      "Lấy nhiệt độ, gió, thời tiết hiện tại cho 1 địa điểm (ví dụ: 'Tay Ninh, Vietnam').",
    inputSchema: {
      location: z
        .string()
        .describe("Tên thành phố/khu vực, ví dụ: 'Ho Chi Minh', 'Tay Ninh, Vietnam'")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      location: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      temperatureC: z.number().optional(),
      windspeedKmh: z.number().optional(),
      weatherCode: z.number().optional(),
      weatherText: z.string().optional(),
      raw: z.any().optional()
    }
  },
  async ({ location }) => {
    try {
      const geoUrl =
        "https://geocoding-api.open-meteo.com/v1/search?name=" +
        encodeURIComponent(location) +
        "&count=1&language=vi&format=json";

      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) {
        return makeResult({
          success: false,
          message: "Không gọi được API geocoding (Open-Meteo)."
        });
      }
      const geo = await geoRes.json();
      if (!geo.results || geo.results.length === 0) {
        return makeResult({
          success: false,
          message: "Không tìm thấy địa điểm phù hợp."
        });
      }

      const place = geo.results[0];
      const { latitude, longitude, name, country } = place;

      const weatherUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current_weather=true&timezone=auto`;

      const wRes = await fetch(weatherUrl);
      if (!wRes.ok) {
        return makeResult({
          success: false,
          message: "Không gọi được API thời tiết (Open-Meteo)."
        });
      }
      const weather = await wRes.json();
      const current = weather.current_weather;

      const codeMap = {
        0: "Trời quang",
        1: "Ít mây",
        2: "Có mây",
        3: "Nhiều mây",
        45: "Sương mù",
        48: "Sương giá",
        51: "Mưa phùn nhẹ",
        53: "Mưa phùn vừa",
        55: "Mưa phùn to",
        61: "Mưa nhỏ",
        63: "Mưa vừa",
        65: "Mưa to",
        71: "Tuyết rơi nhẹ",
        73: "Tuyết rơi vừa",
        75: "Tuyết rơi dày",
        80: "Mưa rào nhẹ",
        81: "Mưa rào vừa",
        82: "Mưa rào to",
        95: "Dông",
        96: "Dông kèm mưa đá",
        99: "Dông rất mạnh kèm mưa đá"
      };

      const output = {
        success: true,
        message: "Lấy dữ liệu thời tiết thành công.",
        location: `${name}${country ? ", " + country : ""}`,
        latitude,
        longitude,
        temperatureC: current.temperature,
        windspeedKmh: current.windspeed,
        weatherCode: current.weathercode,
        weatherText: codeMap[current.weathercode] || "Không rõ",
        raw: current
      };

      return makeResult(output);
    } catch (err) {
      return makeResult({
        success: false,
        message: "Lỗi nội bộ khi lấy thời tiết: " + err.message
      });
    }
  }
);

/* -------------------------------------------------
 * 2. TOOL: TIN TỨC (RSS VnExpress)
 * ------------------------------------------------- */

const rssParser = new XMLParser({ ignoreAttributes: false });

server.registerTool(
  "get_news_headlines",
  {
    title: "Lấy tin tức mới nhất",
    description:
      "Lấy danh sách tiêu đề tin tức mới nhất từ RSS (hiện tại hỗ trợ VnExpress).",
    inputSchema: {
      source: z
        .enum(["vnexpress"])
        .default("vnexpress")
        .describe("Nguồn tin: hiện tại chỉ hỗ trợ 'vnexpress'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Số lượng bản tin muốn lấy (1-20).")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      source: z.string().optional(),
      items: z
        .array(
          z.object({
            title: z.string(),
            link: z.string(),
            publishedAt: z.string().optional(),
            description: z.string().optional()
          })
        )
        .optional(),
      raw: z.any().optional()
    }
  },
  async ({ source, limit }) => {
    try {
      let feedUrl;
      switch (source) {
        case "vnexpress":
        default:
          feedUrl = "https://vnexpress.net/rss/tin-moi-nhat.rss";
          break;
      }

      const res = await fetch(feedUrl);
      if (!res.ok) {
        return makeResult({
          success: false,
          message: "Không gọi được RSS feed."
        });
      }

      const xmlText = await res.text();
      const json = rssParser.parse(xmlText);
      const channel = json?.rss?.channel;
      let items = channel?.item || [];

      if (!Array.isArray(items)) {
        items = items ? [items] : [];
      }

      const mapped = items.slice(0, limit).map((item) => ({
        title: item.title || "",
        link: item.link || "",
        publishedAt: item.pubDate || "",
        description: item.description || ""
      }));

      return makeResult({
        success: true,
        message: "Lấy tin tức thành công.",
        source,
        items: mapped,
        raw: { channelTitle: channel?.title }
      });
    } catch (err) {
      return makeResult({
        success: false,
        message: "Lỗi nội bộ khi lấy tin tức: " + err.message
      });
    }
  }
);

/* -------------------------------------------------
 * 3. TOOL: GIÁ VÀNG, GIÁ USD, GIÁ TIỀN SỐ
 * ------------------------------------------------- */

server.registerTool(
  "get_market_summary",
  {
    title: "Giá vàng, USD, crypto",
    description:
      "Lấy giá vàng (XAU), tỷ giá USD/VND và giá một số crypto so với USD hoặc VND.",
    inputSchema: {
      baseFiat: z
        .string()
        .default("USD")
        .describe("Tiền tệ gốc để quy đổi, mặc định USD."),
      fiatSymbols: z
        .array(z.string())
        .default(["VND"])
        .describe("Danh sách tiền pháp định muốn lấy (ví dụ: ['VND'])."),
      cryptoSymbols: z
        .array(z.string())
        .default(["BTC", "ETH", "USDT"])
        .describe(
          "Danh sách mã crypto (BTC, ETH, USDT...) dùng chuẩn exchangerate.host."
        ),
      includeGold: z
        .boolean()
        .default(true)
        .describe("Có lấy giá vàng (XAU) hay không.")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      baseFiat: z.string().optional(),
      date: z.string().optional(),
      rates: z.record(z.number()).optional(),
      note: z.string().optional()
    }
  },
  async ({ baseFiat, fiatSymbols, cryptoSymbols, includeGold }) => {
    try {
      const symbols = [
        ...fiatSymbols,
        ...cryptoSymbols,
        ...(includeGold ? ["XAU"] : [])
      ];
      const url =
        "https://api.exchangerate.host/latest?base=" +
        encodeURIComponent(baseFiat) +
        "&symbols=" +
        encodeURIComponent(symbols.join(","));

      const res = await fetch(url);
      if (!res.ok) {
        return makeResult({
          success: false,
          message: "Không gọi được API exchangerate.host."
        });
      }

      const data = await res.json();
      if (!data || !data.rates) {
        return makeResult({
          success: false,
          message: "Dữ liệu trả về không hợp lệ."
        });
      }

      const noteParts = [];
      if (includeGold && data.rates["XAU"]) {
        noteParts.push(
          `Giá vàng: 1 ${baseFiat} = ${data.rates["XAU"]} XAU (vàng).`
        );
      }
      if (data.rates["VND"]) {
        noteParts.push(
          `Tỷ giá tham khảo: 1 ${baseFiat} ≈ ${data.rates["VND"]} VND.`
        );
      }

      return makeResult({
        success: true,
        message: "Lấy dữ liệu thị trường thành công.",
        baseFiat,
        date: data.date,
        rates: data.rates,
        note: noteParts.join(" ")
      });
    } catch (err) {
      return makeResult({
        success: false,
        message: "Lỗi nội bộ khi lấy giá thị trường: " + err.message
      });
    }
  }
);

/* -------------------------------------------------
 * 4. TOOL: XỔ SỐ (trả về link tra cứu)
 * ------------------------------------------------- */

server.registerTool(
  "get_lottery_portal",
  {
    title: "Link tra cứu kết quả xổ số",
    description:
      "Trả về link tra cứu kết quả xổ số 3 miền (Bắc, Trung, Nam) trên Minh Ngọc.",
    inputSchema: {
      region: z
        .enum(["mien-bac", "mien-trung", "mien-nam"])
        .default("mien-bac")
        .describe("mien-bac | mien-trung | mien-nam")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      region: z.string().optional(),
      url: z.string().optional()
    }
  },
  async ({ region }) => {
    let url;
    if (region === "mien-bac") {
      url = "https://www.minhngoc.net.vn/ket-qua-xo-so/mien-bac.html";
    } else if (region === "mien-trung") {
      url = "https://www.minhngoc.net.vn/ket-qua-xo-so/mien-trung.html";
    } else {
      url = "https://www.minhngoc.net.vn/ket-qua-xo-so/mien-nam.html";
    }

    return makeResult({
      success: true,
      message: "Đã trả về link tra cứu xổ số.",
      region,
      url
    });
  }
);

/* -------------------------------------------------
 * 5. TOOL: RADIO (get_radio_channels)
 * ------------------------------------------------- */

// Dữ liệu tĩnh radio
const RADIO_CHANNELS = [
  {
    id: "vov1",
    name: "VOV1 - Thời sự Chính trị Tổng hợp",
    description: "Kênh thời sự, chính trị, tổng hợp của Đài Tiếng nói Việt Nam.",
    page_url: "https://vov1.vov.gov.vn/",
    stream_url: "https://stream.mediatech.vn/vov1"
  },
  {
    id: "vov-gt-hn",
    name: "VOV Giao Thông Hà Nội",
    description: "Kênh VOV Giao Thông FM 91MHz – tin giao thông, đời sống đô thị.",
    page_url: "https://vovgiaothong.vn/",
    stream_url: "https://stream.mediatech.vn/vovgt-hn"
  },
  {
    id: "vov-gt-hcm",
    name: "VOV Giao Thông TP.HCM",
    description: "Kênh VOV Giao Thông khu vực TP.HCM.",
    page_url: "https://vovgiaothong.vn/",
    stream_url: "https://stream.mediatech.vn/vovgt-hcm"
  }
];

server.registerTool(
  "get_radio_channels",
  {
    title: "Danh sách kênh radio Việt Nam",
    description:
      "Trả về danh sách các kênh radio (VOV, VOV Giao Thông...) kèm play_url để client có thể tự phát.",
    inputSchema: {
      id: z
        .string()
        .optional()
        .describe("ID kênh radio (vov1, vov-gt-hn, vov-gt-hcm). Bỏ trống để lấy tất cả.")
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      channels: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            page_url: z.string(),
            stream_url: z.string().optional(),
            play_url: z.string().optional()
          })
        )
        .optional()
    }
  },
  async ({ id }) => {
    let channels = RADIO_CHANNELS;

    if (id) {
      channels = RADIO_CHANNELS.filter((c) => c.id === id);
      if (channels.length === 0) {
        return makeResult({
          success: false,
          message: `Không tìm thấy kênh radio với id = ${id}.`
        });
      }
    }

    const mapped = channels.map((c) => ({
      ...c,
      play_url: c.stream_url || c.page_url
    }));

    return makeResult({
      success: true,
      message:
        "Danh sách kênh radio. Nếu client hỗ trợ, hãy dùng 'play_url' hoặc 'stream_url' để phát audio.",
      channels: mapped
    });
  }
);

/* -------------------------------------------------
 * 6. TOOL: PODCAST (get_podcast_list)
 * ------------------------------------------------- */

const PODCAST_LIST = [
  {
    id: "vnexpress-hom-nay",
    name: "VnExpress Hôm Nay",
    description: "Podcast tổng hợp tin tức, phân tích thời sự của VnExpress.",
    page_url: "https://vnexpress.net/podcast/vnexpress-hom-nay",
    rss_url: "https://vnexpress.net/rss/podcast/vnexpress-hom-nay.rss"
  },
  {
    id: "vnexpress-diem-tin",
    name: "Điểm Tin - VnExpress",
    description: "Tóm tắt các tin nóng, quan trọng trong ngày.",
    page_url: "https://vnexpress.net/podcast/diem-tin",
    rss_url: "https://vnexpress.net/rss/podcast/diem-tin.rss"
  }
];

server.registerTool(
  "get_podcast_list",
  {
    title: "Danh sách podcast Việt Nam",
    description:
      "Trả về danh sách các kênh podcast (hiện tại là VnExpress) kèm play_url để client có thể phát.",
    inputSchema: {
      id: z
        .string()
        .optional()
        .describe(
          "ID podcast (vnexpress-hom-nay, vnexpress-diem-tin). Bỏ trống để lấy tất cả."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      podcasts: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            page_url: z.string(),
            rss_url: z.string().optional(),
            play_url: z.string().optional()
          })
        )
        .optional()
    }
  },
  async ({ id }) => {
    let podcasts = PODCAST_LIST;

    if (id) {
      podcasts = PODCAST_LIST.filter((p) => p.id === id);
      if (podcasts.length === 0) {
        return makeResult({
          success: false,
          message: `Không tìm thấy podcast với id = ${id}.`
        });
      }
    }

    const mapped = podcasts.map((p) => ({
      ...p,
      play_url: p.rss_url || p.page_url
    }));

    return makeResult({
      success: true,
      message:
        "Danh sách podcast. Nếu client hỗ trợ, hãy dùng 'play_url' để phát audio hoặc subscribe RSS.",
      podcasts: mapped
    });
  }
);

/* -------------------------------------------------
 * KHỞI ĐỘNG MCP SERVER (HTTP /mcp)
 * ------------------------------------------------- */

const app = express();
app.use(express.json());

// Trang test cho / (mở trên trình duyệt)
app.get("/", (req, res) => {
  res.send("Viet Assistant MCP server is running. Use POST /mcp for MCP clients.");
});

// Trang test cho /mcp với GET
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
    console.log(`Viet Assistant MCP server running at http://localhost:${port}/mcp`);
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
