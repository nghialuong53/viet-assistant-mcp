// index.mjs
// MCP server: kể chuyện Việt Nam (1 tiện ích duy nhất)

import express from "express";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ----------------------
// TẠO MCP SERVER
// ----------------------
const server = new McpServer({
  name: "viet-story-mcp",
  version: "1.0.0"
});

function makeResult(output) {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

// ----------------------
// NGUỒN TRUYỆN VIỆT NAM
// ----------------------
const SOURCES = [
  "https://vnexpress.net/rss/giai-tri.rss",
