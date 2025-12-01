📘 HƯỚNG DẪN TRIỂN KHAI ROBOT RADIO MCP

1️⃣ Giải nén file zip ra thư mục robot-radio-mcp-final

2️⃣ Tạo repo GitHub mới tên: robot-radio-mcp

3️⃣ Upload 2 file:
   - server.mjs
   - package.json

4️⃣ Truy cập https://render.com → đăng nhập → New → Web Service
   - Chọn repo robot-radio-mcp
   - Build command: để trống
   - Start command: npm start
   - Nhấn Create Web Service

5️⃣ Sau khi Render tạo xong, URL ví dụ:
   https://robot-radio-mcp.onrender.com

6️⃣ Kiểm tra: mở URL đó → thấy chữ
   OK - robot radio MCP server  ✅

7️⃣ Copy endpoint này dán vào imcp.pro:
   https://robot-radio-mcp.onrender.com/mcp/play

8️⃣ Khi robot gửi action: play_radio, server sẽ trả JSON có link radio Việt.

9️⃣ Nếu robot không phát:
   - Mở tab Logs trên Render → chụp ảnh log → gửi lại để hỗ trợ.
