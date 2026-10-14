"use client";

import { useMemo } from "react";

import { useFailoverImage } from "@/hooks/useFailoverImage";
import { useContentReveal } from "@/hooks/useContentReveal";
import { getCardImageSources } from "@/lib/ipfs";
import { isImageArtifact, type NFTCard } from "@/lib/card";
import ContentWarningCover from "./ContentWarningCover";
import { ImageOffIcon } from "./icons";
import Spinner from "./Spinner";

export default function SharedCardArtwork({ card }: { card: NFTCard }) {
  const sources = useMemo(
    () => getCardImageSources(
      card.thumbnail_uri,
      card.display_uri,
      isImageArtifact(card) ? card.artifact_uri : undefined,
    ),
    [card],
  );
  const { imageUrl, loaded, failed, handleLoad, handleError } = useFailoverImage(sources);
  const { hiddenBy, reveal } = useContentReveal(card);

  if (hiddenBy.length > 0) {
    return <ContentWarningCover warnings={hiddenBy} cardName={card.name} onReveal={reveal} />;
  }

  if (failed || !imageUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-text-tertiary">
        <ImageOffIcon className="mb-2 h-10 w-10 text-text-muted" />
        <span className="text-sm font-medium text-text-secondary">{card.name}</span>
        <span className="mt-1 text-xs text-text-muted">Media unavailable</span>
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-1/80">
          <Spinner label="Loading token artwork" size="lg" />
        </div>
      )}
      {/* OBJKT's assets host rejects browser embeds that carry tzdeck.xyz as
          their Referer. Use token-owned IPFS metadata here; the CDN derivative
          remains appropriate only for server-side OG rendering. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={card.name}
        onLoad={handleLoad}
        onError={handleError}
        decoding="async"
        className={`h-full w-full object-cover transition-opacity ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}
