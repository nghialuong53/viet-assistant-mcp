// index.mjs
// MCP server: Radio Việt Nam (2 tool)

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/* ------------------------------------------------
 * TẠO MCP SERVER
 * ------------------------------------------------ */
const server = new McpServer({
  name: "vn-radio-mcp",
  version: "1.0.0"
});

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

/* ------------------------------------------------
 * DANH SÁCH CÁC KÊNH RADIO
 * (anh muốn thì sau này chỉ cần thêm bớt ở đây)
 * ------------------------------------------------ */
const RADIO_CHANNELS = [
  {
    id: "vov1",
    name: "VOV1 - Thời sự Chính trị Tổng hợp",
    region: "toan-quoc",
    description:
      "Kênh thời sự, chính trị, tổng hợp của Đài Tiếng nói Việt Nam.",
    stream_url: "https://stream.mediatech.vn/vov1",
    homepage: "https://vov1.vov.gov.vn/"
  },
  {
    id: "vov-gt-hn",
    name: "VOV Giao Thông Hà Nội",
    region: "mien-bac",
    description:
      "Kênh VOV Giao Thông FM 91MHz – tin giao thông, đời sống đô thị khu vực Hà Nội.",
    stream_url: "https://stream.mediatech.vn/vovgt-hn",
    homepage: "https://vovgiaothong.vn/"
  },
  {
    id: "vov-gt-hcm",
    name: "VOV Giao Thông TP.HCM",
    region: "mien-nam",
    description:
      "Kênh VOV Giao Thông FM 91MHz – khu vực TP.HCM và lân cận.",
    stream_url: "https://stream.mediatech.vn/vovgt-hcm",
    homepage: "https://vovgiaothong.vn/"
  },
  {
    id: "voh-fm99-9",
    name: "VOH FM 99.9 MHz",
    region: "mien-nam",
    description:
      "Đài Tiếng nói Nhân dân TP.HCM – chương trình tổng hợp, giải trí, thông tin.",
    stream_url: "https://strm.voh.com.vn/fm99-9",
    homepage: "https://voh.com.vn/"
  },
  {
    id: "bbc-vietnamese",
    name: "BBC Tiếng Việt (podcast / radio)",
    region: "quoc-te",
    description:
      "Tin tức và phân tích của BBC Tiếng Việt (thường phát dạng podcast/audio).",
    stream_url: "https://podcasts.files.bbci.co.uk/p02pc9qm.rss",
    homepage: "https://www.bbc.com/vietnamese"
  }
];

/* ------------------------------------------------
 * TOOL 1: list_vn_radio
 * - Liệt kê các kênh, có thể lọc theo vùng hoặc từ khóa
 * ------------------------------------------------ */
server.registerTool(
  "list_vn_radio",
  {
    title: "Danh sách kênh radio Việt Nam",
    description:
      "Trả về danh sách kênh radio Việt Nam (VOV, VOH, BBC tiếng Việt...). Có thể lọc theo vùng hoặc từ khóa.",
    inputSchema: {
      region: z
        .string()
        .optional()
        .describe(
          "Vùng miền muốn lọc: 'toan-quoc', 'mien-bac', 'mien-nam', 'quoc-te'. Bỏ trống để lấy tất cả."
        ),
      search: z
        .string()
        .optional()
        .describe(
          "Từ khóa tìm kiếm trong tên kênh, ví dụ: 'giao thông', 'VOV', 'BBC'..."
        )
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
            region: z.string().optional(),
            stream_url: z.string().optional(),
            homepage: z.string().optional(),
            // play_url: gợi ý cho robot dùng để phát
            play_url: z.string().optional()
          })
        )
        .optional()
    }
  },
  async ({ region, search }) => {
    let list = RADIO_CHANNELS;

    if (region) {
      const r = region.toLowerCase();
      list = list.filter(
        (c) => (c.region || "").toLowerCase() === r
      );
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description || "").toLowerCase().includes(q)
      );
    }

    if (list.length === 0) {
      return makeResult({
        success: false,
        message:
          "Không tìm thấy kênh radio phù hợp với điều kiện lọc. Hãy thử lại với từ khóa hoặc vùng miền khác.",
        channels: []
      });
    }

    const mapped = list.map((c) => ({
      ...c,
      play_url: c.stream_url || c.homepage
    }));

    return makeResult({
      success: true,
      message:
        "Danh sách kênh radio Việt Nam. Hãy chọn 1 kênh (dựa trên 'id' hoặc 'name'), rồi gọi tool 'get_radio_stream' để lấy URL phát.",
      channels: mapped
    });
  }
);

/* ------------------------------------------------
 * TOOL 2: get_radio_stream
 * - Lấy URL phát cho 1 kênh (để robot gọi API audio)
 * ------------------------------------------------ */
server.registerTool(
  "get_radio_stream",
  {
    title: "Lấy URL phát trực tiếp của 1 kênh radio",
    description:
      "Nhận id kênh radio và trả về play_url/stream_url để client phát nhạc.",
    inputSchema: {
      id: z
        .string()
        .describe(
          "ID kênh radio, ví dụ: 'vov1', 'vov-gt-hn', 'vov-gt-hcm', 'voh-fm99-9', 'bbc-vietnamese'."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      channel: z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          region: z.string().optional(),
          stream_url: z.string().optional(),
          homepage: z.string().optional(),
          play_url: z.string().optional()
        })
        .optional()
    }
  },
  async ({ id }) => {
    const channel = RADIO_CHANNELS.find((c) => c.id === id);

    if (!channel) {
      return makeResult({
        success: false,
        message: `Không tìm thấy kênh radio với id = '${id}'. Hãy gọi 'list_vn_radio' để xem danh sách kênh hợp lệ.`
      });
    }

    const result = {
      ...channel,
      play_url: channel.stream_url || channel.homepage
    };

    return makeResult({
      success: true,
      message:
        "Đây là thông tin kênh radio. Client nên dùng 'play_url' hoặc 'stream_url' để phát audio.",
      channel: result
    });
  }
);

/* ------------------------------------------------
 * KHỞI ĐỘNG MCP SERVER (HTTP /mcp)
 * ------------------------------------------------ */
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send(
    "VN Radio MCP server is running. Use POST /mcp for MCP clients."
  );
});

app.get("/mcp", (req, res) => {
  res.send("MCP endpoint active. Clients should use POST /mcp.");
});

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000", 10);
app
  .listen(port, () => {
    console.log(
      `VN Radio MCP server running at http://localhost:${port}/mcp`
    );
  })
  .on("error", (error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
