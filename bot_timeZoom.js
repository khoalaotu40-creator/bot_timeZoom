require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// --- 1. HỆ THỐNG GHI LOG DEBUG ĐẨY LÊN WEB ---
const recentLogs = [];
const MAX_LOGS = 50;

function addLog(message, type = 'INFO') {
  const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const logEntry = { timestamp, type, message };
  recentLogs.unshift(logEntry);
  if (recentLogs.length > MAX_LOGS) recentLogs.pop();
  console.log(`[${timestamp}] [${type}] ${message}`);
}

// --- 2. MỞ HTTP SERVER NGAY LẬP TỨC ĐỂ GIỮ RENDER SỐNG ---
const PORT = process.env.PORT || 3000;
let botInstance = null;

http.createServer((req, res) => {
  const isOnline = botInstance && botInstance.isReady();
  const botStatus = isOnline ? 'Online' : 'Offline / Đang kết nối...';
  const statusColor = isOnline ? '#22c55e' : '#ef4444';
  const botTag = botInstance?.user?.tag || 'Chưa đăng nhập';

  const logRows = recentLogs
    .map(
      (log) => `
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 8px 12px; color: #94a3b8; font-family: monospace;">${log.timestamp}</td>
        <td style="padding: 8px 12px; font-weight: bold; font-family: monospace; color: ${
          log.type === 'ERROR' || log.type === 'CRITICAL' ? '#ef4444' : log.type === 'SUCCESS' ? '#22c55e' : '#38bdf8'
        };">[${log.type}]</td>
        <td style="padding: 8px 12px;">${log.message}</td>
      </tr>`
    )
    .join('');

  const html = `
  <!DOCTYPE html>
  <html lang="vi">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Discord Bot Status & Logs</title>
    <meta http-equiv="refresh" content="5">
  </head>
  <body style="background-color: #0f172a; color: #f8fafc; font-family: sans-serif; margin: 0; padding: 24px;">
    <div style="max-width: 900px; margin: 0 auto;">
      <h2 style="margin-bottom: 8px;">Discord Voice Tracker Dashboard</h2>
      <p style="margin-top: 0; color: #94a3b8;">Trang tự động làm mới mỗi 5 giây</p>
      
      <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
        <div>Trạng thái Bot: <b style="color: ${statusColor};">${botStatus}</b></div>
        <div>Tên Bot: <b>${botTag}</b></div>
      </div>

      <h3 style="margin-bottom: 12px;">Nhật ký Debug gần nhất</h3>
      <div style="background-color: #1e293b; border-radius: 8px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
          <thead>
            <tr style="background-color: #334155; color: #cbd5e1;">
              <th style="padding: 10px 12px; width: 90px;">Giờ</th>
              <th style="padding: 10px 12px; width: 130px;">Loại</th>
              <th style="padding: 10px 12px;">Nội dung sự kiện</th>
            </tr>
          </thead>
          <tbody>
            ${logRows || '<tr><td colspan="3" style="padding: 16px; text-align: center; color: #64748b;">Chưa có log.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </body>
  </html>
  `;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(PORT, () => {
  addLog(`HTTP server debug đang mở tại port ${PORT}`, 'SERVER');
  initBot(); // Gọi khởi động bot sau khi web server đã mở thành công
});

// --- 3. HÀM KHỞI TẠO VÀ CHẠY BOT ---
async function initBot() {
  // Kiểm tra biến môi trường
  const token = process.env.DISCORD_TOKEN?.trim();
  const subUrl = process.env.SUPABASE_URL?.trim();
  const subKey = process.env.SUPABASE_KEY?.trim();
  const channelId = process.env.NOTIFY_CHANNEL_ID?.trim();

  addLog(`Kiểm tra biến DISCORD_TOKEN: ${token ? 'ĐÃ CÓ (' + token.slice(0, 10) + '...)' : 'CHƯA CÓ / RỖNG'}`, 'ENV_CHECK');
  addLog(`Kiểm tra biến SUPABASE_URL: ${subUrl ? 'ĐÃ CÓ' : 'CHƯA CÓ / RỖNG'}`, 'ENV_CHECK');
  addLog(`Kiểm tra biến NOTIFY_CHANNEL_ID: ${channelId ? channelId : 'CHƯA CÓ'}`, 'ENV_CHECK');

  if (!token) {
    addLog('DỪNG KHỞI ĐỘNG: Thiếu DISCORD_TOKEN trong Environment của Render.', 'CRITICAL');
    return;
  }

  let supabase = null;
  try {
    if (subUrl && subKey) {
      supabase = createClient(subUrl, subKey);
      addLog('Đã nạp Supabase Client thành công.', 'INFO');
    } else {
      addLog('CẢNH BÁO: Thiếu Supabase URL hoặc KEY, bot sẽ chạy không lưu db.', 'WARN');
    }
  } catch (e) {
    addLog(`Lỗi khởi tạo Supabase: ${e.message}`, 'ERROR');
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
    ],
  });
  botInstance = client;

  client.once('clientReady', () => {
    addLog(`Bot đã online thành công: ${client.user.tag}`, 'READY');
  });

  client.on('error', (err) => {
    addLog(`Lỗi kết nối Discord: ${err.message}`, 'ERROR');
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id;
    const username = newState.member?.user?.tag || userId;

    if (!oldState.channelId && newState.channelId) {
      addLog(`User ${username} vào phòng: ${newState.channel?.name || newState.channelId}`, 'VOICE_JOIN');
      if (supabase) {
        await supabase.from('voice_sessions').upsert({
          user_id: userId,
          channel_id: newState.channelId,
          joined_at: new Date().toISOString(),
        });
      }
    } else if (oldState.channelId && !newState.channelId) {
      addLog(`User ${username} rời phòng: ${oldState.channel?.name || oldState.channelId}`, 'VOICE_LEAVE');
      if (!supabase) return;

      const { data: session } = await supabase
        .from('voice_sessions')
        .select('joined_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (!session) return;
      await supabase.from('voice_sessions').delete().eq('user_id', userId);

      const durationSeconds = Math.floor((Date.now() - new Date(session.joined_at).getTime()) / 1000);
      if (durationSeconds < 5) return;

      await supabase.rpc('add_voice_duration', { p_user_id: userId, p_seconds: durationSeconds });

      const channel = client.channels.cache.get(channelId);
      if (channel) {
        const mins = Math.floor(durationSeconds / 60);
        const secs = durationSeconds % 60;
        channel.send(`🔊 <@${userId}> đã rời phòng thoại. Thời gian: **${mins > 0 ? mins + ' phút ' : ''}${secs} giây**.`);
      }
    }
  });

    addLog('Đang kết nối tới Discord Gateway...', 'INFO');
    
    const loginPromise = client.login(token);
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Hết thời gian chờ kết nối Gateway (Timeout sau 15s). Có thể do thiếu Intent hoặc IP Render bị hạn chế.')), 15000)
    );

    try {
        await Promise.race([loginPromise, timeoutPromise]);
    } catch (err) {
        addLog(`Đăng nhập Discord thất bại: ${err.message}`, 'CRITICAL');
    }
}