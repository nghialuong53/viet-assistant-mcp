// index.mjs
// MCP server: chi phat cac kenh radio Viet Nam (STDIO)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "vn-radio-mcp",
  version: "1.0.0"
});

function makeResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

const RADIO_CHANNELS = [
  {
    id: "vov1",
    name: "VOV1 - Thoi su Chinh tri",
    region: "Viet Nam",
    genre: "Thoi su",
    stream_url: "https://vovlive.vov.vn/kenh-thoi-su-chinh-tri-tong-hop-11",
    page_url: "https://vovlive.vov.vn/kenh-thoi-su-chinh-tri-tong-hop-11"
  },
  {
    id: "vov3",
    name: "VOV3 - Am nhac",
    region: "Viet Nam",
    genre: "Am nhac",
    stream_url: "https://vovlive.vov.vn/kenh-am-nhac-13",
    page_url: "https://vovlive.vov.vn/kenh-am-nhac-13"
  },
  {
    id: "vovgthn",
    name: "VOV Giao thong Ha Noi",
    region: "Viet Nam",
    genre: "Giao thong",
    stream_url: "https://vovlive.vov.vn/kenh-vov-giao-thong-ha-noi-15",
    page_url: "https://vovlive.vov.vn/kenh-vov-giao-thong-ha-noi-15"
  },
  {
    id: "vovgthcm",
    name: "VOV Giao thong TP.HCM",
    region: "Viet Nam",
    genre: "Giao thong",
    stream_url: "https://vovlive.vov.vn/kenh-vov-giao-thong-tp-ho-chi-minh-16",
    page_url: "https://vovlive.vov.vn/kenh-vov-giao-thong-tp-ho-chi-minh-16"
  },
  {
    id: "vohfm",
    name: "VOH FM 99.9MHz",
    region: "Viet Nam",
    genre: "Tong hop",
    stream_url: "https://www.voh.com.vn/radio/fm-99-9mhz-3.html",
    page_url: "https://www.voh.com.vn/radio/fm-99-9mhz-3.html"
  }
];

const ListRadioInputSchema = z.object({
  search: z.string().optional(),
  region: z.string().optional(),
  genre: z.string().optional()
});

const RadioChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  genre: z.string(),
  stream_url: z.string(),
  page_url: z.string()
});

const ListRadioOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  channels: z.array(RadioChannelSchema).optional()
});

const GetStreamInputSchema = z.object({
  id: z.string()
});

const GetStreamOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  channel: RadioChannelSchema.optional()
});

server.registerTool(
  "list_vn_radio",
  {
    title: "Danh sach kenh radio Viet Nam",
    description:
      "Tra ve danh sach cac kenh radio Viet Nam, co the loc theo tu khoa, khu vuc, the loai.",
    inputSchema: ListRadioInputSchema,
    outputSchema: ListRadioOutputSchema
  },
  async ({ search, region, genre }) => {
    let channels = RADIO_CHANNELS;

    if (region) {
      const r = region.toLowerCase();
      channels = channels.filter((c) => c.region.toLowerCase().includes(r));
    }

    if (genre) {
      const g = genre.toLowerCase();
      channels = channels.filter((c) => c.genre.toLowerCase().includes(g));
    }

    if (search) {
      const s = search.toLowerCase();
      channels = channels.filter(
        (c) =>
          c.id.toLowerCase().includes(s) ||
          c.name.toLowerCase().includes(s)
      );
    }

    if (channels.length === 0) {
      return makeResult({
        success: false,
        message:
          "Khong tim thay kenh phu hop. Thu tu khoa khac (vi du: giao thong, am nhac, thoi su...)."
      });
    }

    return makeResult({
      success: true,
      message: "Danh sach kenh radio Viet Nam.",
      channels
    });
  }
);

server.registerTool(
  "get_radio_stream",
  {
    title: "Lay URL phat radio",
    description:
      "Lay stream_url va page_url cua mot kenh radio theo id (de robot phat audio).",
    inputSchema: GetStreamInputSchema,
    outputSchema: GetStreamOutputSchema
  },
  async ({ id }) => {
    const ch = RADIO_CHANNELS.find(
      (c) => c.id.toLowerCase() === id.toLowerCase()
    );

    if (!ch) {
      return makeResult({
        success: false,
        message: "Khong tim thay kenh radio voi id nay."
      });
    }

    return makeResult({
      success: true,
      message: "Thong tin kenh radio.",
      channel: ch
    });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Loi MCP server:", err);
  process.exit(1);
});
