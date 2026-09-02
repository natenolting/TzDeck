"use client";

import React, { useState } from "react";
import { soundManager } from "@/lib/sound";

export default function SoundToggle() {
  const [isMuted, setIsMuted] = useState(soundManager.getMuted());

  const handleToggle = () => {
    const muted = soundManager.toggleMute();
    setIsMuted(muted);
  };

  return (
    <button
      onClick={handleToggle}
      title={isMuted ? "Unmute sound effects" : "Mute sound effects"}
      className="flex items-center justify-center rounded-xl border border-gray-800 bg-gray-900/80 p-2 text-xs text-gray-400 hover:border-gray-700 hover:text-white transition-colors"
    >
      {isMuted ? (
        <span className="text-sm">🔇</span>
      ) : (
        <span className="text-sm">🔊</span>
      )}
    </button>
  );
}
