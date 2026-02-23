import { useEffect, useRef } from "react";

/**
 * Props used to render WebRTC MediaStream
 */
interface VideoPlayerProps {
    // UDP user plane stream (local - user / remote - partner)
    stream: MediaStream | null;
    // Boolean for local or remote video
    isLocal?: boolean;
}

/**
 * Component attaches MediaStream to HTML video element for rendering both user and partner
 * @param {VideoPlayerProps} props - stream data, local flag
 * @returns JSX element rendering video feed
 */
export const VideoPlayer = ({ stream, isLocal = false }: VideoPlayerProps) => {

    // Ref to manipulate DOM video element and null before initial render
    const videoRef = useRef<HTMLVideoElement>(null);

    // Execute when stream prop changes
    useEffect(() => {
        // Returns raw HTML video in current, and takes srcObject as live MediaStream
        if (videoRef.current) {
            videoRef.current.srcObject = stream || null;
        }
    }, [stream]); // Dependency array for refreshes on stream change (initial load, camera flip, next user and closes)

    return (
        <video 
            ref={videoRef}
            autoPlay // Automatically play as stream is loaded
            playsInline // Prevent fullscreen on mobile
            muted={isLocal} // Mute local video 
            className={`w-full h-full object-cover rounded-xl bg-slate-900 ${isLocal ? "scale-x-[-1]" : ""}`} // Mirrors effect for local self-view
        />
    );
};