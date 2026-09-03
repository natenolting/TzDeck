# TzDeck Engineering Specification: Code Quality, Performance & DRY Remediation

**Document ID:** SPEC-2026-09-TZDECK-REFACTOR
**Status:** Approved / Ready for Implementation
**Target:** TzDeck Core (`src/app`, `src/components`, `src/lib`, `src/context`, `src/hooks`)
**Date:** September 3, 2026

---

## 1. Overview & Objective

This specification details architectural remediations, performance optimizations, and code deduplication based on the codebase review of commits from September 1–3, 2026.

### Goals
1. **Eliminate Code Duplication (DRY):** Unify duplicated token mapping, API request parsing, and address formatting across the app.
2. **Fix React Anti-Patterns & Re-render Hotspots:** Replace array-index keying, eliminate 60Hz component re-renders during mouse movement, and prevent unmounted asynchronous timer execution.
3. **Enhance System Robustness:** Replace biased shuffling with Fisher-Yates, eliminate single-point-of-failure random offset crashes, and add resilient wallet error handling.
4. **Clean Dependencies & Artifacts:** Purge unused dependencies, empty directories, and repository clutter.

---

## 2. Architecture & Remediation Roadmap

```mermaid
flowchart TD
    subgraph Phase 1: Stability & Integrity
        P1A["SPEC-01: Fisher-Yates Shuffle & Offset Fallback"]
        P1B["SPEC-02: Deterministic Card Keys (Contract:TokenID)"]
        P1C["SPEC-03: Async Timer Safety & Click Debouncing"]
    end

    subgraph Phase 2: Deduplication & DRY
        P2A["SPEC-04: OBJKT Token Normalizer Helper"]
        P2B["SPEC-05: Consolidated Random Pack Route"]
        P2C["SPEC-06: Shared Key & Address Formatters"]
    end

    subgraph Phase 3: Performance & A11y
        P3A["SPEC-07: CSS-Variable Foil Glow (No State Re-renders)"]
        P3B["SPEC-08: Single-Pass Deck Statistics"]
        P3C["SPEC-09: Safe Modal Focus Trapping Without Body Tampering"]
    end

    subgraph Phase 4: Hygiene & Maintenance
        P4A["SPEC-10: Dependency Pruning (@tanstack/react-query, @upstash/redis)"]
        P4B["SPEC-11: Purge Empty /api/media & deepseek-convo.md"]
    end

    Phase 1 --> Phase 2 --> Phase 3 --> Phase 4
```

---

## 3. Detailed Specifications

