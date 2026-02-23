import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { type ChatRequest, type ChatInstance, type ChatMessage } from "shared";
import { useMediaStream } from "./hooks/useMediaStream";
import { useWebRTC } from "./hooks/useWebRTC";
import { VideoPlayer } from "./components/VideoPlayer";

// Initialize TCP WebSocket outside component to prevent reconnect loops
const socket = io("http://localhost:3001");

export default function App() {
    /**
     * Home - Description and main landing page
     * Interests - Enter tags for matchmaking
     * Mode - Human or AI selection for chat
     * Hardware - Allow camera and mic on browser
     * Waiting - Intermediate waiting room for matchmaking to be done
     * Room - Individual chat and video rooms
     */
    const [view, setView] = useState<"HOME" | "INTERESTS" | "MODE" | "HARDWARE" | "WAITING" | "ROOM">("HOME");
    
    // Chat configuration
    const [interestInput, setInterestInput] = useState("");
    const [interests, setInterests] = useState<string[]>([]);
    const [mode, setMode] = useState<"human" | "ai" | null>(null);
    
    // Hardware network state
    const [hardwareRequested, setHardwareRequested] = useState(false);
    const [chatData, setChatData] = useState<(ChatInstance & { initiator: boolean }) | null>(null);
    const [isPeerDisconnected, setIsPeerDisconnected] = useState(false);

    // Chat messages
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [messageInput, setMessageInput] = useState("");
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Hooks to establish WebRTC connection and receive video and audio stream (renamed)
    const { stream: myStream, error: mediaError } = useMediaStream(hardwareRequested);
    const { peerStream, connectionState } = useWebRTC({ 
        socket, 
        myStream, 
        chatData,
        isPeerDisconnected,
    });

    // Message array changes, scrolling down effect
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Once camera permission is granted, emit payload to server to matchmake
    useEffect(() => {
        if (view === "HARDWARE" && myStream) {
            // ! Override null value check
            const request: ChatRequest = { mode: mode!, interests };
            socket.emit("join_mode", request);
            setView("WAITING");
        }
    }, [myStream, view, mode, interests]);

    // Mount TCP listeners for matchmaking events
    useEffect(() => {
        // Waiting for matchmaking in queue
        socket.on("waiting_in_queue", () => setView("WAITING"));
        
        // Found match, set data for peer and room ID, and isAI flag, and intitiator, and switch to chatroom view
        socket.on("match_found", (data: ChatInstance & { initiator: boolean }) => {
            console.log("[App] Match Found:", data);
            setIsPeerDisconnected(false); // Reset on new match
            setChatData(data); 
            setView("ROOM");
        });

        // Add newly inputted message to history array
        socket.on("receive_message", (msg: ChatMessage) => {
            setMessages((prev) => [...prev, msg]);
        })

        // Listen for partner leaving the room (disconnect, next, stop)
        socket.on("peer_disconnected", () => {
            setIsPeerDisconnected(true);
            setMessages((prev) => {
                const lastMsg = prev[prev.length-1];
                if (lastMsg && lastMsg.text === "Your partner has disconnected.") {
                    return prev;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    sender: "system",
                    text: "Your partner has disconnected.",
                    timestamp: Date.now(),
                }];
            });
        });

        // Stop listening after joining room
        return () => {
            socket.off("waiting_in_queue");
            socket.off("match_found");
            socket.off("receive_message");
            socket.off("peer_disconnected");
        };
    }, []);

    // Handler for adding tags to interests
    const handleAddInterest = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const val = interestInput.trim().toLowerCase();
            if (val && !interests.includes(val)) setInterests([...interests, val]);
            setInterestInput(""); 
        }
    };

    // Handler to remove tag from interests
    const handleRemoveInterest = (tagToRemove: string) => {
        setInterests(interests.filter(tag => tag !== tagToRemove));
    };

    // Handler to return back to interests screen after we "stop" chat
    const handleStop = () => {
        setHardwareRequested(false); 
        setChatData(null);
        setMessages([]);          
        setIsPeerDisconnected(false); 
        setView("INTERESTS");
        socket.emit("leave_chat");   
    };

    // Handler to return back to waiting room after we go "next" 
    const handleNext = () => {
        setChatData(null);
        setMessages([]);    
        setIsPeerDisconnected(false);
        setView("WAITING");
        socket.emit("leave_chat");
        
        const request: ChatRequest = { mode: mode!, interests: interests };
        socket.emit("join_mode", request); 
    };

    // Handler to send messages through chatbox
    const handleSendMessage = () => {
        const rawText = messageInput.trim();
        if (!rawText || !chatData || isPeerDisconnected) {
            return;
        }

        // a) Display our own message locally
        const myMsg: ChatMessage = {
            id: Date.now().toString(),
            sender: "me",
            text: rawText,
            timestamp: Date.now()
        };
        setMessages(prev => [...prev, myMsg]);

        // b) Format history for AI Context
        const formattedHistory = messages
            .filter(m => m.sender === "me" || m.sender === "ai")
            .map(m => ({
                role: m.sender === "me" ? "user" : "model",
                parts: [{ text: m.text }]
            }));
            
        // Push the current message to the end of the history array
        formattedHistory.push({ role: "user", parts: [{ text: rawText }] });

        // c) Emit everything to the server
        socket.emit("send_message", {
            roomId: chatData.roomId,
            text: rawText,
            isAi: chatData.isAi,
            history: formattedHistory 
        });

        setMessageInput(""); // Clear the UI input field
    };

    // Handler for pressing enter to send
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleSendMessage();
        }
    };

