declare module "busboy" {
  import type { IncomingMessage } from "http";
  import type { Readable } from "stream";

  interface BusboyConfig {
    headers: IncomingMessage["headers"];
    limits?: { files?: number; fileSize?: number };
  }
  interface FileInfo { filename: string; encoding: string; mimeType: string }
  interface Busboy extends NodeJS.EventEmitter {
    on(event: "file", listener: (fieldname: string, stream: Readable, info: FileInfo) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "finish", listener: () => void): this;
  }
  function Busboy(config: BusboyConfig): Busboy;
  export default Busboy;
}
