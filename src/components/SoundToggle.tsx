"use client";

import React, { useState } from "react";
import { soundManager } from "@/lib/sound";
import { SoundOffIcon, SoundOnIcon } from "./icons";

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
      className="flex items-center justify-center rounded-xl border border-border-default bg-surface-2 p-2 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
    >
      {isMuted ? (
        <SoundOffIcon />
      ) : (
        <SoundOnIcon />
      )}
    </button>
  );
}
