declare module "pdf-parse" {
  interface PdfData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  }

  function pdf(dataBuffer: Buffer, options?: object): Promise<PdfData>;
  export default pdf;
}
