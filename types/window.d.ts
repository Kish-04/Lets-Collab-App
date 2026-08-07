export interface ShareableSource {
  id: string;
  name: string;
  display_id: string | null;
  thumbnail: string | null; // dataURL
  isScreen: boolean;
}

declare global {
  interface Window {
    api?: {
      askGemini: (prompt: string) => Promise<string>;
      getShareableSources: () => Promise<ShareableSource[]>;
      setShareSource: (sourceId: string) => Promise<boolean>;
    };
  }
}

export {};
