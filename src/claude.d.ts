// Runtime capabilities the claude.ai artifact host may grant a published page.
//
// Only present when the page is published WITH the capability declared, and only
// in that viewer's session — so every use is guarded by an existence check. In
// local dev `window.claude` is simply undefined.

interface ClaudeDownloadsSaveRequest {
  filename: string;
  data: string | Blob | ArrayBuffer | ArrayBufferView;
}

interface ClaudeDownloads {
  save(request: ClaudeDownloadsSaveRequest): Promise<{ status: 'saved' }>;
}

interface Window {
  claude?: {
    downloads?: ClaudeDownloads;
  };
}
