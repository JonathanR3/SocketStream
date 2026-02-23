// Types are deleted during runtime so include keyword
import type { ChatInstance } from "shared";
import { useState, useRef, useEffect } from "react";
import { Socket } from "socket.io-client";
import type { SignalData } from "simple-peer";
import Peer from "simple-peer";

// Google's Session Traversal Utilities for NAT (STUN) servers 
const peerConfiguration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
    ]
}

/**
 * Props used to initialize WebRTC P2P connection
 */
interface UseWebRTCProps {
    // TCP WebSocket connection for signaling relay
    socket: Socket;
    // Local camera/microphone stream (User Plane data)
    myStream: MediaStream | null;
    // Matchmaking data that triggers the connection lifecycle
    chatData: (ChatInstance & { initiator: boolean }) | null;
    // Determine if last peer left room
    isPeerDisconnected: boolean;
}

/**
 * Hook manages WebRTC P2P connection lifecycle acting as a state machine.
 * Control Plane (TCP): Relays SDP and ICE candidates via WebSockets.
 * User Plane (UDP): Establishes the direct media stream between clients.
 * @param {UseWebRTCProps} props - socket, local stream, chat match data, peer disconnected flag
 * @returns {{ peerStream: MediaStream | null, connectionState: string }} Remote video and status
 */
export function useWebRTC({ socket, myStream, chatData, isPeerDisconnected }: UseWebRTCProps) {
    // Create state key/value pairs to track partner video and connection phase
    const [peerStream, setPeerStream] = useState<MediaStream | null>(null);
    const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "failed">("idle");
    const peerRef = useRef<Peer.Instance | null>(null); // Peer instance persists across renders without triggering UI updates

    useEffect(() => {
        if (isPeerDisconnected && peerRef.current) {
            console.log("[WebRTC] Peer disconnected, tearing down media stream");
            peerRef.current.destroy();
            peerRef.current = null;
            setPeerStream(null);
            setConnectionState("idle");
        }
    }, [isPeerDisconnected]);

    // Check on refresh and execute WebRTC state machine
    useEffect(() => {
        // Requires local media stream and partner data to initialize
        if (!chatData || !myStream || isPeerDisconnected) {
            return;
        }

        // Prevent duplicating peer connections (Idempotency check for React StrictMode)
        if (peerRef.current) {
            return;
        }

        console.log(`[WebRTC] Initializing peer with initiator: ${chatData.initiator}`);
        setConnectionState("connecting");

        const peer = new Peer({
            initiator: chatData.initiator, // check if current stream is initiator (true creates offer, false waits)
            trickle: true, // enable trickle ICE and dont wait for all candidates to populate before sending (more complex handshake, but faster)
            stream: myStream, // current stream
            config: peerConfiguration, // STUN servers
        });

        // Outgoing signal (Control Plane): Send generated SDP/ICE data to server via TCP
        peer.on("signal", (signalData : SignalData) => {
            console.log("[WebRTC] Signal generated, sending via TCP...");
            socket.emit("signal", {
                target: chatData.peerId,
                signal: signalData,
            });
        });

        // Incoming stream (User Plane): Connection successful, receive direct media via UDP
        peer.on("stream", (remoteStream : MediaStream) => {
            console.log("[WebRTC] Remote stream received");
            setPeerStream(remoteStream);
            setConnectionState("connected");
        });
        
        // Incoming stream with error (e.g., NAT/Firewall blocking UDP holes)
        peer.on("error", (err) => {
            console.error("[WebRTC] Error:", err);
            setConnectionState("failed");
        });

        // Incoming signal (Control Plane): Receive offer/answer from server to complete handshake via TCP
        const handleIncomingSignal = (data: { signal: SignalData, from: string }) => {
            if (data.from === chatData.peerId) {
                console.log("[WebRTC] Received Signal via TCP, processing...");
                peer.signal(data.signal);
            }
        };

        // Open socket to listen and pass server data into peer instance
        socket.on("signal_received", handleIncomingSignal);
        // Save peer instance
        peerRef.current = peer;

        // Cleanup every time after new match or unmounting to free network resources
        return () => {
            socket.off("signal_received", handleIncomingSignal);
            if (peerRef.current) {
                peerRef.current.destroy(); // Close UDP connection and sever peer
                peerRef.current = null;
            }
            setConnectionState("idle");
            setPeerStream(null);
        };
    }, [socket, myStream, chatData]); // Dependency array for refreshes based on changes to partner, audio/video stream, or disconnection

    return { peerStream, connectionState };
}