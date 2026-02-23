// Define shared attributes across chat instances and messages
export type UserMode = "human" | "ai";

export interface ChatRequest {
  mode: UserMode;
  interests: string[];
}

export interface ChatMessage {
  id: string;
  sender: "me" | "peer" | "system" | "ai";
  text: string;
  timestamp: number;
}

export interface ChatInstance {
  roomId: string;
  peerId: string;
  isAi: boolean;
}