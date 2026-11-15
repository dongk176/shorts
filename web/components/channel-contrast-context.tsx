"use client";
import { createContext, useContext } from "react";
import { channelContrastStyle, type ChannelContrastContextValue } from "@/lib/channel-contrast";
export const ChannelContrastContext = createContext<ChannelContrastContextValue | null>(null);
export function useChannelContrast(channel: Parameters<typeof channelContrastStyle>[1]) {
  return channelContrastStyle(useContext(ChannelContrastContext), channel);
}
