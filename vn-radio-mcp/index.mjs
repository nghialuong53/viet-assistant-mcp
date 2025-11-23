// index.mjs
// MCP server: Radio Việt Nam – hỗ trợ cả STDIO & Streamable HTTP

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ----------------------
// TẠO MCP SERVER
// ----------------------
const server = new McpServer({
  name: "vn-radio-mcp",
  version: "1.0.0"
});

function makeResult(output) {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

// ----------------------
// DANH SÁCH KÊNH RADIO
// (anh có thể thêm/bớt cho phù hợp)
// ----------------------
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
    description: "VOV Giao Thông FM 91MHz – giao thông & đời sống đô thị.",
    page_url: "https://vovgiaothong.vn/",
    stream_url: "https://stream.mediatech.vn/vovgt-hn"
  },
  {
    id: "vov-gt-hcm",
    name: "VOV Giao Thông TP.HCM",
    description: "VOV Giao Thông khu vực TP.HCM.",
    page_url: "https://vovgiaothong.vn/",
    stream_url: "https://stream.mediatech.vn/vovgt-hcm"
  }
  // Anh muốn thêm VOH, HTV,… thì add thêm object ở đây
];

// ----------------------
// TOOL: get_radio_channels
// ----------------------
server.registerTool(
  "get_radio_channels",
  {
    title: "Danh sách kênh radio Việt Nam",
    description:
      "Trả về danh sách các kênh radio Việt Nam kèm play_url để client có thể tự phát.",
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
            // Quan trọng: client nên dùng play_url/stream_url để phát
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
        "Danh sách kênh radio. Nếu client hỗ trợ audio, hãy dùng 'play_url' hoặc 'stream_url' để phát.",
      channels: mapped
    });
  }
);

// ----------------------
// HÀM MAIN: CHỌN STDIO HOẶC HTTP
// ----------------------
async function main() {
  // MCP_MODE=stdio hoặc truyền tham số: node index.mjs stdio
  const mode = process.env.MCP_MODE || process.argv[2] || "http";

  if (mode === "stdio") {
    // ---- CHẾ ĐỘ STDIO (dùng cho imcp: From Git Repo + Mode: STDIO) ----
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await transport.start();
    return;
  }

  // ---- CHẾ ĐỘ HTTP (dùng cho Render + imcp: Streamable HTTP) ----
  const app = express();
  app.use(express.json());

  app.get("/", (req, res) => {
    res.send("VN Radio MCP server is running. Use POST /mcp for MCP clients.");
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
      console.log(`VN Radio MCP running at http://localhost:${port}/mcp (mode=http)`);
    })
    .on("error", (error) => {
      console.error("Server error:", error);
      process.exit(1);
    });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
