import type { Word } from "./scheduleImport";

export async function wordsFromPdf(data: ArrayBuffer): Promise<Word[]> {
  const promiseApi = Promise as unknown as { withResolvers?: () => { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (reason?: unknown) => void } };
  if (typeof promiseApi.withResolvers !== "function") {
    promiseApi.withResolvers = () => {
      let resolve: (value: unknown) => void = () => undefined;
      let reject: (reason?: unknown) => void = () => undefined;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const words: Word[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const x = item.transform[4];
        const y = viewport.height - item.transform[5];
        const parts = item.str.trim().split(/\s+/).filter(Boolean);
        const total = Math.max(1, parts.join(" ").length);
        let cursor = x;
        for (const part of parts) {
          const width = (part.length / total) * item.width;
          words.push({ text: part, x: cursor, y, x2: cursor + width, page: pageNumber });
          cursor += width + item.width / total;
        }
      }
    }
  } finally {
    await document.destroy();
  }
  return words;
}
