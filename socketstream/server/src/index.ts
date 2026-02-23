import { ChatRequest, ChatInstance, ChatMessage } from "shared";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv"

dotenv.config()

if (!process.env.GEMINI_API_KEY) {
  console.error("[Error] Missing Gemini API key in env file")
  process.exit(1);
}

// Initialize Gemini chatbot
const genAI = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY
});

/**
 * Gemini calling function with exponential backoff
 * @param history text prompt from user alongside chat history
 * @param retries number of attempts to retry chat API call 
 * @param delay base delay time for backoff
 */
async function callGeminiRetry(history: any[], retries = 3, delay = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: history,
        config: {
          systemInstruction: "You are a friendly, concise AI agent chatting with a user on a video chat platform called SocketStream. Keep responses conversational and under 3 sentences. Do not use markdown.",
          maxOutputTokens: 500,
        }
      });

      if (!res.text) {
        throw new Error("Empty response");
      }
      return res.text;
    }
    catch (error: any) {
      const msg = error?.message || "";
      // On failure of Gemini API request being processed due to server failure, rate limits, etc.
      if (attempt < retries && (msg.includes("503") || msg.includes("500") || msg.includes("429"))) {
        // Exponential backoff for retries
        console.warn(`[AI] Network issue with Gemini API (Attempt ${attempt}). Retrying in ${delay * Math.pow(2, attempt)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
      }
      else {
        console.error("[AI] Final generation attempt failed: ", error);
        throw error;
      }
    }
  }
  return "I'm having trouble connecting to Gemini right now.";
}

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from local client
    methods: ["GET", "POST"]
  },
});

/**
 * Matchmkaing queue that holds all users waiting for TCP/UDP handshake
 */
interface QueuedUser {
  id: string;
  interests: string[];
}

// Global state for user with dynamic array of users
let waitingQueue: QueuedUser[] = [];

io.on("connection", (socket: Socket) => {
  console.log(`[TCP] Connection established: ${socket.id}`);

  // 1) Define and route chat connection type
  socket.on("join_mode", (request: ChatRequest) => {

    // Sanitize state by removing user from queue if they repeatedly click next user
    waitingQueue = waitingQueue.filter(user => user.id !== socket.id);

    // A) Started ai chat without queue, instant match
    if (request.mode === "ai") {
      console.log(`User ${socket.id} joined AI chat`);

      const chatData: ChatInstance = {
        roomId: `ai_${socket.id}`,
        peerId: "ai-agent",
        isAi: true,
      };
      
      // AI chat Logic handled in server as initiator, new object with all 4 attributes
      socket.emit("match_found", { ...chatData, initiator: true });
      return;
    } 

    // B) Started p2p chat
    else {
      console.log(`[Matchmaking] User ${socket.id} joined human queue with tags: [${request.interests.join(", ")}]`);

      let matchedIndex = -1;
      const userTags = request.interests || [];

      // Linear scan O(n) through queue to find compatible partner
      for (let i = 0; i < waitingQueue.length; i++) {
        const potentialMatch = waitingQueue[i];

        if (potentialMatch) {
          // Completely random match without tags
          if (userTags.length === 0 && potentialMatch.interests.length === 0) {
            matchedIndex = i;
            break;
          }
          // Array intersection to check if tags overlap in O(m*k)
          if (userTags.length > 0 && potentialMatch.interests.length > 0) {
            const hasCommonTag = userTags.some(tag => potentialMatch.interests.includes(tag));
            if (hasCommonTag) {
              matchedIndex = i;
              break;
            }
          }
        }
      }

      // Check if user match found with updated matchedIndex
      if (matchedIndex != -1) {
        // Assign new partner id to user found
        const partner = waitingQueue.splice(matchedIndex, 1)[0];
        const partnerId = partner ? partner.id : "";

        const roomId = `room_${partnerId}_${socket.id}`;

        // Both sockets join private TCP room
        socket.join(roomId);
        io.sockets.sockets.get(partnerId)?.join(roomId);

        // Notify partner to be initiator that creates WebRTC offer
        const partnerMatch: ChatInstance = {
          roomId: roomId,
          peerId: socket.id,
          isAi: false,
        };
        io.to(partnerId).emit("match_found", { ...partnerMatch, initiator: true });

        // Notify self to be receiver waiting for WebRTC offer
        const selfMatch: ChatInstance = {
          roomId: roomId,
          peerId: partnerId,
          isAi: false,
        };
        socket.emit("match_found", { ...selfMatch, initiator: false });

        console.log(`[Matchmaking] Successful: ${socket}`)
      }
      // No user match found so queue empty or no tag overlaps
      else {
        waitingQueue.push({ id: socket.id, interests: userTags });
        socket.emit("waiting_in_queue");
        console.log(`[Matchmaking] User ${socket.id} added to queue`);
      }
    }
  });

  // 2) Signaling server to establish connection handshakes
  socket.on("signal", (data) => {
    // data = { target: string, signal: any }
    console.log(`[Signaling] Relayed from ${socket.id} to ${data.target}`);

    io.to(data.target).emit("signal_received", {
      signal: data.signal,
      from: socket.id,
    });
  });

  // 3a) Handle explicitly leaves (Stop or Next button)
  socket.on("leave_chat", () => {
    waitingQueue = waitingQueue.filter(user => user.id !== socket.id);

    // Broadcast that peer is leaving current room
    socket.rooms.forEach(room => {
      // In all rooms except personal default room
      if (room !== socket.id) {
        socket.to(room).emit("peer_disconnected");
        socket.leave(room); // Remove peer from socket.io room
      }
    });
    console.log(`[TCP] User ${socket.id} left chat`)
  });

  // 3b) Cleanup connection of user that refreshes/disconnects/leaves
  socket.on("disconnecting", () => {
    // Filter disconnected user to prevent matching with nonexistent users
    waitingQueue = waitingQueue.filter(user => user.id !== socket.id);
    
    // Broadcast to peers that user dropped off internet
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        socket.to(room).emit("peer_disconnected");
      }
    });
    console.log(`[TCP] Disconnected: ${socket.id}`);
  });

  // 4) Send message that is directed to ai or human peer
  socket.on("send_message", async (data: { roomId: string, text: string, isAi: boolean, history?: any[] }) => {
    // a) Talking to AI
    if (data.isAi) {
      try {
        // Pass history array with messages
        const resText = await callGeminiRetry(data.history || []);

        const aiRes: ChatMessage = {
          id: Math.random().toString(36).substring(7),
          sender: "ai",
          text: resText,
          timestamp: Date.now(),
        };
        socket.emit("receive_message", aiRes);
      }
      catch (err) {
        socket.emit("receive_message", {
          id: "error", 
          sender: "system", 
          text: "AI is currently offline", 
          timestamp: Date.now(),
        });
      }
    }
    // b) Talking to person
    else {
      const msgPayload: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        sender: "peer",
        text: data.text,
        timestamp: Date.now(),
      };
      socket.to(data.roomId).emit("receive_message", msgPayload);
    }
  });
});

server.listen(3001, () => {
  console.log("Signaling Server running on http://localhost:3001");
});