return (
        <div className="min-h-screen bg-brand-lemon/40 text-slate-800 font-sans p-6 flex flex-col items-center justify-center">
            
            {/* Header */}
            <div className="absolute top-6 left-6 flex items-center gap-3">
                <h1 className="text-2xl font-bold text-brand-coral">SocketStream</h1>
                <span className={`px-2 py-1 text-xs font-bold rounded-md ${socket.connected ? "bg-brand-teal/40 text-brand-green" : "bg-red-100 text-brand-red"}`}>
                    {socket.connected ? "TCP ONLINE" : "OFFLINE"}
                </span>
            </div>

            {/* HOME */}
            {view === "HOME" && (
                <div className="w-full max-w-2xl text-center">
                    <h2 className="text-6xl font-bold mb-6 text-slate-900">Connect instantly</h2>
                    <ul className="text-xl text-slate-600 mb-12">
                        <li className="mb-2">✔️ Experience <strong className="text-black">sub-200ms</strong> peer-to-peer video streaming</li>
                        <li className="mb-2">✔️ Chat <strong className="text-black">custom-tailored</strong> with AI agents</li>
                        <li>✔️ No <strong className="text-black">sign-ups</strong>, no tracking</li>
                    </ul>
                    
                    <button 
                        onClick={() => setView("INTERESTS")} 
                        className="bg-brand-coral hover:opacity-90 text-white font-bold text-2xl px-12 py-4 rounded-xl shadow-lg transition"
                    >
                        Chat Now!
                    </button>
                </div>
            )}

            {/* INTERESTS */}
            {view === "INTERESTS" && (
                <div className="w-full max-w-xl text-center">
                    <h2 className="text-4xl font-bold mb-4 text-slate-900">What's your interest?</h2>
                    <p className="text-slate-600 mb-6">Add tags to match with specific people, or leave it blank to surprise yourself!</p>
                    
                    <div className="bg-white border-2 border-slate-200 rounded-xl p-3 flex flex-wrap gap-2 items-center min-h-[3.5rem] mb-8 focus-within:border-brand-teal transition">
                        {interests.map((tag) => (
                            <span key={tag} className="bg-brand-pink text-slate-900 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-2">
                                {tag}
                                <button onClick={() => handleRemoveInterest(tag)} className="hover:text-brand-coral">✕</button>
                            </span>
                        ))}
                        <input 
                            type="text"
                            value={interestInput}
                            onChange={(e) => setInterestInput(e.target.value)}
                            onKeyDown={handleAddInterest}
                            placeholder={interests.length === 0 ? "Type a topic and press Enter..." : ""}
                            className="flex-1 outline-none bg-transparent"
                        />
                    </div>
                    
                    <button onClick={() => setView("MODE")} className="w-full bg-brand-teal hover:opacity-90 text-slate-900 font-bold text-lg py-4 rounded-xl shadow-md transition">
                        Next Step →
                    </button>
                    
                    <button onClick={() => setView("HOME")} className="mt-6 text-slate-500 font-bold hover:text-slate-800">
                        ← Back to Home
                    </button>
                </div>
            )}

            {/* MODE SELECTION */}
            {view === "MODE" && (
                <div className="w-full max-w-xl text-center">
                    <h2 className="text-4xl font-bold mb-8 text-slate-900">Choose Connection</h2>
                    
                    <div className="flex gap-4 mb-6">
                        <button 
                            onClick={() => { setMode("human"); setView("HARDWARE"); }} 
                            className="flex-1 bg-white border-2 border-slate-200 hover:border-brand-teal p-8 rounded-xl shadow-sm hover:shadow-md transition"
                        >
                            <div className="text-5xl mb-4">🌍</div>
                            <div className="font-bold text-xl text-slate-800">Human Match</div>
                            <div className="text-slate-500 text-sm mt-1">P2P Network</div>
                        </button>
                        
                        <button 
                            onClick={() => { setMode("ai"); setView("HARDWARE"); }} 
                            className="flex-1 bg-white border-2 border-slate-200 hover:border-brand-sand p-8 rounded-xl shadow-sm hover:shadow-md transition"
                        >
                            <div className="text-5xl mb-4">🧠</div>
                            <div className="font-bold text-xl text-slate-800">AI Agent</div>
                            <div className="text-slate-500 text-sm mt-1">Low Latency Bot</div>
                        </button>
                    </div>
                    
                    <button onClick={() => setView("INTERESTS")} className="text-slate-500 font-bold hover:text-slate-800 mt-4">
                        ← Back to Interests
                    </button>
                </div>
            )}

            {/* HARDWARE REQUEST */}
            {view === "HARDWARE" && (
                <div className="w-full max-w-md text-center">
                    <div className="text-6xl mb-6">📷</div>
                    <h2 className="text-3xl font-bold mb-6 text-slate-900">Camera Access</h2>
                    
                    {mediaError ? (
                        <div className="bg-brand-pink/50 border border-brand-pink text-slate-900 p-4 rounded-xl font-bold mb-6">{mediaError}</div>
                    ) : (
                        <button 
                            onClick={() => setHardwareRequested(true)}
                            disabled={hardwareRequested}
                            className="w-full bg-brand-coral hover:opacity-90 text-white font-bold text-lg py-4 rounded-xl shadow-md transition mb-6 disabled:bg-slate-300"
                        >
                            {hardwareRequested ? "Loading Hardware..." : "Allow Camera & Mic"}
                        </button>
                    )}
                    
                    <button onClick={() => { setHardwareRequested(false); setView("MODE"); }} className="text-slate-500 font-bold hover:text-slate-800">
                        ← Cancel
                    </button>
                </div>
            )}

            {/* WAITING ROOM */}
            {view === "WAITING" && (
                <div className="w-full max-w-md text-center">
                    <div className="w-20 h-20 border-4 border-brand-teal/30 border-t-brand-teal rounded-full animate-spin mx-auto mb-8"></div>
                    <h2 className="text-3xl font-bold text-slate-900 mb-6">Searching Network...</h2>
                    
                    <button onClick={handleStop} className="text-brand-coral font-bold text-lg hover:bg-brand-pink/40 bg-brand-pink/20 px-6 py-2 rounded-lg transition">
                        Stop Search
                    </button>
                </div>
            )}

            {/* ACTIVE ROOM */}
            {view === "ROOM" && (
                <div className="w-full max-w-6xl h-[80vh] flex gap-4">
                    
                    {/* Left: Video Stage */}
                    <div className="flex-2 flex flex-col gap-4 relative w-2/3">
                        <div className="flex-1 bg-slate-900 rounded-2xl overflow-hidden shadow-xl border-4 border-slate-800 relative flex items-center justify-center transition-all duration-300">
                            
                            {/* FIX: Check for disconnection first to clear the UI */}
                            {chatData?.isAi ? (
                                <div className="flex flex-col items-center">
                                    <div className="w-48 h-48 bg-brand-pink rounded-full blur-3xl absolute opacity-30 animate-pulse"></div>
                                    <span className="text-9xl relative z-10">🤖</span>
                                </div>
                            ) : isPeerDisconnected ? (
                                <div className="flex flex-col items-center animate-fade-in">
                                    <div className="text-6xl mb-4">🚫</div>
                                    <div className="text-brand-red font-bold text-xl tracking-wide">Partner Left</div>
                                </div>
                            ) : connectionState === "connected" ? (
                                <VideoPlayer stream={peerStream} />
                            ) : (
                                <div className="flex flex-col items-center">
                                    <div className="text-5xl mb-4 animate-bounce">📡</div>
                                    <div className="text-brand-teal font-bold text-lg">Connecting UDP...</div>
                                </div>
                            )}

                            {!isPeerDisconnected && (
                                <div className="absolute top-4 left-4 bg-black/60 px-3 py-1.5 rounded-lg text-xs font-mono text-brand-teal font-bold border border-slate-700">
                                    {chatData?.isAi ? "AI BOT CONNECTED" : `UDP: ${connectionState.toUpperCase()}`}
                                </div>
                            )}
                        </div>

                        <div className="absolute bottom-6 right-6 w-56 h-40 bg-black rounded-xl overflow-hidden shadow-xl border-2 border-brand-sand/50">
                            {myStream ? (
                                <VideoPlayer stream={myStream} isLocal={true} />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-600 font-bold">Camera Offline</div>
                            )}
                        </div>
                    </div>

                    {/* Right: Chat Sidebar */}
                    <div className="flex-1 bg-white rounded-2xl shadow-xl border border-brand-teal/30 flex flex-col overflow-hidden w-1/3">
                        
                        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-1 bg-slate-50">
                            {interests.length > 0 ? interests.map(tag => (
                                <span key={tag} className="text-xs font-bold bg-brand-pink text-slate-900 px-2 py-1 rounded-md">{tag}</span>
                            )) : <span className="text-xs font-bold text-slate-400">Random Chat</span>}
                        </div>

                        <div className="flex-1 p-4 bg-slate-50 flex flex-col gap-3 overflow-y-auto">
                            {messages.length === 0 ? (
                                <div className="flex-1 flex items-center justify-center text-slate-400 font-bold text-sm">
                                    Say hello to start the conversation!
                                </div>
                            ) : (
                                messages.map((msg) => (
                                    <div key={msg.id} className={`max-w-[85%] px-4 py-2 rounded-xl text-sm font-medium shadow-sm ${
                                        msg.sender === "me" 
                                            ? "bg-brand-teal text-slate-900 self-end rounded-br-none" 
                                            : msg.sender === "system"
                                                ? "bg-red-50 text-brand-red border border-red-200 self-center rounded-xl text-xs font-bold px-4"
                                                : "bg-white border border-slate-200 text-slate-700 self-start rounded-bl-none"
                                    }`}>
                                        {msg.text}
                                    </div>
                                ))
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        <div className="p-4 bg-white border-t border-slate-100">
                            <div className="flex gap-2 mb-4">
                                <input 
                                    type="text" 
                                    value={messageInput}
                                    onChange={(e) => setMessageInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    disabled={isPeerDisconnected} // Block typing if alone
                                    placeholder={isPeerDisconnected ? "Chat closed." : "Type a message..."} 
                                    className="flex-1 bg-slate-100 border border-slate-200 rounded-lg px-4 outline-none focus:border-brand-teal transition disabled:opacity-50" 
                                />
                                <button onClick={handleSendMessage} disabled={isPeerDisconnected} className="bg-brand-teal hover:opacity-90 text-slate-900 px-5 rounded-lg font-bold transition disabled:opacity-50">Send</button>
                            </div>
                            
                            <div className="flex gap-2">
                                <button onClick={handleStop} className="flex-1 bg-brand-pink/30 text-slate-700 hover:bg-brand-coral hover:text-white py-3 rounded-lg font-bold transition">
                                    Stop
                                </button>
                                <button onClick={handleNext} className="flex-2 bg-brand-coral text-white hover:opacity-90 py-3 rounded-lg font-bold shadow-md transition">
                                    Next Match →
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}