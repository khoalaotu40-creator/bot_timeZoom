require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// --- HỆ THỐNG GHI LOG DEBUG ĐẨY LÊN HTTP ---
const recentLogs = [];
const MAX_LOGS = 50;

function addLog(message, type = 'INFO') {
  const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const logEntry = { timestamp, type, message };
  recentLogs.unshift(logEntry); // Đẩy log mới nhất lên đầu danh sách
  if (recentLogs.length > MAX_LOGS) recentLogs.pop();
  console.log(`[${timestamp}] [${type}] ${message}`);
}

// Khởi tạo Supabase Client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} giờ`);
  if (minutes > 0) parts.push(`${minutes} phút`);
  parts.push(`${secs} giây`);
  return parts.join(' ');
}

client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.id;
  const username = newState.member?.user?.tag || userId;

  // 1. User tham gia kênh voice
  if (!oldState.channelId && newState.channelId) {
    addLog(`User ${username} tham gia phòng: ${newState.channel?.name || newState.channelId}`, 'VOICE_JOIN');

    const { error } = await supabase.from('voice_sessions').upsert({
      user_id: userId,
      channel_id: newState.channelId,
      joined_at: new Date().toISOString(),
    });

    if (error) {
      addLog(`Lỗi lưu session vào Supabase: ${error.message}`, 'ERROR');
    }
  }

  // 2. User ngắt kết nối hoàn toàn khỏi kênh voice
  else if (oldState.channelId && !newState.channelId) {
    addLog(`User ${username} rời phòng: ${oldState.channel?.name || oldState.channelId}`, 'VOICE_LEAVE');

    const { data: session, error: fetchError } = await supabase
      .from('voice_sessions')
      .select('joined_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) {
      addLog(`Lỗi đọc session của ${username}: ${fetchError.message}`, 'ERROR');
      return;
    }

    if (!session) {
      addLog(`Không tìm thấy session bắt đầu của user ${username}`, 'WARN');
      return;
    }

    // Xóa session đang hoạt động
    await supabase.from('voice_sessions').delete().eq('user_id', userId);

    const joinedAt = new Date(session.joined_at).getTime();
    const durationSeconds = Math.floor((Date.now() - joinedAt) / 1000);

    // Bỏ qua nếu dưới 5 giây
    if (durationSeconds < 5) {
      addLog(`User ${username} ở phòng dưới 5s (${durationSeconds}s) -> Bỏ qua.`, 'INFO');
      return;
    }

    // Cộng dồn vào bảng tổng
    const { error: rpcError } = await supabase.rpc('add_voice_duration', {
      p_user_id: userId,
      p_seconds: durationSeconds,
    });

    if (rpcError) {
      addLog(`Lỗi cộng dồn thời gian Supabase: ${rpcError.message}`, 'ERROR');
    } else {
      addLog(`Đã ghi nhận +${durationSeconds}s cho user ${username}`, 'SUCCESS');
    }

    // Gửi thông báo đến Discord text channel
    const channel = client.channels.cache.get(process.env.NOTIFY_CHANNEL_ID);
    if (channel) {
      try {
        await channel.send(
          `🔊 <@${userId}> đã rời phòng **${oldState.channel.name}** sau **${formatDuration(durationSeconds)}**.`
        );
        addLog(`Đã gửi thông báo đến kênh #${channel.name}`, 'DISCORD');
      } catch (err) {
        addLog(`Lỗi gửi tin nhắn thông báo Discord: ${err.message}`, 'ERROR');
      }
    } else {
      addLog(`Không tìm thấy kênh thông báo ID: ${process.env.NOTIFY_CHANNEL_ID}`, 'WARN');
    }
  }
});

client.once('clientReady', () => {
  addLog(`Bot đã online thành công: ${client.user.tag}`, 'READY');
});

// Bắt lỗi không mong muốn để tránh sập server
process.on('unhandledRejection', (err) => {
  addLog(`Unhandled Rejection: ${err?.message || err}`, 'ERROR');
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  addLog(`Đăng nhập Discord thất bại: ${err.message}`, 'CRITICAL');
});

// --- HTTP SERVER HIỂN THỊ DASHBOARD LOGS TRÊN WEB RENDER ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  const botStatus = client.isReady() ? 'Online' : 'Offline / Đang kết nối...';
  const statusColor = client.isReady() ? '#22c55e' : '#ef4444';

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
    <meta http-equiv="refresh" content="10"> <!-- Tự động refresh sau mỗi 10 giây -->
  </head>
  <body style="background-color: #0f172a; color: #f8fafc; font-family: sans-serif; margin: 0; padding: 24px;">
    <div style="max-width: 900px; margin: 0 auto;">
      <h2 style="margin-bottom: 8px;">Discord Voice Tracker Dashboard</h2>
      <p style="margin-top: 0; color: #94a3b8;">Trang tự động làm mới mỗi 10 giây</p>
      
      <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
        <div>Trạng thái Bot: <b style="color: ${statusColor};">${botStatus}</b></div>
        <div>Tên Bot: <b>${client.user ? client.user.tag : 'Chưa đăng nhập'}</b></div>
      </div>

      <h3 style="margin-bottom: 12px;">Nhật ký Debug gần nhất (Tối đa 50 sự kiện)</h3>
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
            ${logRows || '<tr><td colspan="3" style="padding: 16px; text-align: center; color: #64748b;">Chưa có log nào được ghi nhận.</td></tr>'}
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
});