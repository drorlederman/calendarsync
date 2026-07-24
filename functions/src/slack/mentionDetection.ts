export function isMention(text: string, slackUserId: string): boolean {
  return text.includes(`<@${slackUserId}>`);
}

export function isDirectMessage(channelType: string): boolean {
  return channelType === "im";
}
