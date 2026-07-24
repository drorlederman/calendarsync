import axios from "axios";

export async function getSlackChannelName(accessToken: string, channelId: string): Promise<string> {
  try {
    const { data } = await axios.get("https://slack.com/api/conversations.info", {
      params: { channel: channelId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!data.ok) return channelId;
    if (data.channel?.is_im) return "הודעה ישירה";
    return data.channel?.name ? `#${data.channel.name}` : channelId;
  } catch {
    return channelId;
  }
}

export async function getSlackUserName(accessToken: string, userId: string): Promise<string> {
  try {
    const { data } = await axios.get("https://slack.com/api/users.info", {
      params: { user: userId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!data.ok) return userId;
    return data.user?.real_name || data.user?.name || userId;
  } catch {
    return userId;
  }
}
