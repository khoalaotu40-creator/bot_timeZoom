require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

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

  // 1. User tham gia kênh voice
  if (!oldState.channelId && newState.channelId) {
    const { error } = await supabase.from('voice_sessions').upsert({
      user_id: userId,
      channel_id: newState.channelId,
      joined_at: new Date().toISOString(),
    });

    if (error) console.error('Lỗi lưu session:', error.message);
  }

  // 2. User ngắt kết nối hoàn toàn khỏi kênh voice
  else if (oldState.channelId && !newState.channelId) {
    // Lấy thông tin session lúc vào
    const { data: session, error: fetchError } = await supabase
      .from('voice_sessions')
      .select('joined_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !session) return;

    // Xóa session đang hoạt động
    await supabase.from('voice_sessions').delete().eq('user_id', userId);

    const joinedAt = new Date(session.joined_at).getTime();
    const durationSeconds = Math.floor((Date.now() - joinedAt) / 1000);

    // Bỏ qua nếu vào/ra dưới 5 giây
    if (durationSeconds < 5) return;

    // Cộng dồn vào bảng tổng (gọi RPC Postgres đã tạo ở Bước 1)
    await supabase.rpc('add_voice_duration', {
      p_user_id: userId,
      p_seconds: durationSeconds,
    });

    // Gửi thông báo
    const channel = client.channels.cache.get(process.env.NOTIFY_CHANNEL_ID);
    if (channel) {
        try {
            await channel.send(
            `🔊 <@${userId}> đã rời phòng **${oldState.channel.name}** sau **${formatDuration(durationSeconds)}**.`
            );
        } catch (err) {
            console.error('Không thể gửi tin nhắn thông báo:', err.message);
        }
    }
  }
});

client.once('clientReady', () => {
  console.log(`Bot đã online: ${client.user.tag}`);
});





client.login(process.env.DISCORD_TOKEN);

const http = require('http');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot Discord dang hoat dong 24/7!\n');
}).listen(PORT, () => {
  console.log(`HTTP server dang lang nghe tai port ${PORT}`);
});