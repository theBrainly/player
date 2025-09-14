# StreamFlow

StreamFlow is a premium video streaming web application designed to deliver smooth, buffer-free playback by acting as a smart proxy between external video sources and the client. It features a "Cyber-Noir" aesthetic and is built to run efficiently on serverless architectures like Vercel.

## 🚀 Key Features

- **Smart Pass-Through Proxy**: Bypasses CORS restrictions and handles video streaming efficiently.
- **Intelligent Caching**: In-memory caching system to reduce bandwidth and improve seek performance.
- **Premium UI**: Modern, responsive interface with a high-end "Cyber-Noir" design language.
- **Format Support**: Dynamic MIME type detection for varying video formats.

## 🛠 Technical Architecture

### Smart Chunk Caching System

The core innovation of StreamFlow is its custom server-side caching mechanism designed to work within the constraints of serverless functions (like Vercel) while providing a persistent-like streaming experience.

#### 1. Chunked Streaming
Instead of trying to stream a giant file at once (which hits timeout limits), the system breaks requests into manageable **5MB chunks**.
- **Chunk Size**: `5 * 1024 * 1024` bytes (5MB)
- This ensures every request finishes quickly, well within Vercel's execution time limits.

#### 2. In-Memory Cache Implementation
The `ChunkCacheManager` maintains an intelligent in-memory store of downloaded video segments. This prevents re-downloading the same data when a user seeks backward or when multiple users requests the same content (in a warm instance).

**Cached Detail Structure:**
Every cached chunk is stored with precise metadata:
```typescript
interface CachedChunk {
    data: Uint8Array;      // The actual video binary data
    timestamp: number;     // Last access time for LRU eviction
}
```

#### 3. 200MB Memory Management Strategy
To prevent Out-Of-Memory (OOM) crashes in the serverless environment, the system strictly enforces a **200MB memory limit**.

**Cleanup Logic (`enforceMemoryLimit`):**
The system runs a cleanup routine after every chunk download if the cache exceeds 200MB (`MAX_CACHE_SIZE`).

*   **Phase 1: Inactive Session Clean**
    *   Identifies streaming sessions that haven't been accessed recently.
    *   Completely evicts these inactive sessions first to free up large blocks of memory.

*   **Phase 2: Active Session Sliding Window (Smart Pruning)**
    *   If memory is still tight, it targets the *heaviest* active session.
    *   It effectively creates a "sliding window" by pruning the **oldest chunks** (lowest indices) from said session.
    *   **Logic**: Users typically watch forward. Chunks at the beginning of the file (chunk 0, 1, 2...) are likely already watched and less likely to be needed again than current or future chunks.
    *   It removes these reduced-priority chunks until the cache usage drops below 90% of the limit (leaving ~20MB headroom).

#### 4. Cache Lifecycle
*   **TTL (Time To Live)**: Sessions are considered expired if not accessed for **10 minutes** (`CACHE_TTL`).
*   **Auto-Cleanup**: A background interval runs every 5 minutes to sweep expired sessions.

## 🔄 Proxy Workflow

1.  **Incoming Request**: Client requests a video chunk via `/api/proxy`.
2.  **Capability Probe**: Server checks if the upstream URL supports HTTP Range requests.
    *   **Supports Range**: Proxies the request directly (Pass-through).
    *   **No Range Support**: Falls back to the `ChunkCacheManager` to download and cache the file linearly, serving the requested chunk from memory.
3.  **Delivery**: StreamFlow serves the verified video data to the player with correct Content-Type and Range headers.

## 📦 Project Structure

- `app/api/proxy`: Core proxy logic and API route.
- `lib/chunkCache.ts`: The caching engine and memory management logic.
- `hooks/useChunkFetcher.ts`: Client-side hook for managing chunk requests.
- `components/player`: Custom video player with buffer visualization.
