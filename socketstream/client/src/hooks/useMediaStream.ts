import { useState, useEffect, useRef } from "react";

/**
 * Hook handles local camera and microphone stream in user plane. Requests hardware
 * access and ensures tracks are closed on unmount ("stop", closing page, refresh)
 * @param {boolean} enabled - Flag to trigger hardware access request
 * @returns {{ stream: MediaStream | null, error: string | null }}
 */
export function useMediaStream(enabled: boolean) {
    // State key/value pair for hardware stream feed
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Persistent reference to stream to prevent stale closure during cleanup
    const streamRef = useRef<MediaStream | null>(null);
    useEffect(() => {
        // Component lifecycle tracked to prevent state updates on unmounting
        let mounted = true;

        const startCamera = async () => {
            try {
                console.log("[Media] Requesting hardware access...");
                // Obtain access for both video and audio streams
                const currentStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true,
                });

                // If component is still active, set the stream
                if (mounted) {
                    setStream(currentStream);
                    streamRef.current = currentStream;
                    console.log("[Media] Hardware access granted");
                }
                else {
                    // Prevents race condition where "stop" pressed before camera loads
                    currentStream.getTracks().forEach((track) => track.stop());
                }
            }
            catch (err) {
                console.error("[Media] Failed to access hardware: ", err);
                if (mounted) {
                    setError("Camera/Mic access denied. Please enable permissions.");
                }
            }
        }

        // State machine for if camera is to be enabled
        if (enabled) {
            startCamera();
        }
        else {
            // Cleans up stream and closes if no longer enabled (stop button)
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
            }
            setStream(null)
        }

        // Cleanup on unmounting through (closing tab or refreshing)
        return () => {
            mounted = false;
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
            }
        };
    }, [enabled]); // Dependency array to check if light request has "allow" or "stop" chosen
    return { stream, error };
}