### SPEC-01: Uniform Shuffle & Query Offset Resilience
* **Location:** [`src/lib/objkt.ts`](file:///Users/natenolting/TzDeck/src/lib/objkt.ts#L290-L345)
* **Problem:**
  1. `listings.sort(() => 0.5 - Math.random())` produces a non-uniform distribution due to V8's Timsort sorting algorithm.
  2. If `randomOffset` (0–799) lands on an empty window of active listings, the query throws an error, resulting in an unrecoverable 500 error for the user.
* **Remediation:**
  1. Implement an in-place Fisher-Yates shuffle helper `shuffleArray<T>(items: T[]): T[]`.
  2. If `listings.length === 0` when `randomOffset > 0`, retry the query once with `offset = 0` before failing.

```ts
export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
```

---

### SPEC-02: Deterministic React Keys Across Card Grids
* **Locations:**
  * [`src/components/DeckGrid.tsx`](file:///Users/natenolting/TzDeck/src/components/DeckGrid.tsx#L262)
  * [`src/components/PackOpening.tsx`](file:///Users/natenolting/TzDeck/src/components/PackOpening.tsx#L276)
  * [`src/components/WishlistGrid.tsx`](file:///Users/natenolting/TzDeck/src/components/WishlistGrid.tsx#L53)
* **Problem:** Keys include array indices (`key={`${token.token_id}-${token.contract_address}-${index}`}`). When filters or sorts change, index changes force React to either reuse mismatched state or remount DOM nodes pointlessly.
* **Remediation:**
  * Provide a standard card key helper in [`src/lib/objkt.ts`](file:///Users/natenolting/TzDeck/src/lib/objkt.ts):
    ```ts
    export function getCardKey(card: Pick<NFTCard, "contract_address" | "token_id">): string {
      return `${card.contract_address}:${card.token_id}`;
    }
    ```
  * Use `getCardKey(card)` exclusively for all React keys and wishlist lookups.

---

### SPEC-03: Asynchronous Timer Lifecycle & Debounce Protection
* **Location:** [`src/components/PackOpening.tsx`](file:///Users/natenolting/TzDeck/src/components/PackOpening.tsx#L26-L84)
* **Problem:**
  1. Clicking "Click to Rip Open" multiple times triggers overlapping calls to `fetch("/api/random-pack")`.
  2. `setTimeout` callbacks (700ms and 600ms) fire on unmounted components if the user navigates tabs.
  3. Clicking "Reveal All" while card flip timeouts are active causes double execution of `playPackComplete()`.
* **Remediation:**
  1. Add an immediate guard: `if (isLoading || packState !== "idle") return;`.
  2. Store timer handles in a `useRef<NodeJS.Timeout[]>` and clear all pending timers on unmount or pack reset:
     ```ts
     const timersRef = useRef<number[]>([]);
     const registerTimer = (fn: () => void, ms: number) => {
       const id = window.setTimeout(fn, ms);
       timersRef.current.push(id);
     };
     useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);
     ```

---

### SPEC-04: Unified OBJKT Token Normalizer
* **Location:** [`src/lib/objkt.ts`](file:///Users/natenolting/TzDeck/src/lib/objkt.ts#L227-L370)
* **Problem:** Identical mapping logic (~20 lines each) is duplicated in `fetchUserHoldings` and `fetchRandomPack`.
* **Remediation:**
  * Define an internal normalizer function:
    ```ts
    interface NormalizeTokenOptions {
      listingId?: number;
      priceMutez?: number;
      quantityOwned?: number;
    }

    export function normalizeObjktToken(token: ObjktRawToken, options: NormalizeTokenOptions = {}): NFTCard {
      const editions = token.supply ?? 1;
      const priceXtz = options.priceMutez !== undefined ? options.priceMutez / 1_000_000 : undefined;
      const artist = token.creators?.[0]?.holder;
      const displayUri = token.display_uri || token.thumbnail_uri || token.artifact_uri || "";

      return {
        listing_id: options.listingId,
        token_id: token.token_id,
        contract_address: token.fa_contract,
        name: token.name || `OBJKT #${token.token_id}`,
        description: token.description || undefined,
        display_uri: convertIpfsUrl(displayUri),
        artifact_uri: convertIpfsUrl(token.artifact_uri || undefined),
        thumbnail_uri: convertIpfsUrl(token.thumbnail_uri || displayUri),
        artist_alias: artist?.alias || (artist?.address ? formatShortAddress(artist.address) : "Unknown Artist"),
        artist_address: artist?.address,
        collection_name: token.fa?.name || "Tezos Art",
        editions,
        price_mutez: options.priceMutez,
        price_xtz: priceXtz !== undefined ? Number(priceXtz.toFixed(3)) : undefined,
        objkt_url: `https://objkt.com/asset/${token.fa_contract}/${token.token_id}`,
        rarity: calculateRarity(editions, priceXtz),
        quantity_owned: options.quantityOwned,
      };
    }
    ```

---

### SPEC-05: Route Consolidation for Random Pack Generation
* **Location:** [`src/app/api/random-pack/route.ts`](file:///Users/natenolting/TzDeck/src/app/api/random-pack/route.ts)
* **Problem:** 60 lines containing nearly identical duplicate handlers for `GET` and `POST`.
* **Remediation:**
  * Consolidate pack generation logic into a shared handler:
    ```ts
    async function handleGeneratePack(countParam: unknown) {
      const count = Math.min(Math.max(Number(countParam) || 5, 3), 10);
      const cards = await fetchRandomPack(count);
      if (!cards || cards.length === 0) {
        return NextResponse.json({ error: "Failed to generate pack. Please try again." }, { status: 500 });
      }
      return NextResponse.json({ cards, timestamp: Date.now(), packSize: cards.length });
    }
    ```

---

### SPEC-06: Shared Formatters
* **Locations:** [`src/components/ConnectButton.tsx`](file:///Users/natenolting/TzDeck/src/components/ConnectButton.tsx#L38), [`src/lib/objkt.ts`](file:///Users/natenolting/TzDeck/src/lib/objkt.ts#L235)
* **Remediation:** Export a shared `formatShortAddress(address: string): string` utility in [`src/lib/objkt.ts`](file:///Users/natenolting/TzDeck/src/lib/objkt.ts).

---

### SPEC-07: CSS Variable-Driven Foil Glow
* **Location:** [`src/components/NFTCard.tsx`](file:///Users/natenolting/TzDeck/src/components/NFTCard.tsx#L100-L185)
* **Problem:** `onMouseMove` calls `setMousePos({ x, y })` on every pixel change, forcing React to re-render the card at high frequencies.
* **Remediation:**
  * Remove `mousePos` React state.
  * In `handleMouseMove`, write directly to CSS custom properties on the target element:
    ```ts
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      e.currentTarget.style.setProperty("--foil-x", `${x}%`);
      e.currentTarget.style.setProperty("--foil-y", `${y}%`);
    };
    ```
  * Style the overlay using CSS variables:
    ```tsx
    <div
      className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay transition-opacity"
      style={{
        background: "radial-gradient(circle at var(--foil-x, 50%) var(--foil-y, 50%), rgba(255,255,255,0.8) 0%, transparent 60%)",
      }}
    />
    ```

---

### SPEC-08: Single-Pass Deck Statistics
* **Location:** [`src/components/DeckGrid.tsx`](file:///Users/natenolting/TzDeck/src/components/DeckGrid.tsx#L106-L172)
* **Problem:** 3 separate iterations over `tokens` (two in separate `useMemo` hooks, one unmemoized on every render).
* **Remediation:** Compute all 3 stats in a single memoized loop:
  ```ts
  const stats = useMemo(() => {
    const artists = new Set<string>();
    const collections = new Set<string>();
    let highRarityCount = 0;

    for (const t of tokens) {
      const artist = t.artist_alias || t.artist_address;
      if (artist) artists.add(artist);
      if (t.collection_name) collections.add(t.collection_name);
      if (t.rarity === "rare" || t.rarity === "epic" || t.rarity === "legendary") {
        highRarityCount++;
      }
    }

    return {
      total: tokens.length,
      artists: artists.size,
      collections: collections.size,
      highRarityCount,
    };
  }, [tokens]);
  ```

---

### SPEC-09: Safe Modal Focus Trapping Without Document Mutation
* **Location:** [`src/components/NFTDetailsModal.tsx`](file:///Users/natenolting/TzDeck/src/components/NFTDetailsModal.tsx#L35-L93)
* **Problem:** Mutating `inert` and `aria-hidden` across `document.body.children` risks breaking third-party injected elements like Beacon Wallet dialogs.
* **Remediation:** Remove global `document.body.children` iteration. Maintain internal keyboard `Tab` boundary cycling within the modal's ref container and preserve the body `overflow: hidden` lock.

---

### SPEC-10: Dependency & Hygiene Pruning
1. **Unused Dependencies in [`package.json`](file:///Users/natenolting/TzDeck/package.json):**
   * Uninstall `@tanstack/react-query` and `@upstash/redis` (not used anywhere in `src/`).
2. **Remove Leftover Chat File:**
   * Remove [`deepseek-convo.md`](file:///Users/natenolting/TzDeck/deepseek-convo.md) (145KB LLM conversation log) from the repository.
3. **Remove Empty Directory:**
   * Delete `src/app/api/media/` and clean up legacy proxy parsing tests in `objkt.test.ts` if no longer required.

---

## 4. Verification & Testing Matrix

| Test ID | Scope | Verification Method | Success Criteria |
| :--- | :--- | :--- | :--- |
| **TEST-01** | Unit Tests | `npm test` | All existing 12 tests + new tests pass without regression. |
| **TEST-02** | Type Safety | `npx tsc --noEmit` | Clean zero-error compilation. |
| **TEST-03** | Linter | `npm run lint` | Zero ESLint warnings / errors. |
| **TEST-04** | Build | `npm run build` | Next.js Turbopack build succeeds with optimized bundle size. |
| **TEST-05** | Shuffle | Node assertion test | Chi-square or distribution test confirms uniform gacha card sampling. |
| **TEST-06** | Foil Interaction | Manual inspection | Inspect hover on card: no React state updates in DevTools Profiler; smooth 60fps glow. |

---

## 5. Execution Plan Checklist

- [x] **Phase 1: Integrity & Critical Stability**
  - [x] Implement Fisher-Yates shuffle in `src/lib/objkt.ts`.
  - [x] Add offset fallback logic in `fetchRandomPack`.
  - [x] Wrap `initializeWallet` in `try/catch` with mounted state check.
  - [x] Add timer cleanup and double-click guard in `PackOpening.tsx`.
- [x] **Phase 2: Deduplication & DRY**
  - [x] Create `getCardKey` and `formatShortAddress` helpers in `src/lib/objkt.ts`.
  - [x] Create `normalizeObjktToken` and replace duplicated mappings in `src/lib/objkt.ts`.
  - [x] Unify GET & POST handlers in `src/app/api/random-pack/route.ts`.
  - [x] Update card keys across `DeckGrid.tsx`, `PackOpening.tsx`, and `WishlistGrid.tsx`.
- [x] **Phase 3: Performance & Rendering**
  - [x] Replace `NFTCard` mouseMove React state with CSS custom properties.
  - [x] Combine `DeckGrid` stats into single-pass memoized loop.
  - [x] Clean up modal focus trap without mutating `document.body.children`.
- [ ] **Phase 4: Hygiene & Maintenance**
  - [x] Remove `deepseek-convo.md`.
  - [x] Remove empty directory `src/app/api/media/`.
  - [x] Prune unused packages from `package.json` (`npm uninstall @tanstack/react-query @upstash/redis`).
  - [ ] Verify test suite and production build.
