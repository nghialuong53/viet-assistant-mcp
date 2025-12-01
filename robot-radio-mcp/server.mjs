// server.mjs
// Fake MCP server cho robot ESP32-C3 phát RADIO VIỆT NAM
// Dùng cho Render + imcp.pro
// Endpoint: POST /mcp/play

import express from "express";
import morgan from "morgan";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan("tiny"));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Danh sách radio (thay URL nếu có link thật)
const MUSIC_LIBRARY = {
  "radio_vov": [{ title: "VOV Giao Thông", url: "https://example.com/radio/vovgt.mp3" }],
  "radio_voh": [{ title: "VOH FM", url: "https://example.com/radio/voh.mp3" }],
  "default": [{ title: "Demo Radio", url: "https://example.com/radio/demo.mp3" }]
};

function makeRobotResponse_ok(tracks) {
  return {
    code: 0,
    msg: "ok",
    ts: Date.now(),
    data: tracks.map((t, i) => ({ id: i + 1, title: t.title, play_url: t.url }))
  };
}

// Endpoint chính
app.post("/mcp/play", (req, res) => {
  console.log("POST /mcp/play body:", req.body);
  const action = (req.body?.action || req.query?.action || "").toString().toLowerCase();
  const channel = (req.body?.channel || req.query?.channel || "").toString().toLowerCase();

  if (action.includes("radio") || channel) {
    const key = channel === "vov" ? "radio_vov" : channel === "voh" ? "radio_voh" : "radio_vov";
    const tracks = MUSIC_LIBRARY[key] || MUSIC_LIBRARY["default"];
    return res.json(makeRobotResponse_ok(tracks));
  }
  return res.json(makeRobotResponse_ok(MUSIC_LIBRARY["default"]));
});

app.get("/", (req, res) => res.send("OK - robot radio MCP server"));
app.listen(PORT, () => console.log(`Server MCP Radio VN đang chạy port ${PORT}`));
