// index.mjs
// MCP server: chỉ phát các kênh radio Việt Nam (STDIO)

// Yêu cầu: Node >= 18

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ----------------------
// TẠO MCP SERVER
// ----------------------
const server = new McpServer({
  name: "vn-radio-mcp",
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

// ----------------------
// DỮ LIỆU CÁC KÊNH RADIO
// ----------------------
// Anh có thể thêm / sửa kênh sau này, chỉ cần giữ nguyên cấu trúc.
const RADIO_CHANNELS = [
  {
    id: "vov1",
    name: "VOV1 - Thời sự Chính trị Tổng hợp",
    description:
      "Kênh thời sự, chính trị, tổng hợp của Đài Tiếng nói Việt Nam.",
    page_url: "https://vov1.vov.gov.vn/",
    stream_url: "https://stream.mediatech.vn/vov1"
  },
  {
    id: "vov-gt-hn",
    name: "VOV Giao Thông Hà Nội",
    description:
      "VOV Giao Thông FM 91MHz – tin giao thông, đời sống đô thị Hà Nội.",
    page_url: "https://vovgiaothong.vn/",
    stream_url: "https://stream.mediatech.vn/vovgt-hn"
  },
  {
    id: "vov-gt-hcm",
    name: "VOV Giao Thông TP.HCM",
    description:
      "VOV Giao Thông khu vực TP.HCM, thông tin giao thông, đời sống đô thị.",
    page_url: "https://vovgiaothong.vn/",
    stream_url: "https://stream.mediatech.vn/vovgt-hcm"
  },
  {
    id: "vov3",
    name: "VOV3 - Âm nhạc Giải trí",
    description:
      "Kênh âm nhạc, giải trí của Đài Tiếng nói Việt Nam (thích hợp bật nhạc).",
    page_url: "https://vov3.vov.gov.vn/",
    stream_url: "https://stream.mediatech.vn/vov3"
  }
];

// ----------------------
// TOOL 1: list_vn_radio
// ----------------------
// Liệt kê danh sách kênh radio, có thể lọc theo id.
server.registerTool(
  "list_vn_radio",
  {
    title: "Danh sách kênh radio Việt Nam",
    description:
      "Trả về danh sách các kênh radio Việt Nam (VOV, VOV Giao Thông...). Nếu truyền id thì chỉ trả về một kênh.",
    inputSchema: {
      id: z
        .string()
        .optional()
        .describe(
          "ID kênh (ví dụ: vov1, vov-gt-hn, vov-gt-hcm, vov3). Bỏ trống để lấy tất cả."
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
            page_url: z.string().optional(),
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
      // play_url: để robot dùng làm URL phát audio (ưu tiên stream_url)
      play_url: c.stream_url || c.page_url
    }));

    return makeResult({
      success: true,
      message:
        "Danh sách kênh radio Việt Nam. Hãy dùng 'play_url' hoặc 'stream_url' để robot phát audio.",
      channels: mapped
    });
  }
);

// ----------------------
// TOOL 2: get_radio_stream
// ----------------------
// Lấy trực tiếp stream_url của 1 kênh (dùng khi đã biết id).
server.registerTool(
  "get_radio_stream",
  {
    title: "Lấy URL stream radio Việt Nam",
    description:
      "Nhận id kênh radio và trả về URL stream để robot có thể mở trực tiếp.",
    inputSchema: {
      id: z
        .string()
        .describe(
          "ID kênh radio (ví dụ: vov1, vov-gt-hn, vov-gt-hcm, vov3)."
        )
    },
    outputSchema: {
      success: z.boolean(),
      message: z.string(),
      id: z.string().optional(),
      name: z.string().optional(),
      stream_url: z.string().optional(),
      play_url: z.string().optional()
    }
  },
  async ({ id }) => {
    const ch = RADIO_CHANNELS.find((c) => c.id === id);

    if (!ch) {
      return makeResult({
        success: false,
        message: `Không tìm thấy kênh radio với id = ${id}.`
      });
    }

    return makeResult({
      success: true,
      message:
        "Đã lấy được URL stream. Hãy đưa 'play_url' / 'stream_url' cho robot để phát.",
      id: ch.id,
      name: ch.name,
      stream_url: ch.stream_url,
      play_url: ch.stream_url || ch.page_url
    });
  }
);

// ----------------------
// KHỞI ĐỘNG MCP (STDIO)
// ----------------------
async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);
  await transport.start();
}

main().catch((err) => {
  console.error("Lỗi MCP server:", err);
  process.exit(1);
});
